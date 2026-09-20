/**
 * @module app/composables/plugins/portable-client-runtime
 *
 * Purpose:
 * Run a selected, isolated-client package in the contained sandbox and surface
 * what it renders and contributes to the host UI.
 *
 * Behavior:
 * - The descriptor from the local runtime manifest is verified (identity,
 *   workspace, host-computed descriptor key, digest-addressed client entry)
 *   before any byte is fetched.
 * - The entry bytes are fetched from the digest-addressed package route and
 *   re-hashed by `startPortableWorker`; a mismatch is a block, never a fallback.
 * - Only qualified browsers may start the profile. An unqualified browser is
 *   reported as blocked with the host's own reason code.
 * - Host capabilities (`settings.*`, `network.http`) are registered only for
 *   approved grants and every call is re-checked server-side.
 * - Rendered views, contributions and logs are kept per activation so the
 *   marketplace UI can show what a plugin is doing, and teardown clears them.
 *
 * Constraints:
 * - Client only: it touches `document`, `window` and `fetch`.
 * - No host capability is granted from caller input; the descriptor and the
 *   server decide.
 *
 * Non-Goals:
 * - Trusted-host packages (they run through the existing bundled manager).
 */

import { markRaw, shallowReactive, reactive, readonly } from 'vue';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';
import type {
    HostPluginEvent,
    PluginContribution,
    WorkerIsolationRuntime,
} from '~~/shared/plugins/isolation/worker-runtime';
import type { PortableUiNode } from '~~/shared/plugins/isolation/ui-primitives';
import {
    PORTABLE_CLIENT_FEATURE,
    PORTABLE_PROFILE_NAME,
    defaultHostAbi,
    detectBrowserEngine,
    startPortableWorker,
} from '~~/shared/plugins/isolation/portable-bootstrap';
import { PORTABLE_FRAME_CSP } from '~~/shared/plugins/isolation/containment-policy';
import {
    PORTABLE_FRAME_SANDBOX,
    PORTABLE_FRAME_URL,
    type HostFrameElementPort,
} from '~~/shared/plugins/isolation/portable-frame-transport';
import {
    CAPABILITY_LIFECYCLE_CODES,
    REMOTE_CAPABILITY_METHODS,
    createHttpCapabilityTransport,
    createRemoteCapabilityMethods,
} from '~~/shared/plugins/isolation/capability-bridge';
import { requestWorkspacePluginReconcile } from './bundled-v1-manager-runtime';
import { resolvePackageDescriptor } from '~~/shared/plugins/descriptor-resolver';
import { getKvByName, hardDeleteKvByName, setKvByName } from '~/db/kv';
import { getDb } from '~/db/client';

export type PortableActivationStatus =
    | 'starting'
    | 'active'
    | 'blocked'
    | 'stopped';

export interface PortableRenderedView {
    readonly key?: string | null;
    readonly navigation?: readonly PortableUiNode[];
    readonly title: string | null;
    readonly nodes: readonly PortableUiNode[];
}

export interface PortableContributionView {
    readonly id: string;
    readonly title: string | null;
    readonly nodes: readonly PortableUiNode[];
}

export interface PortableLogEntry {
    readonly level: string;
    readonly message: string;
    readonly at: number;
}

export interface PortableActivation {
    readonly pluginId: string;
    readonly version: string;
    readonly workspaceId: string;
    readonly generation: number;
    readonly descriptorKey: string;
    readonly status: PortableActivationStatus;
    readonly blockCode: string | null;
    readonly blockMessage: string | null;
    readonly view: PortableRenderedView | null;
    readonly contributions: readonly PortableContributionView[];
    readonly capabilities: readonly string[];
    /** Grants the workspace actually approved for this activation. */
    readonly approvedGrants: readonly string[];
    readonly logs: readonly PortableLogEntry[];
    readonly crashed: boolean;
    readonly startedAt: number | null;
}

interface InternalActivation extends Omit<PortableActivation, 'status'> {
    status: PortableActivationStatus;
    runtime: WorkerIsolationRuntime | null;
    /** Opaque server handle used for explicit teardown revocation. */
    activationId: string | null;
    /** The epoch this activation owns; a superseded epoch may not publish. */
    epoch: number;
}

const MAX_LOGS = 50;

/** Rendered UI is display-only until a host request answers an action. */
export const PORTABLE_UI_EVENT_REQUEST = 'runtime.ui-event';

