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

import { reactive, readonly } from 'vue';
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
    startPortableWorker,
} from '~~/shared/plugins/isolation/portable-bootstrap';
import { PORTABLE_FRAME_CSP } from '~~/shared/plugins/isolation/containment-policy';
import {
    PORTABLE_FRAME_SANDBOX,
    PORTABLE_FRAME_URL,
    type HostFrameElementPort,
} from '~~/shared/plugins/isolation/portable-frame-transport';
import {
    REMOTE_CAPABILITY_METHODS,
    createHttpCapabilityTransport,
    createRemoteCapabilityMethods,
} from '~~/shared/plugins/isolation/capability-bridge';
import { resolvePackageDescriptor } from '~~/shared/plugins/descriptor-resolver';

export type PortableActivationStatus =
    | 'starting'
    | 'active'
    | 'blocked'
    | 'stopped';

export interface PortableRenderedView {
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
    readonly logs: readonly PortableLogEntry[];
    readonly crashed: boolean;
    readonly startedAt: number | null;
}

interface InternalActivation extends PortableActivation {
    runtime: WorkerIsolationRuntime | null;
}

const MAX_LOGS = 50;

/** Rendered UI is display-only until a host request answers an action. */
export const PORTABLE_UI_EVENT_REQUEST = 'runtime.ui-event';

const activations = reactive(new Map<string, InternalActivation>());
let generationCounter = 0;
let listenerInstalled = false;

