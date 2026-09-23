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
import type { HostRpcHandlerContext } from '~~/shared/plugins/isolation/host-rpc-broker';
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
import { getKvByName, getKvRecordByName, setKvByName, tombstoneKvByName } from '~/db/kv';
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

export type PortableContributionSurface = 'pane' | 'sidebar' | 'tools';
export type PortableContributionReadiness = 'pending' | 'ready' | 'failed' | 'not-required';

export interface PortableActivation {
    readonly pluginId: string;
    readonly version: string;
    /** Host-computed digest of the exact package bytes this activation runs. */
    readonly packageDigest: string;
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
    /**
     * Per-surface registration outcome. Pane and sidebar are required: a
     * `failed` entry prevents full readiness. Tools are optional: a failed
     * discovery is reported in `degradedContributions` instead of failing the
     * activation, and surfaces without the grant stay `not-required`.
     */
    readonly contributionReadiness: Readonly<Record<PortableContributionSurface, PortableContributionReadiness>>;
    /** Optional surfaces that failed but did not fail the activation. */
    readonly degradedContributions: readonly string[];
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
    },
    workspaceId?: string | null
): {
    readonly settings: {
        readonly get: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly set: (
            params: Readonly<Record<string, unknown>>,
            context?: Pick<HostRpcHandlerContext, 'emitEvent' | 'markCommitted'>
        ) => Promise<unknown>;
        readonly list: () => Promise<unknown>;
        readonly delete: (
            params: Readonly<Record<string, unknown>>,
            context?: Pick<HostRpcHandlerContext, 'emitEvent' | 'markCommitted'>
        ) => Promise<unknown>;
    };
    readonly storage: {
        readonly get: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly getRecord: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly set: (
            params: Readonly<Record<string, unknown>>,
            context?: Pick<HostRpcHandlerContext, 'signal' | 'markCommitted'>
        ) => Promise<unknown>;
        readonly list: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly listPage: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly delete: (
            params: Readonly<Record<string, unknown>>,
            context?: Pick<HostRpcHandlerContext, 'signal' | 'markCommitted'>
        ) => Promise<unknown>;
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
    // Capture the active workspace database once per activation. Async storage
    // work must never resolve the globally active DB halfway through a write.
    const capturedDb = getDb();
    const getStorageKv = (name: string) =>
        getKvByName(name, capturedDb);
    const setStorageKv = (
        name: string,
        value: string | null,
        options?: { readonly ifClock?: number | null },
        guard?: { readonly signal?: AbortSignal }
    ) => setKvByName(name, value, capturedDb, {
        ...options, ...guard, quota: storageQuota,
    });
    const deleteStorageKv = (name: string, guard?: { readonly signal?: AbortSignal }) =>
        tombstoneKvByName(name, capturedDb, guard);
    // Tombstoned rows (deleted by `delete`, revision preserved) read as absent.
    const isLiveStorageRow = <T extends { readonly deleted?: unknown }>(
        row: T | undefined
    ): row is T => row !== undefined && row.deleted !== true;
    const invalid = (message: string) =>
        Object.assign(new Error(message), { rpcCode: 'invalid-input' });
    const readStorageKey = (params: Readonly<Record<string, unknown>>): string => {
        const key = typeof params.key === 'string' ? params.key : '';
        if (!key || key.length > 200 || key.includes('\u0000')) {
            throw invalid('storage calls require a key of 1–200 characters');
        }
        return key;
    };
    const readSettingsKey = (params: Readonly<Record<string, unknown>>): string => {
        const key = typeof params.key === 'string' ? params.key : '';
        if (!key || key.length > 200 || key.includes('\u0000')) {
            throw invalid('settings calls require a key of 1–200 characters');
        }
        return key;
    };
    const MAX_STORAGE_VALUE_BYTES = 32 * 1024;
    // Aggregate caps per plugin per workspace. Individual values are bounded
    // above; these bound the total footprint across activations. Usage is
    // derived from the live rows in scope inside the write transaction (see
    // `StorageQuota`), so racing writers cannot over-admit and remote-applied
    // rows stay accounted.
    const MAX_STORAGE_KEYS = 1000;
    const MAX_STORAGE_BYTES = 1024 * 1024;
    /** Explicit bound for the legacy `list()` call; use `listPage()` beyond it. */
    const MAX_STORAGE_LIST_ENTRIES = 200;
    const storageQuota = {
        prefix: storagePrefix,
        maxBytes: MAX_STORAGE_BYTES,
        maxKeys: MAX_STORAGE_KEYS,
        maxRetainedKeys: 10_000,
    };
    return {
        settings: {
            async get(params) {
                const key = readSettingsKey(params);
                const values = await loadValues();
                return { value: values[key] ?? null };
            },
            async set(params, context) {
                const key = readSettingsKey(params);
                const url: string = `/api/plugins/${pluginId}/setup-values?slot=current`;
                try {
                    const response = await (
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
                    context?.markCommitted?.();
                    const revision =
                        response && typeof response === 'object' &&
                        typeof (response as { revision?: unknown }).revision === 'number'
                            ? (response as { revision: number }).revision
                            : null;
                    if (revision !== null) {
                        context?.emitEvent?.('settings.changed', {
                            key,
                            revision,
                            deleted: false,
                        });
                    }
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
            async delete(params, context) {
                const key = readSettingsKey(params);
                const url: string = `/api/plugins/${pluginId}/setup-values?slot=current`;
                try {
                    const response = await (
                        $fetch as unknown as (
                            input: string,
                            options: Record<string, unknown>
                        ) => Promise<unknown>
                    )(url, {
                        method: 'POST',
                        headers: { 'x-or3-plugin-intent': 'plugin' },
                        body: {
                            values: { [key]: null },
                            ...(packageDigest ? { expectedPackageDigest: packageDigest } : {}),
                            ...(activationId ? { activationId } : {}),
                        },
                    });
                    context?.markCommitted?.();
                    const revision =
                        response && typeof response === 'object' &&
                        typeof (response as { revision?: unknown }).revision === 'number'
                            ? (response as { revision: number }).revision
                            : null;
                    if (revision !== null) {
                        context?.emitEvent?.('settings.changed', {
                            key,
                            revision,
                            deleted: true,
                        });
                    }
                } catch (error) {
                    const code = settingsLifecycleCode(error);
                    if (code) {
                        lifecycle?.onActivationStale(code);
                        const failure = error instanceof Error ? error : new Error('The settings delete was refused');
                        Object.assign(failure, { rpcCode: 'policy-denied' });
                        throw failure;
                    }
                    throw error;
                }
                return { ok: true };
            },
        },
        storage: {
            async get(params) {
                const key = readStorageKey(params);
                const row = await getStorageKv(`${storagePrefix}${key}`);
                if (!isLiveStorageRow(row) || row.value === null || row.value === undefined) {
                    return { value: null };
                }
                try {
                    return { value: JSON.parse(row.value) as unknown };
                } catch {
                    return { value: null };
                }
            },
            async getRecord(params) {
                const key = readStorageKey(params);
                const { row, revision } = await getKvRecordByName(`${storagePrefix}${key}`, capturedDb);
                if (!isLiveStorageRow(row) || row.value === null || row.value === undefined) {
                    return { value: null, revision, sizeBytes: 0, updatedAt: 0 };
                }
                try {
                    return {
                        value: JSON.parse(row.value) as unknown,
                        revision,
                        sizeBytes: new TextEncoder().encode(row.value).byteLength,
                        updatedAt: row.updated_at * 1000,
                    };
                } catch {
                    return {
                        value: null,
                        revision,
                        sizeBytes: 0,
                        updatedAt: row.updated_at * 1000,
                    };
                }
            },
            async set(params, context) {
                if (context?.signal?.aborted) {
                    throw Object.assign(new Error('Storage operation was revoked'), {
                        rpcCode: 'cancelled',
                    });
                }
                const key = readStorageKey(params);
                const value = params.value ?? null;
                let serialized: string;
                try {
                    const encoded = JSON.stringify(value);
                    if (typeof encoded !== 'string') throw invalid('storage values must be JSON-serializable');
                    serialized = encoded;
                } catch (error) {
                    if (error && typeof error === 'object' && 'rpcCode' in error) throw error;
                    throw invalid('storage values must be JSON-serializable');
                }
                if (new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_VALUE_BYTES) {
                    throw invalid(`storage values must be at most ${MAX_STORAGE_VALUE_BYTES} bytes`);
                }
                const ifRevision = params.ifRevision;
                if (ifRevision !== undefined && ifRevision !== null &&
                    (!Number.isSafeInteger(ifRevision) || (ifRevision as number) < 0)) {
                    throw invalid('storage.set ifRevision must be null or a non-negative safe integer');
                }
                await setStorageKv(`${storagePrefix}${key}`, serialized,
                    { ifClock: ifRevision as number | null | undefined },
                    context?.signal === undefined ? undefined : { signal: context.signal });
                context?.markCommitted?.();
                return { ok: true };
            },
            async list(params) {
                const prefix = typeof params.prefix === 'string' ? params.prefix : '';
                if (prefix.length > 200) throw invalid('storage.list prefix is too long');
                const rows = await capturedDb.kv.where('name')
                    .startsWith(`${storagePrefix}${prefix}`)
                    .filter(isLiveStorageRow)
                    .limit(MAX_STORAGE_LIST_ENTRIES)
                    .toArray();
                return {
                    entries: rows.map((row) => {
                            const rowRevision = (row as unknown as { clock?: unknown }).clock;
                            return {
                                key: row.name.slice(storagePrefix.length),
                                sizeBytes: typeof row.value === 'string' ? new TextEncoder().encode(row.value).byteLength : 0,
                                updatedAt: row.updated_at * 1000,
                                ...(typeof rowRevision === 'number' ? { revision: rowRevision } : {}),
                            };
                        }),
                };
            },
            async listPage(params) {
                const prefix = typeof params.prefix === 'string' ? params.prefix : '';
                if (prefix.length > 200 || prefix.includes('\u0000')) {
                    throw invalid('storage.listPage prefix is too long or invalid');
                }
                if (params.cursor !== undefined && (typeof params.cursor !== 'string' || !params.cursor.startsWith('cursor:'))) {
                    throw invalid('storage.listPage cursor is invalid');
                }
                const cursor = typeof params.cursor === 'string' && params.cursor.startsWith('cursor:')
                    ? params.cursor.slice(7)
                    : '';
                if (cursor.length > 200 || cursor.includes('\u0000')) {
                    throw invalid('storage.listPage cursor is invalid');
                }
                const requestedLimit = typeof params.limit === 'number' && Number.isFinite(params.limit)
                    ? Math.floor(params.limit)
                    : 100;
                const limit = Math.max(1, Math.min(200, requestedLimit));
                if (cursor && !cursor.startsWith(prefix)) {
                    throw invalid('storage.listPage cursor does not match prefix');
                }
                const fullPrefix = `${storagePrefix}${prefix}`;
                const index = capturedDb.kv.where('name');
                const range = cursor
                    ? index.above(`${storagePrefix}${cursor}`)
                    : index.aboveOrEqual(fullPrefix);
                // Seek first, then skip deleted rows before applying the live-row
                // limit. A run of tombstones must never terminate a page walk.
                const rows = await range.until((row) => !row.name.startsWith(fullPrefix))
                    .filter(isLiveStorageRow).limit(limit + 1).toArray();
                const page = rows.slice(0, limit);
                const hasMore = rows.length > limit;
                return {
                    entries: page.map((row) => {
                        const rowRevision = (row as unknown as { clock?: unknown }).clock;
                        return {
                            key: row.name.slice(storagePrefix.length),
                            sizeBytes: typeof row.value === 'string' ? new TextEncoder().encode(row.value).byteLength : 0,
                            updatedAt: row.updated_at * 1000,
                            ...(typeof rowRevision === 'number' ? { revision: rowRevision } : {}),
                        };
                    }),
                    ...(hasMore && page.length > 0
                        ? { nextCursor: `cursor:${page[page.length - 1]!.name.slice(storagePrefix.length)}` }
                        : {}),
                };
            },
            async delete(params, context) {
                if (context?.signal?.aborted) {
                    throw Object.assign(new Error('Storage operation was revoked'), {
                        rpcCode: 'cancelled',
                    });
                }
                const key = readStorageKey(params);
                await deleteStorageKv(
                    `${storagePrefix}${key}`,
                    context?.signal === undefined ? undefined : { signal: context.signal }
                );
                context?.markCommitted?.();
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
    | { readonly ok: false; readonly message: string; readonly code: string }
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
            return { ok: false, message, code: response.status === 408 || response.status === 429 || response.status >= 500 ? 'activation-unavailable' : 'activation-refused' };
        }
        const payload = (await response.json()) as {
            activation?: { activationId?: unknown; generation?: unknown };
        };
        const activationId = payload.activation?.activationId;
        const generation = payload.activation?.generation;
        if (typeof activationId !== 'string' || typeof generation !== 'number') {
            return { ok: false, message: 'The host returned no activation handle', code: 'activation-invalid-response' };
        }
        return { ok: true, activationId, generation };
    } catch (error) {
        return {
            ok: false,
            code: 'activation-unavailable',
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
        for (const [surface, draft] of clientDrafts.get(pluginId) ?? []) {
            if (surface === 'sidebar') continue;
            const key = event.key ?? null;
            if (draft.viewKey !== undefined && draft.viewKey !== key) {
                for (const name of Object.keys(draft.values)) delete draft.values[name];
                draft.dirty.clear();
            }
            draft.viewKey = key;
        }
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
            minted.code,
            minted.message,
            epoch
        );
    }
    const generation = minted.generation;

    const base: InternalActivation = {
        pluginId,
        version: descriptor.version,
        packageDigest: descriptor.artifact.packageDigest,
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
        contributionReadiness: inheritedReadiness(
            pluginId,
            descriptor.descriptorKey,
            workspaceId,
            descriptor.effectiveGrants.includes('tools.register.client')
        ),
        degradedContributions: [
            ...inheritedToolsDegradation(pluginId, descriptor.descriptorKey, workspaceId),
        ],
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
            },
            workspaceId
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
            const timeLimitReached = report.fatal && report.reason === 'budget-exceeded:activation-ms';
            if (report.fatal) void revokeHostActivationHandle(activationId);
            update(pluginId, epoch, {
                crashed: report.fatal && !timeLimitReached,
                ...(report.fatal
                    ? {
                          status: 'stopped' as const,
                          runtime: null,
                          activationId: null,
                          blockCode: timeLimitReached ? 'activation-time-limit' : report.reason,
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
        packageDigest: descriptor.artifact.packageDigest,
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
        contributionReadiness: { pane: 'pending', sidebar: 'pending', tools: 'not-required' },
        degradedContributions: [],
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
        packageDigest: descriptor.artifact.packageDigest,
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
        contributionReadiness: { pane: 'failed', sidebar: 'failed', tools: 'not-required' },
        degradedContributions: [],
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

/** Host drafts survive surface remounts, but never source removal or workspace teardown. */
const clientDrafts = new Map<string, Map<string, {
    workspaceId: string;
    values: Record<string, string | boolean>;
    dirty: Set<string>;
    viewKey?: string | null;
}>>();

export function getPortableClientDraft(pluginId: string, workspaceId: string, surface: string) {
    let surfaces = clientDrafts.get(pluginId);
    if (!surfaces) {
        surfaces = new Map();
        clientDrafts.set(pluginId, surfaces);
    }
    let draft = surfaces.get(surface);
    if (!draft || draft.workspaceId !== workspaceId) {
        draft = { workspaceId, values: reactive({}), dirty: new Set(), viewKey: activations.get(pluginId)?.view?.key };
        surfaces.set(surface, draft);
    }
    return draft;
}

export function setPortableClientSource(source: PortableClientSource): void {
    for (const [id, surfaces] of clientDrafts) {
        if ([...surfaces.values()].some((draft) => draft.workspaceId !== source.workspaceId)) {
            clientDrafts.delete(id);
        }
    }
    clientSources.set(source.descriptor.id, source);
}

export function removePortableClientSource(pluginId: string): void {
    clientSources.delete(pluginId);
    clientDrafts.delete(pluginId);
    cancelPortableClientRecovery(pluginId);
}

export function clearPortableClientSources(): void {
    clientSources.clear();
    clientDrafts.clear();
    for (const key of [...recoveryTimers.keys()]) {
        clearTimeout(recoveryTimers.get(key));
        recoveryTimers.delete(key);
    }
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

/** Explicit recovery always refreshes the authoritative source and reauthorizes. */
export async function restartPortableClient(pluginId: string): Promise<PortableActivation> {
    const source = clientSources.get(pluginId);
    if (!source) throw new Error('This plugin is unavailable in the current workspace.');
    const response = await fetch('/api/plugins/runtime-manifest', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('The plugin state could not be refreshed. Try again.');
    const manifest = await response.json() as import('~~/shared/plugins/runtime-manifest').PluginRuntimeManifestResponse;
    if (clientSources.get(pluginId) !== source || manifest.workspaceId !== source.workspaceId) {
        throw new Error('The workspace or plugin selection changed.');
    }
    const entry = manifest.runtime[pluginId];
    if (!manifest.enabledPluginIds.includes(pluginId) || !entry?.loadAllowed ||
        entry.descriptorStatus !== 'ready' || entry.descriptor.manifestVersion !== 2) {
        throw new Error('The host no longer permits this plugin to run.');
    }
    const fresh = { workspaceId: source.workspaceId, descriptor: entry.descriptor, runtimeEntry: entry };
    setPortableClientSource(fresh);
    return activatePortableClient(fresh);
}

/**
 * Stop codes a silent restart can plausibly clear: the activation handle itself
 * expired, was revoked or was superseded by a host/package change. Containment,
 * quota, grant-review and access failures are terminal for automatic recovery:
 * they either need the user or would repeat identically, so they are not on the
 * allowlist.
 */
export const RECOVERABLE_PORTABLE_STOP_CODES: ReadonlySet<string> = new Set([
    'activation-unknown',
    'activation-expired',
    'activation-revoked',
    'activation-stale',
    'activation-time-limit',
]);

export function isRecoverablePortableStop(code: string | null | undefined): boolean {
    return typeof code === 'string' && RECOVERABLE_PORTABLE_STOP_CODES.has(code);
}

/**
 * Rolling recovery budget per plugin in one workspace. Attempts are counted
 * when they are scheduled and are never reset by a successful restart, so a
 * plugin that starts and immediately stops again cannot recover forever; the
 * window still lets an occasional host restart recover without user action.
 */
const PORTABLE_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_PORTABLE_RECOVERY_ATTEMPTS = 3;
const recoveryAttempts = new Map<string, number[]>();

function recoveryKey(pluginId: string, workspaceId: string): string {
    return `${workspaceId}\u0000${pluginId}`;
}

export function claimPortableRecoveryAttempt(
    pluginId: string,
    workspaceId: string
): { readonly allowed: boolean; readonly attempt: number } {
    const key = recoveryKey(pluginId, workspaceId);
    const now = Date.now();
    const recent = (recoveryAttempts.get(key) ?? []).filter(
        (at) => now - at < PORTABLE_RECOVERY_WINDOW_MS
    );
    if (recent.length >= MAX_PORTABLE_RECOVERY_ATTEMPTS) {
        recoveryAttempts.set(key, recent);
        return { allowed: false, attempt: recent.length };
    }
    recent.push(now);
    recoveryAttempts.set(key, recent);
    return { allowed: true, attempt: recent.length };
}

const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedule one silent restart for a stopped activation whose failure is
 * transient. Recovery is centralized here, not per surface: one timer per
 * plugin and workspace, a rolling attempt budget shared by every surface, and
 * the allowlist above. The timer re-checks the live activation before it fires,
 * so an activation that recovered meanwhile (or a workspace that changed) is
 * never restarted twice.
 */
export function schedulePortableClientRecovery(pluginId: string): boolean {
    const current = activations.get(pluginId);
    const source = clientSources.get(pluginId);
    if (!current || current.status !== 'stopped' || !source) return false;
    if (!isRecoverablePortableStop(current.blockCode)) return false;
    if (source.workspaceId !== current.workspaceId) return false;
    const key = recoveryKey(pluginId, current.workspaceId);
    if (recoveryTimers.has(key)) return true;
    const claim = claimPortableRecoveryAttempt(pluginId, current.workspaceId);
    if (!claim.allowed) return false;
    recoveryTimers.set(
        key,
        setTimeout(() => {
            recoveryTimers.delete(key);
            const live = activations.get(pluginId);
            const liveSource = clientSources.get(pluginId);
            if (!live || live.status !== 'stopped' || !liveSource) return;
            if (live !== current || !isRecoverablePortableStop(live.blockCode)) return;
            if (liveSource.workspaceId !== current.workspaceId) return;
            const attempt = activatePortableClient(liveSource);
            const attemptEpoch = activationEpochs.get(pluginId);
            void attempt.catch((error) => {
                if (attemptEpoch === undefined || !holdsActivationEpoch(pluginId, attemptEpoch)) return;
                const failed = activations.get(pluginId);
                if (!failed || failed.workspaceId !== current.workspaceId || failed.status === 'active') return;
                if (failed.activationId) void revokeHostActivationHandle(failed.activationId);
                Object.assign(failed, {
                    status: 'stopped',
                    activationId: null,
                    runtime: null,
                    blockCode: 'recovery-failed',
                    blockMessage: 'The view could not reconnect. Your typed values are still here.',
                });
                if (import.meta.dev) console.warn('[portable-client] automatic recovery failed', pluginId, error);
            });
        }, 300 * claim.attempt)
    );
    return true;
}

/** Forget a plugin's pending recovery; a removed source must not restart. */
export function cancelPortableClientRecovery(pluginId: string): void {
    const suffix = `\u0000${pluginId}`;
    for (const [key, timer] of [...recoveryTimers]) {
        if (!key.endsWith(suffix)) continue;
        clearTimeout(timer);
        recoveryTimers.delete(key);
    }
}

/**
 * Stop the current activation. Claims the next epoch first, so an in-flight
 * start for the stopped activation cannot publish afterwards, and a caller that
 * lost the race cannot dispose a newer sandbox.
 */
export async function deactivatePortableClient(pluginId: string): Promise<void> {
    claimActivationEpoch(pluginId);
    cancelPortableClientRecovery(pluginId);
    const current = activations.get(pluginId);
    if (!current) return;
    const runtime = current.runtime;
    const activationId = current.activationId;
    Object.assign(current, {
        runtime: null,
        activationId: null,
        status: 'stopped',
        // An explicit teardown (logout, workspace switch, uninstall) is not a
        // transient failure: clearing the stop reason also keeps the recovery
        // watcher from scheduling a restart for a workspace the user left.
        blockCode: null,
        blockMessage: null,
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

/**
 * Host surface registrations live outside any single activation: the manifest
 * sync registers pane/sidebar per descriptor before the demand-driven sandbox
 * starts, and tears them down on replacement. This table records them keyed by
 * the verified descriptor, so a starting activation inherits the surfaces that
 * already settled for its exact bytes, and late surface reports only touch the
 * activation running the same descriptor in the same workspace.
 */
interface SurfaceRegistration {
    readonly descriptorKey: string;
    readonly workspaceId: string;
    readonly pane: PortableContributionReadiness;
    readonly sidebar: PortableContributionReadiness;
    /**
     * Tool discovery outcome for these bytes. Tool registrations live on the
     * host and survive an activation restart of the same descriptor, so a new
     * activation inherits the settled outcome instead of waiting for a
     * discovery run the registration path will not repeat.
     */
    readonly tools: PortableContributionReadiness;
    readonly toolsCode: string | null;
}

const surfaceRegistrations = new Map<string, SurfaceRegistration>();

function surfaceFor(
    descriptorKey: string,
    workspaceId: string
): SurfaceRegistration {
    return { descriptorKey, workspaceId, pane: 'pending', sidebar: 'pending', tools: 'pending', toolsCode: null };
}

/**
 * Record one host surface registration outcome. Pane and sidebar are required
 * surfaces; a `failed` entry prevents full readiness. Reports for a descriptor
 * the current activation does not run are kept for the next activation of
 * those bytes rather than applied to unrelated code.
 */
export function reportPortableContributionReadiness(
    pluginId: string,
    surface: PortableContributionSurface,
    status: 'ready' | 'failed',
    options: { readonly descriptorKey: string; readonly workspaceId: string; readonly code?: string } = {
        descriptorKey: '',
        workspaceId: '',
    }
): void {
    const { descriptorKey, workspaceId, code } = options;
    if (surface === 'tools') {
        reportToolReadiness(pluginId, status, descriptorKey, workspaceId, code);
        return;
    }
    const previous = surfaceRegistrations.get(pluginId);
    // A report for new bytes starts a fresh record: settled outcomes (tools
    // included) belong to one descriptor in one workspace, never carried over.
    const sameBytes =
        previous !== undefined &&
        previous.descriptorKey === descriptorKey &&
        previous.workspaceId === workspaceId;
    const base = previous && sameBytes ? previous : surfaceFor(descriptorKey, workspaceId);
    surfaceRegistrations.set(pluginId, { ...base, descriptorKey, workspaceId, [surface]: status });
    const current = activations.get(pluginId);
    if (
        current &&
        current.descriptorKey === descriptorKey &&
        current.workspaceId === workspaceId &&
        holdsActivationEpoch(pluginId, current.epoch)
    ) {
        update(pluginId, current.epoch, {
            contributionReadiness: { ...current.contributionReadiness, [surface]: status },
        });
    }
}

function reportToolReadiness(
    pluginId: string,
    status: 'ready' | 'failed',
    descriptorKey: string,
    workspaceId: string,
    code?: string
): void {
    const current = activations.get(pluginId);
    if (!current) return;
    if (descriptorKey && current.descriptorKey !== descriptorKey) return;
    if (workspaceId && current.workspaceId !== workspaceId) return;
    if (!holdsActivationEpoch(pluginId, current.epoch)) return;
    // Persist the settled outcome for the next activation of these bytes: the
    // host-side tool registrations it describes outlive an activation restart,
    // and the registration path does not rediscover them for an already
    // registered descriptor.
    if (descriptorKey && workspaceId) {
        const previous = surfaceRegistrations.get(pluginId);
        const sameBytes =
            previous !== undefined &&
            previous.descriptorKey === descriptorKey &&
            previous.workspaceId === workspaceId;
        const base = previous && sameBytes ? previous : surfaceFor(descriptorKey, workspaceId);
        surfaceRegistrations.set(pluginId, {
            ...base,
            descriptorKey,
            workspaceId,
            tools: status,
            toolsCode: status === 'failed' ? (code ?? null) : null,
        });
    }
    if (status === 'failed') {
        const entry = code ? `tools:${code}` : 'tools:discovery-failed';
        update(pluginId, current.epoch, {
            contributionReadiness: { ...current.contributionReadiness, tools: 'failed' },
            degradedContributions: current.degradedContributions.includes(entry)
                ? current.degradedContributions
                : [...current.degradedContributions, entry],
        });
        return;
    }
    update(pluginId, current.epoch, {
        contributionReadiness: { ...current.contributionReadiness, tools: 'ready' },
    });
}

/** Forget host surfaces when a source is stopped or replaced. */
export function clearPortableSurfaceRegistrations(pluginId: string): void {
    surfaceRegistrations.delete(pluginId);
}

/** Surfaces already settled for one descriptor, inherited at activation start. */
function inheritedReadiness(
    pluginId: string,
    descriptorKey: string,
    workspaceId: string,
    toolsRequired: boolean
): Record<PortableContributionSurface, PortableContributionReadiness> {
    const recorded = surfaceRegistrations.get(pluginId);
    const matches =
        recorded !== undefined &&
        recorded.descriptorKey === descriptorKey &&
        recorded.workspaceId === workspaceId;
    return {
        pane: matches ? recorded.pane : 'pending',
        sidebar: matches ? recorded.sidebar : 'pending',
        tools: !toolsRequired ? 'not-required' : matches ? recorded.tools : 'pending',
    };
}

/** Retained tool-degradation entry for an inherited failed discovery. */
function inheritedToolsDegradation(
    pluginId: string,
    descriptorKey: string,
    workspaceId: string
): readonly string[] {
    const recorded = surfaceRegistrations.get(pluginId);
    if (
        !recorded ||
        recorded.descriptorKey !== descriptorKey ||
        recorded.workspaceId !== workspaceId ||
        recorded.tools !== 'failed'
    ) {
        return [];
    }
    return [`tools:${recorded.toolsCode ?? 'discovery-failed'}`];
}

/**
 * Full readiness: the sandbox bootstrapped (`active`) and every applicable
 * host surface settled. Required surfaces (pane, sidebar) must be `ready`;
 * optional tools may be `ready`, `failed` (degraded) or `not-required`.
 */
export function isPortableActivationReady(activation: PortableActivation): boolean {
    if (activation.status !== 'active') return false;
    if (activation.contributionReadiness.pane !== 'ready') return false;
    if (activation.contributionReadiness.sidebar !== 'ready') return false;
    return activation.contributionReadiness.tools !== 'pending';
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
 * Immutable activation identity a content-bearing caller authorized before its
 * content-producing awaits. The handoff aborts when the live activation no
 * longer matches, so selected-document text authorized for one
 * workspace/generation can never land in a replacement runtime.
 */
export interface PortableUiEventTarget {
    readonly workspaceId: string;
    readonly packageDigest: string;
    readonly generation: number;
}

/**
 * Forward a UI event from a rendered view to the plugin. The plugin answers the
 * request and may render again; nothing is assumed about the outcome.
 *
 * When `expected` is supplied, the live activation must still carry the same
 * workspace, package digest and generation that authorized the content read;
 * any mismatch aborts instead of delivering to the replacement, and the call
 * is never retried automatically into the new generation.
 */
export async function invokePortableUiEvent(
    pluginId: string,
    payload: Readonly<Record<string, unknown>>,
    expected?: PortableUiEventTarget
): Promise<unknown> {
    const current = activations.get(pluginId);
    if (!current?.runtime) {
        throw new Error('Plugin is not active');
    }
    if (expected) {
        if (
            current.workspaceId !== expected.workspaceId ||
            current.packageDigest !== expected.packageDigest ||
            current.generation !== expected.generation
        ) {
            throw new Error('The plugin activation changed before the content could be delivered.');
        }
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
        packageDigest: entry.packageDigest,
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
        contributionReadiness: Object.freeze({ ...entry.contributionReadiness }),
        degradedContributions: Object.freeze([...entry.degradedContributions]),
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