// Reactive so components re-render on plugin events; the cast keeps the stored
// activation type exact (the reactive wrapper would otherwise unwrap it).
const activations = reactive(
    new Map<string, InternalActivation>()
) as Map<string, InternalActivation>;
let listenerInstalled = false;

/**
 * Per-plugin activation epochs. Starting, blocking or stopping an activation
 * claims the next epoch, and every asynchronous completion - a slow start, a
 * plugin event, a crash - must still hold it before it may publish or mutate
 * state. Without this, a workspace switch that starts a replacement could be
 * overwritten by the previous start's late completion, and a stale caller's
 * `deactivatePortableClient()` could dispose the wrong sandbox.
 */
const activationEpochs = new Map<string, number>();

function claimActivationEpoch(pluginId: string): number {
    const next = (activationEpochs.get(pluginId) ?? 0) + 1;
    activationEpochs.set(pluginId, next);
    return next;
}

function holdsActivationEpoch(pluginId: string, epoch: number): boolean {
    return activationEpochs.get(pluginId) === epoch;
}

function createHiddenFrame(): HostFrameElementPort {
    const frame = document.createElement('iframe');
    // No `allow-same-origin`: the worker inherits the frame's opaque origin.
    frame.setAttribute('sandbox', PORTABLE_FRAME_SANDBOX);
    frame.setAttribute('src', PORTABLE_FRAME_URL);
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);
    return frame as unknown as HostFrameElementPort;
}

export function addWindowMessageListener(
    listener: (event: { data: unknown; origin: string; source: unknown }) => void
): () => void {
    const wrapped = (event: MessageEvent) =>
        listener({ data: event.data, origin: event.origin, source: event.source });
    window.addEventListener('message', wrapped);
    return () => window.removeEventListener('message', wrapped);
}

/**
 * Lifecycle refusal code carried by a settings-save HTTP failure. The route
 * answers stale/revoked/disabled handles with `data.code`, the same vocabulary
 * the capability bridge treats as activation death.
 */
function settingsLifecycleCode(error: unknown): string | null {
    const data = (error as { data?: unknown } | null)?.data;
    if (!data || typeof data !== 'object') return null;
    const record = data as { code?: unknown; rpcCode?: unknown };
    const code =
        typeof record.code === 'string'
            ? record.code
            : typeof record.rpcCode === 'string'
              ? record.rpcCode
              : null;
    return code !== null && CAPABILITY_LIFECYCLE_CODES.has(code) ? code : null;
}

/**
 * Settings are workspace-scoped package settings: the same validated document
 * the setup page edits, so a plugin cannot invent keys or write secrets.
 *
 * Storage is workspace/plugin-scoped persistent key/value data (the Dexie `kv`
 * table, namespaced by plugin id). It is the only storage the production
 * runtime offers sandboxes: without it a plugin's `storage.*` calls are
 * refused, so a product that persists presets must not pretend otherwise.
 */