/** Engine detection drives `assessPortableHost`; unqualified engines stay blocked. */
export function detectBrowserEngine(userAgent?: string): string {
    const agent =
        userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
    if (/Firefox\//.test(agent)) return 'firefox';
    if (/Edg\/|Chrome\/|Chromium\//.test(agent)) return 'chromium';
    if (/Safari\//.test(agent)) return 'webkit';
    return 'unknown';
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
 * Settings are workspace-scoped package settings: the same validated document
 * the setup page edits, so a plugin cannot invent keys or write secrets.
 */
export function createPortableSettingsServices(pluginId: string): {
    readonly settings: {
        readonly get: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly set: (params: Readonly<Record<string, unknown>>) => Promise<unknown>;
        readonly list: () => Promise<unknown>;
        readonly delete: () => Promise<unknown>;
    };
} {
    const loadValues = async (): Promise<Record<string, unknown>> => {
        // A plain `string` URL keeps Nuxt's typed-route inference out of a
        // runtime-composed path.
        const url: string = `/api/plugins/${pluginId}/setup-plan`;
        const plan = (await ($fetch as unknown as (input: string) => Promise<unknown>)(
            url
        )) as { values?: Record<string, unknown> };
        return plan.values ?? {};
    };
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
                const url: string = `/api/plugins/${pluginId}/setup-values`;
                await (
                    $fetch as unknown as (
                        input: string,
                        options: Record<string, unknown>
                    ) => Promise<unknown>
                )(url, {
                    method: 'POST',
                    headers: { 'x-or3-plugin-intent': 'plugin' },
                    body: { values: { [key]: params.value ?? null } },
                });
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
    };
}

function readGrants(descriptor: PackageV2PluginDescriptor) {
    return {
        requestedGrants: [...descriptor.effectiveGrants],
        approvedGrants: [...descriptor.effectiveGrants],
        revision: descriptor.grantsRevision,
        status: 'current' as const,
    };
}

function update(pluginId: string, patch: Partial<InternalActivation>): void {
    const current = activations.get(pluginId);
    if (!current) return;
    Object.assign(current, patch);
}

function recordEvent(pluginId: string, event: HostPluginEvent): void {
    const current = activations.get(pluginId);
    if (!current) return;
    if (event.status === 'rendered') {
        update(pluginId, { view: { title: event.title, nodes: event.nodes } });
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
        update(pluginId, { contributions: next });
        return;
    }
    if (event.status === 'withdrawn') {
        const removed = new Set(event.contributionIds);
        update(pluginId, {
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
        update(pluginId, { logs });
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

    if (input.runtimeEntry !== undefined) {
        const resolution = await resolvePackageDescriptor({
            pluginId,
            workspaceId,
            runtimeEntry: input.runtimeEntry,
            requireClientEntry: true,
        });
        if (resolution.status === 'blocked') {
            return recordBlocked(pluginId, descriptor, workspaceId, resolution.failure.code, resolution.failure.message);
        }
    }

    const clientEntry = descriptor.artifact.client;
    if (!clientEntry) {
        return recordBlocked(
            pluginId,
            descriptor,
            workspaceId,
            'catalog-artifact-mismatch',
            'The selected package has no digest-addressed client entry'
        );
    }

    generationCounter += 1;
    const generation = generationCounter;
    const base: InternalActivation = {
        pluginId,
        version: descriptor.version,
        workspaceId,
        generation,
        descriptorKey: descriptor.descriptorKey,
        status: 'starting',
        blockCode: null,
        blockMessage: null,
        view: null,
        contributions: [],
        capabilities: [],
        logs: [],
        crashed: false,
        startedAt: Date.now(),
        runtime: null,
    };
    activations.set(pluginId, base);

    const grants = readGrants(descriptor);
    const moduleUrl = `/api/plugins/packages/${encodeURIComponent(pluginId)}/${descriptor.artifact.packageDigest}/${clientEntry.entry}`;
    const transport = createHttpCapabilityTransport();
    // The capability echo needs the host-issued session, which only exists after
    // the sandbox started; a call before then is refused rather than guessed.
    let session: { readonly sessionId: string; readonly sourceId: string } | null = null;

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
        services: createPortableSettingsServices(pluginId),
        methods: createRemoteCapabilityMethods({
            transport,
            session: () => {
                if (!session) {
                    throw Object.assign(new Error('Sandbox session is not established yet'), {
                        rpcCode: 'unavailable',
                    });
                }
                return {
                    pluginId,
                    workspaceId,
                    generation,
                    sessionId: session.sessionId,
                    sourceId: session.sourceId,
                };
            },
            grants,
            capabilities: Object.values(REMOTE_CAPABILITY_METHODS),
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
        onEvent: (event) => recordEvent(pluginId, event),
        onCrash: (report) => {
            // A fatal crash terminates the sandbox, so the activation is no
            // longer active; a non-fatal containment violation is recorded.
            update(pluginId, {
                crashed: report.fatal,
                ...(report.fatal
                    ? {
                          status: 'stopped' as const,
                          runtime: null,
                          blockCode: report.reason,
                      }
                    : {}),
            });
        },
    });

    if (started.status === 'blocked') {
        return recordBlocked(
            pluginId,
            descriptor,
            workspaceId,
            started.codes[0] ?? 'bootstrap-failed',
            started.message,
            generation
        );
    }

    session = started.session;
    update(pluginId, {
        status: 'active',
        runtime: started.runtime,
        capabilities: started.runtime.capabilities,
    });
    return snapshot(pluginId);
}

function recordBlocked(
    pluginId: string,
    descriptor: PackageV2PluginDescriptor,
    workspaceId: string,
    blockCode: string,
    blockMessage: string,
    generation = 0
): PortableActivation {
    const activation: InternalActivation = {
        pluginId,
        version: descriptor.version,
        workspaceId,
        generation,
        descriptorKey: descriptor.descriptorKey,
        status: 'blocked',
        blockCode,
        blockMessage,
        view: null,
        contributions: [],
        capabilities: [],
        logs: [],
        crashed: false,
        startedAt: null,
        runtime: null,
    };
    activations.set(pluginId, activation);
    return snapshot(pluginId);
}

export async function deactivatePortableClient(pluginId: string): Promise<void> {
    const current = activations.get(pluginId);
    if (!current) return;
    const runtime = current.runtime;
    update(pluginId, { runtime: null, status: 'stopped', contributions: [], view: null });
    runtime?.dispose();
}

export function stopAllPortableClients(): void {
    for (const pluginId of [...activations.keys()]) {
        void deactivatePortableClient(pluginId);
    }
    if (listenerInstalled && typeof window !== 'undefined') {
        window.removeEventListener('pagehide', stopAllPortableClients);
        listenerInstalled = false;
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
        logs: Object.freeze([...entry.logs]),
        crashed: entry.crashed,
        startedAt: entry.startedAt,
    });
}