export function createPortableSettingsServices(
    pluginId: string,
    packageDigest?: string | null,
    activationId?: string | null,
    lifecycle?: {
        /**
         * Invoked when a settings write is refused because the activation
         * itself died. Runs the same epoch/generation-scoped stale handler the
         * remote capability bridge uses, so a settings-only plugin also stops
         * and offers an explicit restart.
         */
        readonly onActivationStale: (code: string) => void;
    }
): {
    readonly settings: {
        readonly get: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly set: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly list: () => Promise<unknown>;
        readonly delete: () => Promise<unknown>;
    };
    readonly storage: {
        readonly get: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly set: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly list: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly delete: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
    };
} {
    const loadValues = async (): Promise<Record<string, unknown>> => {
        // A plain `string` URL keeps Nuxt's typed-route inference out of a
        // runtime-composed path. `slot=current` makes the running plugin read
        // the selected version's settings, never a pending candidate's.
        const url: string = `/api/plugins/${pluginId}/setup-plan?slot=current`;
        // The route answers `{ settings: { values }, ... }`; reading a top-level
        // `values` made every saved setting look unset.
        const plan = (await ($fetch as unknown as (input: string) => Promise<unknown>)(
            url
        )) as { settings?: { values?: Record<string, unknown> } };
        return plan.settings?.values ?? {};
    };

    const storagePrefix = `plugin-storage:${pluginId}:`;
    const invalid = (message: string) =>
        Object.assign(new Error(message), { rpcCode: 'invalid-input' });
    const readStorageKey = (params: Readonly<Record<string, unknown>>): string => {
        const key = typeof params.key === 'string' ? params.key : '';
        if (!key || key.length > 200 || key.includes('\u0000')) {
            throw invalid('storage calls require a key of 1–200 characters');
        }
        return key;
    };
    const MAX_STORAGE_VALUE_BYTES = 32 * 1024;

    return {
        settings: {
            async get(params) {
                const key = typeof params.key === 'string' ? params.key : '';
                if (!key) {
                    throw Object.assign(new Error('settings.get requires a key'), {
                        rpcCode: 'invalid-input',
                    });
                }
                const values = await loadValues();
                return { value: values[key] ?? null };
            },
            async set(params) {
                const key = typeof params.key === 'string' ? params.key : '';
                if (!key) {
                    throw Object.assign(new Error('settings.set requires a key'), {
                        rpcCode: 'invalid-input',
                    });
                }
                const url: string = `/api/plugins/${pluginId}/setup-values?slot=current`;
                try {
                    await (
                        $fetch as unknown as (
                            input: string,
                            options: Record<string, unknown>
                        ) => Promise<unknown>
                    )(url, {
                        method: 'POST',
                        headers: { 'x-or3-plugin-intent': 'plugin' },
                        // The digest this activation is executing binds the write:
                        // after a promotion the old activation's save is refused
                        // instead of landing in the new package's configuration.
                        // The activation handle proves the writer is still the
                        // live, enabled, unrevoked activation for those bytes.
                        body: {
                            values: { [key]: params.value ?? null },
                            ...(packageDigest ? { expectedPackageDigest: packageDigest } : {}),
                            ...(activationId ? { activationId } : {}),
                        },
                    });
                } catch (error) {
                    const code = settingsLifecycleCode(error);
                    if (code) {
                        // The failed write is never replayed: the host stops the
                        // matching activation, keeps the rendered view (and the
                        // user's typed values), and requires an explicit restart.
                        lifecycle?.onActivationStale(code);
                        const failure =
                            error instanceof Error
                                ? error
                                : new Error('The settings write was refused');
                        Object.assign(failure, { rpcCode: 'policy-denied' });
                        throw failure;
                    }
                    throw error;
                }
                return { ok: true };
            },
            async list() {
                return { values: await loadValues() };
            },
            async delete() {
                throw Object.assign(
                    new Error('Portable plugins cannot delete settings yet'),
                    { rpcCode: 'permission-denied' }
                );
            },
        },
        storage: {
            async get(params) {
                const key = readStorageKey(params);
                const row = await getKvByName(`${storagePrefix}${key}`);
                if (!row || row.value === null || row.value === undefined) {
                    return { value: null };
                }
                try {
                    return { value: JSON.parse(row.value) as unknown };
                } catch {
                    return { value: null };
                }
            },
            async set(params) {
                const key = readStorageKey(params);
                const value = params.value ?? null;
                const serialized = JSON.stringify(value);
                if (new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_VALUE_BYTES) {
                    throw invalid(`storage values must be at most ${MAX_STORAGE_VALUE_BYTES} bytes`);
                }
                await setKvByName(`${storagePrefix}${key}`, serialized);
                return { ok: true };
            },
            async list(params) {
                const prefix = typeof params.prefix === 'string' ? params.prefix : '';
                if (prefix.length > 200) throw invalid('storage.list prefix is too long');
                const rows = await getDb()
                    .kv.where('name')
                    .startsWith(`${storagePrefix}${prefix}`)
                    .toArray();
                return {
                    entries: rows.map((row) => ({
                        key: row.name.slice(storagePrefix.length),
                        sizeBytes: typeof row.value === 'string' ? row.value.length : 0,
                        updatedAt: row.updated_at * 1000,
                    })),
                };
            },
            async delete(params) {
                const key = readStorageKey(params);
                await hardDeleteKvByName(`${storagePrefix}${key}`);
                return { ok: true };
            },
        },
    };
}

function readGrants(descriptor: PackageV2PluginDescriptor) {
    return {
        requestedGrants: [...descriptor.effectiveGrants],
        approvedGrants: [...descriptor.effectiveGrants],
        revision: descriptor.grantsRevision,
        status: 'current' as const,
        authoritySha256: descriptor.authoritySha256 ?? null,
        packageDigest: descriptor.artifact.packageDigest,
    };
}

/**
 * Ask the server for an activation handle before the sandbox starts. The server
 * re-derives the plugin, workspace, acting user, generation, selected package
 * digest and approved grants; a refusal blocks the activation rather than
 * letting the sandbox run without a verified identity.
 */
async function mintHostActivation(
    pluginId: string
): Promise<
    | { readonly ok: true; readonly activationId: string; readonly generation: number }
    | { readonly ok: false; readonly message: string }
> {
    try {
        const response = await fetch('/api/plugins/isolation/activation', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'content-type': 'application/json',
                'x-or3-plugin-intent': 'plugin',
            },
            body: JSON.stringify({ pluginId }),
        });
        if (!response.ok) {
            let message = `The host refused to activate this plugin (${response.status})`;
            try {
                const payload = (await response.json()) as {
                    statusMessage?: unknown;
                    message?: unknown;
                };
                if (typeof payload.statusMessage === 'string') message = payload.statusMessage;
                else if (typeof payload.message === 'string') message = payload.message;
            } catch {
                // A non-JSON refusal keeps the status text.
            }
            return { ok: false, message };
        }
        const payload = (await response.json()) as {
            activation?: { activationId?: unknown; generation?: unknown };
        };
        const activationId = payload.activation?.activationId;
        const generation = payload.activation?.generation;
        if (typeof activationId !== 'string' || typeof generation !== 'number') {
            return { ok: false, message: 'The host returned no activation handle' };
        }
        return { ok: true, activationId, generation };
    } catch (error) {
        return {
            ok: false,
            message:
                error instanceof Error
                    ? error.message
                    : 'The host activation could not be requested',
        };
    }
}

/**
 * Best-effort, authenticated revocation for client stop/logout/workspace
 * switch. Returns whether the server confirmed the teardown: callers run
 * while the session is still valid, so a refusal is unexpected and worth
 * surfacing in development instead of silently leaving a live handle behind.
 */
async function revokeHostActivationHandle(activationId: string): Promise<boolean> {
    if (!activationId) return true;
    try {
        const response = await fetch('/api/plugins/isolation/activation', {
            method: 'DELETE',
            credentials: 'same-origin',
            keepalive: true,
            headers: {
                'content-type': 'application/json',
                'x-or3-plugin-intent': 'plugin',
            },
            body: JSON.stringify({ activationId }),
        });
        if (!response.ok && import.meta.dev) {
            console.warn(
                `[portable-client] activation teardown was not confirmed (${response.status})`
            );
        }
        return response.ok;
    } catch {
        // The server's TTL remains the fallback when the tab is already offline.
        return false;
    }
}

/**
 * Mutate the activation only while it still owns its epoch. The entry check
 * catches a replacement, and the epoch check also catches a stop, which claims
 * the next epoch while leaving the stopped entry in place.
 */
function update(pluginId: string, epoch: number, patch: Partial<InternalActivation>): void {
    if (!holdsActivationEpoch(pluginId, epoch)) return;
    const current = activations.get(pluginId);
    if (!current || current.epoch !== epoch) return;
    Object.assign(current, patch);
}

function recordEvent(pluginId: string, epoch: number, event: HostPluginEvent): void {
    if (!holdsActivationEpoch(pluginId, epoch)) return;
    const current = activations.get(pluginId);
    if (!current || current.epoch !== epoch) return;
    if (event.status === 'rendered') {
        update(pluginId, epoch, { view: { key: event.key ?? null, title: event.title, nodes: event.nodes, navigation: event.navigation ?? [] } });
        return;
    }
    if (event.status === 'contributed') {
        const contribution: PluginContribution = event.contribution;
        const next = current.contributions.filter(
            (entry) => entry.id !== contribution.contributionId
        );
        next.push({
            id: contribution.contributionId,
            title: contribution.title,
            nodes: contribution.nodes,
        });
        update(pluginId, epoch, { contributions: next });
        return;
    }
    if (event.status === 'withdrawn') {
        const removed = new Set(event.contributionIds);
        update(pluginId, epoch, {
            contributions: current.contributions.filter((entry) => !removed.has(entry.id)),
        });
        return;
    }
    if (event.status === 'forwarded' && event.name === 'runtime.log') {
        const level = typeof event.payload.level === 'string' ? event.payload.level : 'info';
        const message =
            typeof event.payload.message === 'string' ? event.payload.message : '';
        const logs = [
            ...current.logs,
            { level, message, at: Date.now() },
        ].slice(-MAX_LOGS);
        update(pluginId, epoch, { logs });
    }
}

export interface ActivatePortableInput {
    readonly descriptor: PackageV2PluginDescriptor;
    readonly workspaceId: string;
    /** Raw runtime manifest entry, re-verified before anything is fetched. */
    readonly runtimeEntry?: unknown;
}

/**
 * Start one contained activation. Returns the recorded activation state; a
 * blocked activation is recorded with its reason so the UI can explain it.
 */
export async function activatePortableClient(
    input: ActivatePortableInput
): Promise<PortableActivation> {
    const { descriptor, workspaceId } = input;
    const pluginId = descriptor.id;
    // This activation claims the plugin's next epoch before any await, so a
    // replacement started while it is still resolving supersedes it cleanly.
    const epoch = claimActivationEpoch(pluginId);
    const previous = activations.get(pluginId);
    if (previous) {
        previous.runtime?.dispose();
        previous.runtime = null;
        previous.status = 'stopped';
        if (previous.activationId) {
            const previousHandle = previous.activationId;
            previous.activationId = null;
            void revokeHostActivationHandle(previousHandle);
        }
    }

    if (input.runtimeEntry !== undefined) {
        const resolution = await resolvePackageDescriptor({
            pluginId,
            workspaceId,
            runtimeEntry: input.runtimeEntry,
            requireClientEntry: true,
        });
        if (!holdsActivationEpoch(pluginId, epoch)) return currentActivationOr(pluginId, descriptor, workspaceId, epoch);
        if (resolution.status === 'blocked') {
            return recordBlocked(pluginId, descriptor, workspaceId, resolution.failure.code, resolution.failure.message, epoch);
        }
    }

    const clientEntry = descriptor.artifact.client;
    if (!clientEntry) {
        if (!holdsActivationEpoch(pluginId, epoch)) return currentActivationOr(pluginId, descriptor, workspaceId, epoch);
        return recordBlocked(
            pluginId,
            descriptor,
            workspaceId,
            'catalog-artifact-mismatch',
            'The selected package has no digest-addressed client entry',
            epoch
        );
    }

    if (!holdsActivationEpoch(pluginId, epoch)) return currentActivationOr(pluginId, descriptor, workspaceId, epoch);

    /**
     * The server mints the activation before any sandbox starts: it seals the
     * plugin, workspace, acting user, generation, selected package digest and
     * approved grants into an opaque handle. The sandbox never sees or names
     * those fields, and the capability route resolves the handle on every call.
     */
    const minted = await mintHostActivation(pluginId);
    if (!holdsActivationEpoch(pluginId, epoch)) {
        if (minted.ok) void revokeHostActivationHandle(minted.activationId);
        return currentActivationOr(pluginId, descriptor, workspaceId, epoch);
    }
    if (!minted.ok) {
        return recordBlocked(
            pluginId,
            descriptor,
            workspaceId,
            'activation-refused',
            minted.message,
            epoch
        );
    }
    const generation = minted.generation;

    const base: InternalActivation = {
        pluginId,
        version: descriptor.version,
        workspaceId,
        generation,
        activationId: minted.activationId,
        epoch,
        descriptorKey: descriptor.descriptorKey,
        status: 'starting',
        blockCode: null,
        blockMessage: null,
        view: null,
        contributions: [],
        capabilities: [],
        approvedGrants: [...descriptor.effectiveGrants],
        logs: [],
        crashed: false,
        startedAt: Date.now(),
        runtime: null,
    };
    activations.set(pluginId, base);

    const grants = readGrants(descriptor);
    const moduleUrl = `/api/plugins/packages/${encodeURIComponent(pluginId)}/${descriptor.artifact.packageDigest}/${clientEntry.entry}`;
    const transport = createHttpCapabilityTransport();
    // The activation handle is host-minted and page-side only; the sandbox
    // cannot name a plugin, generation or grant list of its own.
    const activationId = minted.activationId;

    const started = await startPortableWorker({
        release: {
            releaseId: descriptor.artifact.packageDigest,
            pluginId,
            packageTreeSha256: descriptor.artifact.packageDigest,
            clientEntryDigest: clientEntry.digest,
            moduleUrl,
        },
        profile: {
            profile: PORTABLE_PROFILE_NAME,
            minHostAbiVersion: 1,
            requiredFeatures: [PORTABLE_CLIENT_FEATURE],
        },
        abi: defaultHostAbi(),
        engine: detectBrowserEngine(),
        workspaceId,
        generation,
        grants,
        services: createPortableSettingsServices(
            pluginId,
            descriptor.artifact.packageDigest,
            minted.activationId,
            {
                // Settings-only plugins get the same lifecycle handling as
                // remote capabilities: a refused save stops this activation.
                onActivationStale: (code) =>
                    markPortableClientActivationStale(pluginId, epoch, generation, code),
            }
        ),
        methods: createRemoteCapabilityMethods({
            transport,
            session: () => ({ activationId }),
            grants,
            capabilities: Object.values(REMOTE_CAPABILITY_METHODS),
            // A lifecycle refusal means the handle itself is dead: stop the
            // matching activation so the surface offers an explicit restart
            // instead of staying "Running" with an unusable handle.
            onCapabilityRefusal: (refusal) => {
                if (!CAPABILITY_LIFECYCLE_CODES.has(refusal.code)) return;
                markPortableClientActivationStale(pluginId, epoch, generation, refusal.code);
            },
        }),
        loadServedBytes: async (url) => {
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`Package entry request failed (${response.status})`);
            }
            return { bytes: await response.arrayBuffer(), contentType: response.headers.get('content-type') ?? undefined };
        },
        createFrame: createHiddenFrame,
        addWindowMessageListener,
        hostOrigin: window.location.origin,
        csp: PORTABLE_FRAME_CSP,
        // Session identity is captured for the capability echo below; the
        // sandbox stamps its own copy on every request.
        onEvent: (event) => recordEvent(pluginId, epoch, event),
        onCrash: (report) => {
            // A fatal crash terminates the sandbox, so the activation is no
            // longer active. A non-fatal containment report leaves the runtime
            // usable, so its handle must remain valid for later calls.
            if (report.fatal) void revokeHostActivationHandle(activationId);
            update(pluginId, epoch, {
                crashed: report.fatal,
                ...(report.fatal
                    ? {
                          status: 'stopped' as const,
                          runtime: null,
                          activationId: null,
                          blockCode: report.reason,
                      }
                    : {}),
            });
        },
    });

    // The start is asynchronous, so the plugin may have been stopped or
    // re-activated meanwhile. A superseded start disposes its own sandbox and
    // leaves the replacement's state untouched.
    if (!holdsActivationEpoch(pluginId, epoch)) {
        if (started.status !== 'blocked') started.runtime.dispose();
        void revokeHostActivationHandle(activationId);
        return currentActivationOr(pluginId, descriptor, workspaceId, epoch);
    }

    if (started.status === 'blocked') {
        void revokeHostActivationHandle(activationId);
        return recordBlocked(
            pluginId,
            descriptor,
            workspaceId,
            started.codes[0] ?? 'bootstrap-failed',
            started.message,
            epoch
        );
    }

    update(pluginId, epoch, {
        status: 'active',
        // Runtime methods use native private fields; Vue proxies cannot be their receiver.
        runtime: markRaw(started.runtime),
        capabilities: started.runtime.capabilities,
    });
    return snapshot(pluginId);
}
/**
 * The activation to report for a completion that no longer owns the plugin: the
 * live one when something replaced it, otherwise the superseded activation
 * marked stopped. Throws for nobody's plugin only if the caller never had one.
 */
function currentActivationOr(
    pluginId: string,
    descriptor: PackageV2PluginDescriptor,
    workspaceId: string,
    epoch: number
): PortableActivation {
    const current = activations.get(pluginId);
    if (current) return snapshot(pluginId);
    return snapshotOf({
        pluginId,
        version: descriptor.version,
        workspaceId,
        generation: 0,
        epoch,
        activationId: null,
        descriptorKey: descriptor.descriptorKey,
        status: 'stopped',
        blockCode: null,
        blockMessage: null,
        view: null,
        contributions: [],
        capabilities: [],
        approvedGrants: [...descriptor.effectiveGrants],
        logs: [],
        crashed: false,
        startedAt: null,
        runtime: null,
    });
}

function recordBlocked(
    pluginId: string,
    descriptor: PackageV2PluginDescriptor,
    workspaceId: string,
    blockCode: string,
    blockMessage: string,
    epoch: number
): PortableActivation {
    const activation: InternalActivation = {
        pluginId,
        version: descriptor.version,
        workspaceId,
        generation: 0,
        activationId: null,
        epoch,
        descriptorKey: descriptor.descriptorKey,
        status: 'blocked',
        blockCode,
        blockMessage,
        view: null,
        contributions: [],
        capabilities: [],
        approvedGrants: [...descriptor.effectiveGrants],
        logs: [],
        crashed: false,
        startedAt: null,
        runtime: null,
    };
    activations.set(pluginId, activation);
    return snapshot(pluginId);
}

/**
 * Verified manifest sources for demand-driven activation. The manifest sync
 * records what may run; a surface starts its plugin when the user opens it,
 * because a contained activation has a hard wall-clock budget and eagerly
 * starting every plugin would consume it before anyone used the plugin.
 */
export interface PortableClientSource {
    readonly descriptor: PackageV2PluginDescriptor;
    readonly workspaceId: string;
    readonly runtimeEntry: unknown;
}

const clientSources = shallowReactive(new Map<string, PortableClientSource>());

export function setPortableClientSource(source: PortableClientSource): void {
    clientSources.set(source.descriptor.id, source);
}

export function removePortableClientSource(pluginId: string): void {
    clientSources.delete(pluginId);
}

export function clearPortableClientSources(): void {
    clientSources.clear();
}

export function getPortableClientSource(pluginId: string): PortableClientSource | null {
    return clientSources.get(pluginId) ?? null;
}

export function listPortableClientSources(): readonly PortableClientSource[] {
    return [...clientSources.values()];
}

/**
 * Demand-driven activation: start (or restart) the plugin from the last
 * verified manifest source. An active or starting activation is returned as is;
 * a blocked activation is reported rather than retried in a loop.
 */
export async function ensurePortableClientActivation(
    pluginId: string
): Promise<PortableActivation | null> {
    const current = activations.get(pluginId);
    if (current && current.status !== 'stopped') return snapshot(pluginId);
    const source = clientSources.get(pluginId);
    if (!source) return current ? snapshot(pluginId) : null;
    return await activatePortableClient(source);
}

/**
 * Stop the current activation. Claims the next epoch first, so an in-flight
 * start for the stopped activation cannot publish afterwards, and a caller that
 * lost the race cannot dispose a newer sandbox.
 */
export async function deactivatePortableClient(pluginId: string): Promise<void> {
    claimActivationEpoch(pluginId);
    const current = activations.get(pluginId);
    if (!current) return;
    const runtime = current.runtime;
    const activationId = current.activationId;
    Object.assign(current, {
        runtime: null,
        activationId: null,
        status: 'stopped',
        contributions: [],
        view: null,
    });
    runtime?.dispose();
    if (activationId) await revokeHostActivationHandle(activationId);
}

/** User-facing stopped reason for each lifecycle refusal code. */
function staleActivationMessage(code: string): string {
    switch (code) {
        case 'activation-expired':
            return "This plugin's contained session expired. Your typed values are kept below.";
        case 'activation-unknown':
        case 'activation-revoked':
            return "This plugin's session was stopped on the host. Your typed values are kept below.";
        case 'activation-stale':
        case 'grant-review-stale':
        case 'grant-review-unresolved':
            return "This plugin was updated or its permissions changed. Your typed values are kept below.";
        case 'activation-session-mismatch':
            return 'The workspace or sign-in changed. Your typed values are kept below.';
        case 'plugin-disabled':
            return 'This plugin was disabled. Your typed values are kept below.';
        case 'plugin-uninstalled':
            return 'This plugin was uninstalled. Your typed values are kept below.';
        case 'plugin-access-denied':
            return 'Access to this plugin changed. Your typed values are kept below.';
        default:
            return "This plugin's contained session ended. Your typed values are kept below.";
    }
}

/**
 * Stop one activation after the server reports its handle stale. Only the
 * matching epoch and generation stop: a late refusal for a superseded
 * activation is ignored. Rendered state and host fields survive (the view
 * owns the field store), the handle is revoked best-effort, and a manifest
 * reconcile refreshes the package source so an explicit restart mints
 * through current authority checks. The failed operation is never replayed.
 */
function markPortableClientActivationStale(
    pluginId: string,
    epoch: number,
    generation: number,
    code: string
): void {
    if (!holdsActivationEpoch(pluginId, epoch)) return;
    const current = activations.get(pluginId);
    if (!current || current.epoch !== epoch || current.generation !== generation) return;
    if (current.status !== 'active' && current.status !== 'starting') return;
    claimActivationEpoch(pluginId);
    const stopped = activations.get(pluginId);
    if (!stopped) return;
    const runtime = stopped.runtime;
    const activationId = stopped.activationId;
    Object.assign(stopped, {
        runtime: null,
        activationId: null,
        status: 'stopped',
        blockCode: code,
        blockMessage: staleActivationMessage(code),
    });
    runtime?.dispose();
    if (activationId) void revokeHostActivationHandle(activationId);
    requestWorkspacePluginReconcile('manifest-revision-change');
}

export function stopAllPortableClients(): void {
    void stopAllPortableClientsAndAwait();
}

/** Awaitable teardown used by logout and workspace-switch cleanup. */
export async function stopAllPortableClientsAndAwait(): Promise<void> {
    for (const pluginId of [...activations.keys()]) {
        await deactivatePortableClient(pluginId);
    }
}

/**
 * Forward a UI event from a rendered view to the plugin. The plugin answers the
 * request and may render again; nothing is assumed about the outcome.
 */
export async function invokePortableUiEvent(
    pluginId: string,
    payload: Readonly<Record<string, unknown>>
): Promise<unknown> {
    const current = activations.get(pluginId);
    if (!current?.runtime) {
        throw new Error('Plugin is not active');
    }
    return await current.runtime.callPlugin(PORTABLE_UI_EVENT_REQUEST, {
        ...payload,
    });
}

/** Install the unload teardown once, from the client plugin. */
export function installPortableUnloadTeardown(): void {
    if (listenerInstalled || typeof window === 'undefined') return;
    listenerInstalled = true;
    window.addEventListener('pagehide', stopAllPortableClients);
}

export function listPortableActivations(): readonly PortableActivation[] {
    return [...activations.values()].map((entry) => snapshot(entry.pluginId));
}

export function getPortableActivation(pluginId: string): PortableActivation | null {
    return activations.has(pluginId) ? snapshot(pluginId) : null;
}

/**
 * Reactive view of the live activations. The map itself is reactive, so a
 * component re-renders when a plugin renders, contributes or crashes.
 */
export function usePortableActivations(): ReadonlyMap<string, InternalActivation> {
    return readonly(activations) as ReadonlyMap<string, InternalActivation>;
}

function snapshot(pluginId: string): PortableActivation {
    const entry = activations.get(pluginId);
    if (!entry) throw new Error(`No activation for ${pluginId}`);
    return snapshotOf(entry);
}

function snapshotOf(entry: InternalActivation): PortableActivation {
    return Object.freeze({
        pluginId: entry.pluginId,
        version: entry.version,
        workspaceId: entry.workspaceId,
        generation: entry.generation,
        descriptorKey: entry.descriptorKey,
        status: entry.status,
        blockCode: entry.blockCode,
        blockMessage: entry.blockMessage,
        view: entry.view,
        contributions: Object.freeze([...entry.contributions]),
        capabilities: Object.freeze([...entry.capabilities]),
        approvedGrants: Object.freeze([...entry.approvedGrants]),
        logs: Object.freeze([...entry.logs]),
        crashed: entry.crashed,
        startedAt: entry.startedAt,
    });
}

/** Chat tool calls stay inside the approved sandbox and its storage authority. */
export async function invokePortableToolRequest(
    pluginId: string,
    method: 'runtime.tools' | 'runtime.tool',
    payload: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
    const activation = await ensurePortableClientActivation(pluginId);
    const current = activations.get(pluginId);
    if (activation?.status !== 'active' || !current?.runtime || !current.approvedGrants.includes('tools.register.client')) {
        throw new Error('This plugin is not approved to provide chat tools in this workspace.');
    }
    const response = await current.runtime.callPlugin(method, payload);
    if (!response.ok) throw new Error(response.message);
    return response.result;
}
