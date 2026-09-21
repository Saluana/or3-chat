/**
 * @module @or3/plugin-sdk/portable-runtime
 *
 * Purpose:
 * Run a `defineOr3Plugin()` definition inside the OR3 portable sandbox.
 *
 * The sandbox imports one module and never calls into it: there is no host in
 * the worker to construct a context. This adapter is that missing piece. It
 * creates the portable client, waits for the host bootstrap (which carries the
 * host-issued plugin identity, feature set and approved grants), builds the same
 * `PluginContext` a trusted plugin receives, and calls `setup`.
 *
 * Behavior:
 * - `settings.*` and `storage.*` become mediated host calls. Every call can be
 *   refused, and a refusal is returned as a `PluginResult` error, not thrown.
 * - `contributions.register()` for a dashboard card renders through the host's
 *   dashboard slot.
 * - `logger.*` is emitted as a bounded host-visible event.
 *
 * Constraints:
 * - No ambient capability: this module only touches the portable client.
 * - Identity, generation, features and grants always come from the host
 *   bootstrap payload, never from plugin input.
 * - Host termination is immediate: the host disposes the sandbox without a
 *   round trip, so `onCleanup` runs only for plugin-internal teardown.
 *
 * Non-Goals:
 * - Trusted-host plugins (they receive a host-constructed context directly).
 */

import type {
    Or3PluginDefinition,
    PluginContext,
    PluginContribution,
    PluginContributions,
    PluginFeatureNegotiation,
    PluginHooks,
    PluginLogger,
    PluginRegistrationHandle,
} from './contracts';
import { hostCreatedPluginContext } from './contracts';
import type { PluginManifestV2 } from './manifest';
import {
    createUnsupportedPluginClients,
    type PluginEventName,
    type PluginHostClients,
    type PluginWorkspaceChange,
} from './capabilities';
import type {
    PluginJsonValue,
    PluginSettingsClient,
    PluginStorageClient,
    PluginStorageListEntry,
    PluginStorageListOptions,
    PluginStoragePage,
    PluginStorageMutationOptions,
    PluginStorageRecord,
} from './clients';
import {
    pluginError,
    pluginOk,
    type PluginError,
    type PluginErrorCode,
    type PluginResult,
} from './results';
import { createPortableClient, type PortableClient, type PortableHostResult } from './portable';
import type { PortableUiView } from './ui';

/** Host→plugin bootstrap event; carries host-issued identity and negotiation. */
export const PORTABLE_BOOTSTRAP_EVENT = 'runtime.bootstrap';

/**
 * Acknowledgement the host waits for. Posting the bootstrap message only means
 * the sandbox is listening; this event means the plugin reached setup, so the
 * host can treat "started" as true rather than assumed.
 */
export const PORTABLE_BOOTSTRAP_READY_EVENT = 'runtime.bootstrap.ready';

/** Failure acknowledgement; the host records it instead of timing out. */
export const PORTABLE_BOOTSTRAP_FAILED_EVENT = 'runtime.bootstrap.failed';

/** Event name the host records plugin logs under. */
export const PORTABLE_LOG_EVENT = 'runtime.log';

/** Contribution kind the first portable profile renders as a dashboard card. */
export const PORTABLE_DASHBOARD_CONTRIBUTION_KIND = 'ui.dashboard.card';

export interface PortableBootstrapPayload {
    readonly pluginId?: string;
    readonly workspaceId?: string;
    readonly abiVersion?: number;
    readonly features?: readonly string[];
    readonly grants?: readonly string[];
    readonly session?: {
        readonly sessionId: string;
        readonly sourceId: string;
        readonly generation: number;
    };
}

export interface CreatePortablePluginOptions {
    /** Test seam: supply a client instead of creating the default one. */
    readonly client?: PortableClient;
    /**
     * Test seam: activate immediately with this bootstrap instead of waiting for
     * the host's `runtime.bootstrap` event.
     */
    readonly bootstrap?: PortableBootstrapPayload;
}

/**
 * The context a portable plugin receives in `setup()`. It is the standard
 * `PluginContext` plus `render`, the host-rendered view for the plugin's own
 * surface.
 */
export interface PortablePluginContext extends PluginContext {
    render(view: PortableUiView): void;
    /**
     * Answer a host→plugin request. The host uses this for user interaction with
     * a rendered view (form submit, button action), so a plugin can react and
     * render a new view instead of the host guessing what happened.
     */
    onRequest(
        method: string,
        handler: (params: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>
    ): () => void;
}

export interface PortablePluginHandle<TManifest extends PluginManifestV2 = PluginManifestV2> {
    /** The definition, so a package entry can still export it directly. */
    readonly definition: Or3PluginDefinition<TManifest>;
    readonly manifest: TManifest;
    readonly setup: Or3PluginDefinition<TManifest>['setup'];
    /** Resolves once setup() has run, or rejects when activation failed. */
    readonly ready: Promise<void>;
    readonly context: () => PortablePluginContext | null;
    readonly active: () => boolean;
}

const HOST_ERROR_CODES: Readonly<Record<string, PluginErrorCode>> = Object.freeze({
    'permission-denied': 'permission-denied',
    'policy-denied': 'permission-denied',
    'not-found': 'not-found',
    'invalid-input': 'invalid-input',
    conflict: 'conflict',
    unsupported: 'unsupported',
    locked: 'locked',
    'stale-context': 'stale-context',
    'budget-exceeded': 'quota-exceeded',
    'deadline-exceeded': 'timeout',
    cancelled: 'aborted',
    aborted: 'aborted',
    'network-failure': 'network-error',
    unavailable: 'host-unavailable',
});

function toPluginError(
    result: Extract<PortableHostResult<unknown>, { ok: false }>
): PluginError {
    return {
        code: HOST_ERROR_CODES[result.code] ?? 'internal',
        message: result.message,
        retryable: result.code === 'network-failure' || result.code === 'unavailable',
    };
}

/** A grant that was not approved is refused before the host is even called. */
function refusedGrant(grant: string): PluginError {
    return {
        code: 'permission-denied',
        message: `Grant ${grant} was not approved`,
        retryable: false,
    };
}

/**
 * Turn a mediated host call into a `PluginResult`. A refusal is data, not an
 * exception, so plugin code can branch on it without try/catch around every
 * host interaction.
 */
async function call<T = unknown>(
    client: PortableClient,
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    options: { readonly deadlineMs?: number } = {}
): Promise<PluginResult<T>> {
    const result = await client.call<T>(method, params, options);
    if (result.ok) return pluginOk(result.result);
    return { ok: false, error: toPluginError(result) };
}

function readValue<T>(result: unknown): T | null {
    if (!result || typeof result !== 'object') return null;
    const value = (result as { value?: unknown }).value;
    return (value ?? null) as T | null;
}

function readonlySet<T>(values: readonly T[]): ReadonlySet<T> {
    const set = new Set(values);
    const facade = {
        get size() {
            return set.size;
        },
        has: (value: T) => set.has(value),
        forEach: (
            callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
            thisArg?: unknown
        ) => set.forEach((value) => callback.call(thisArg, value, value, facade)),
        entries: () => set.entries(),
        keys: () => set.keys(),
        values: () => set.values(),
        [Symbol.iterator]: () => set[Symbol.iterator](),
    } as ReadonlySet<T>;
    return Object.freeze(facade);
}

function notifyEventListener(
    listener: (payload: never) => void | Promise<void>,
    payload: never
): void {
    try {
        const result = listener(payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
            void (result as Promise<void>).catch(() => undefined);
        }
    } catch {
        // Event subscribers cannot affect host delivery or other subscribers.
    }
}

function validEventPayload(name: PluginEventName, payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const value = payload as Record<string, unknown>;
    switch (name) {
        case 'workspace.changed':
            return (
                typeof value.previousId === 'string' &&
                typeof value.id === 'string' &&
                (value.reason === 'user' || value.reason === 'restore' || value.reason === 'host')
            );
        case 'settings.changed':
            return (
                typeof value.key === 'string' &&
                Number.isSafeInteger(value.revision) &&
                (value.revision as number) >= 0 &&
                typeof value.deleted === 'boolean'
            );
        case 'chat.created':
            return typeof value.chatId === 'string' &&
                (value.title === undefined || typeof value.title === 'string');
        case 'chat.message.created':
            return (
                typeof value.chatId === 'string' &&
                typeof value.messageId === 'string' &&
                (value.role === 'user' || value.role === 'assistant' || value.role === 'system' || value.role === 'tool')
            );
        case 'connections.changed':
            return Number.isSafeInteger(value.revision) && (value.revision as number) >= 0;
        case 'host.resumed':
            return typeof value.at === 'number' && Number.isFinite(value.at);
    }
}

/**
 * Resolve a plugin definition into a runnable portable client. Returns a handle
 * whose `definition` is the original definition, so a package entry still
 * exports it; activation runs in the background because the sandbox imports the
 * module and cannot await.
 */
export function createPortablePlugin<const TManifest extends PluginManifestV2>(
    definition: Or3PluginDefinition<TManifest>,
    options: CreatePortablePluginOptions = {}
): PortablePluginHandle<TManifest> {
    const client = options.client ?? createPortableClient();

    let context: PortablePluginContext | null = null;
    let active = false;
    let settled = false;
    let activationController: AbortController | null = null;
    const cleanups: Array<() => void | Promise<void>> = [];
    const activations: Array<() => void | Promise<void>> = [];
    const contributionDisposers = new Map<string, () => void>();

    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: unknown) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // An unconsumed rejection must not crash the worker.
    ready.catch(() => undefined);

    const logger: PluginLogger = Object.freeze({
        debug: (message: string, data?: Readonly<Record<string, unknown>>) =>
            emitLog('debug', message, data),
        info: (message: string, data?: Readonly<Record<string, unknown>>) =>
            emitLog('info', message, data),
        warn: (message: string, data?: Readonly<Record<string, unknown>>) =>
            emitLog('warn', message, data),
        error: (message: string, data?: Readonly<Record<string, unknown>>) =>
            emitLog('error', message, data),
    });

    function emitLog(
        level: 'debug' | 'info' | 'warn' | 'error',
        message: string,
        data?: Readonly<Record<string, unknown>>
    ): void {
        client.emit(PORTABLE_LOG_EVENT, {
            level,
            message: String(message).slice(0, 2_000),
            ...(data === undefined ? {} : { data }),
        });
    }

    function createContributions(grants: ReadonlySet<string>): PluginContributions {
        return {
            register<TDefinition>(
                contribution: PluginContribution<TDefinition>
            ): PluginRegistrationHandle {
                if (contribution.kind !== PORTABLE_DASHBOARD_CONTRIBUTION_KIND) {
                    throw new Error(
                        `The portable profile renders ${PORTABLE_DASHBOARD_CONTRIBUTION_KIND} only; "${contribution.kind}" needs a wider host surface.`
                    );
                }
                if (!grants.has('ui.dashboard.register')) {
                    throw new Error('Grant ui.dashboard.register was not approved');
                }
                if (contributionDisposers.has(contribution.id)) {
                    throw new Error(`Contribution ${contribution.id} is already registered`);
                }
                const view = contribution.definition as unknown;
                if (!isPortableView(view)) {
                    throw new Error(
                        'A dashboard contribution must be a PortableUiView ({ title?, nodes })'
                    );
                }
                client.contribute('dashboard', contribution.id, view);
                const dispose = () => {
                    contributionDisposers.delete(contribution.id);
                    client.withdraw(contribution.id);
                };
                contributionDisposers.set(contribution.id, dispose);
                return { dispose };
            },
        };
    }

    function grantGuard(
        grants: ReadonlySet<string>,
        grant: string
    ): PluginError | null {
        return grants.has(grant) ? null : refusedGrant(grant);
    }

    function createSettingsClient(grants: ReadonlySet<string>): PluginSettingsClient {
        return {
            async get<T extends PluginJsonValue = PluginJsonValue>(key: string) {
                const denied = grantGuard(grants, 'settings.read');
                if (denied) return { ok: false, error: denied };
                const result = await call<{ value: T | null }>(client, 'settings.get', { key });
                return result.ok ? pluginOk(readValue<T>(result.value)) : result;
            },
            async list() {
                const denied = grantGuard(grants, 'settings.read');
                if (denied) return { ok: false, error: denied };
                const result = await call<{ values?: Record<string, PluginJsonValue> }>(
                    client,
                    'settings.list'
                );
                if (!result.ok) return result;
                const values = result.value.values;
                return pluginOk(
                    values && typeof values === 'object' ? values : ({} as Record<string, PluginJsonValue>)
                );
            },
            async set(key: string, value: PluginJsonValue) {
                const denied = grantGuard(grants, 'settings.write');
                if (denied) return { ok: false, error: denied };
                const result = await call<void>(client, 'settings.set', { key, value });
                return result.ok ? pluginOk(undefined) : result;
            },
            async delete(key: string) {
                const denied = grantGuard(grants, 'settings.write');
                if (denied) return { ok: false, error: denied };
                const result = await call<void>(client, 'settings.delete', { key });
                return result.ok ? pluginOk(undefined) : result;
            },
        };
    }

    function createStorageClient(grants: ReadonlySet<string>): PluginStorageClient {
        return {
            async get<T extends PluginJsonValue = PluginJsonValue>(key: string) {
                const denied = grantGuard(grants, 'storage.read');
                if (denied) return { ok: false, error: denied };
                const result = await call<{ value: T | null }>(client, 'storage.get', { key });
                return result.ok ? pluginOk(readValue<T>(result.value)) : result;
            },
            async getRecord<T extends PluginJsonValue = PluginJsonValue>(key: string) {
                const denied = grantGuard(grants, 'storage.read');
                if (denied) return { ok: false, error: denied };
                const result = await call<PluginStorageRecord<T>>(client, 'storage.getRecord', { key });
                return result.ok ? pluginOk(result.value) : result;
            },
            async set(key: string, value: PluginJsonValue, options?: PluginStorageMutationOptions) {
                const denied = grantGuard(grants, 'storage.write');
                if (denied) return { ok: false, error: denied };
                const result = await call<void>(client, 'storage.set', {
                    key,
                    value,
                    ...(options?.ifRevision === undefined ? {} : { ifRevision: options.ifRevision }),
                });
                return result.ok ? pluginOk(undefined) : result;
            },
            async delete(key: string) {
                const denied = grantGuard(grants, 'storage.write');
                if (denied) return { ok: false, error: denied };
                const result = await call<void>(client, 'storage.delete', { key });
                return result.ok ? pluginOk(undefined) : result;
            },
            async list(prefix?: string) {
                const denied = grantGuard(grants, 'storage.read');
                if (denied) return { ok: false, error: denied };
                const result = await call<{ entries?: readonly PluginStorageListEntry[] }>(
                    client,
                    'storage.list',
                    prefix === undefined ? {} : { prefix }
                );
                if (!result.ok) return result;
                const entries = result.value.entries;
                return pluginOk(Array.isArray(entries) ? entries : ([] as PluginStorageListEntry[]));
            },
            async listPage(options: PluginStorageListOptions = {}) {
                const denied = grantGuard(grants, 'storage.read');
                if (denied) return { ok: false, error: denied };
                const result = await call<PluginStoragePage>(
                    client,
                    'storage.listPage',
                    options as unknown as Readonly<Record<string, unknown>>
                );
                return result.ok ? pluginOk(result.value) : result;
            },
        };
    }

    function createClients(
        grants: ReadonlySet<string>,
        bootstrap: PortableBootstrapPayload
    ): PluginHostClients {
        const workspaceId = bootstrap.workspaceId ?? 'portable';
        const base = createUnsupportedPluginClients({ workspaceId });
        const allowedAi = (grant: string) =>
            grants.has(grant) || grants.has('network.http');
        const requireRegistrationGrant = (grant: string): void => {
            const denied = grantGuard(grants, grant);
            if (denied) throw new Error(denied.message);
        };
        const events = {
            on(name: PluginEventName, listener: (payload: never) => void | Promise<void>) {
                requireRegistrationGrant('events.register');
                const unsubscribe = client.onEvent((event) => {
                    if (event.name !== name) return;
                    if (!validEventPayload(name, event.payload)) return;
                    notifyEventListener(listener, event.payload as never);
                });
                let disposed = false;
                const dispose = () => {
                    if (disposed) return;
                    disposed = true;
                    unsubscribe();
                };
                cleanups.push(dispose);
                return { dispose };
            },
        } as PluginHostClients['events'];
        const workspaceOnChange = (
            listener: (payload: PluginWorkspaceChange) => void | Promise<void>
        ): PluginRegistrationHandle => {
            requireRegistrationGrant('workspace.read');
            const unsubscribe = client.onEvent((event) => {
                if (event.name !== 'workspace.changed') return;
                if (!validEventPayload('workspace.changed', event.payload)) return;
                notifyEventListener(
                    listener as (payload: never) => void | Promise<void>,
                    event.payload as never
                );
            });
            let disposed = false;
            const dispose = () => {
                if (disposed) return;
                disposed = true;
                unsubscribe();
            };
            cleanups.push(dispose);
            return { dispose };
        };
        return {
            ...base,
            ai: {
                models: async () => {
                    const denied = allowedAi('ai.models') ? null : refusedGrant('ai.models');
                    if (denied) return { ok: false, error: denied };
                    return call(client, 'ai.models');
                },
                complete: async (input) => {
                    const denied = allowedAi('ai.complete') ? null : refusedGrant('ai.complete');
                    if (denied) return { ok: false, error: denied };
                    return call(client, 'ai.complete', input as unknown as Readonly<Record<string, unknown>>);
                },
            },
            events,
            workspace: {
                ...base.workspace,
                id: workspaceId,
                onChange: workspaceOnChange,
                switch: async (id) => {
                    const denied = grantGuard(grants, 'workspace.switch');
                    if (denied) return { ok: false, error: denied };
                    const result = await call<{ id: string }>(client, 'workspace.switch', { id });
                    return result.ok ? pluginOk(result.value) : result;
                },
            },
        };
    }

    function buildContext(bootstrap: PortableBootstrapPayload): PortablePluginContext {
        const grants = readonlySet(bootstrap.grants ?? []);
        const features = readonlySet(bootstrap.features ?? []);
        const controller = new AbortController();
        activationController = controller;
        const featureNegotiation: PluginFeatureNegotiation = {
            has: (feature: string) => features.has(feature),
            require: (feature: string) => {
                if (!features.has(feature)) {
                    throw new Error(`Required host feature is unavailable: ${feature}`);
                }
            },
            optional: (feature: string) => features.has(feature),
            available: features,
        };
        const hooks: PluginHooks = {
            onAction: () => {
                throw new Error('The portable profile does not support host hooks yet');
            },
            onFilter: () => {
                throw new Error('The portable profile does not support host hooks yet');
            },
        };
        const built = {
            [hostCreatedPluginContext]: true as const,
            pluginId: bootstrap.pluginId ?? definition.manifest.id,
            version: definition.manifest.version,
            generation: bootstrap.session?.generation ?? 0,
            trust: definition.manifest.trust,
            grants,
            signal: controller.signal,
            logger,
            features: featureNegotiation,
            hooks,
            contributions: createContributions(grants),
            settings: createSettingsClient(grants),
            storage: createStorageClient(grants),
            ...createClients(grants, bootstrap),
            onCleanup(callback: () => void | Promise<void>) {
                cleanups.push(callback);
            },
            onActivate(callback: () => void | Promise<void>) {
                activations.push(callback);
            },
            render(view: PortableUiView) {
                if (!isPortableView(view)) {
                    throw new Error('render() requires a PortableUiView ({ title?, nodes })');
                }
                client.render(view);
            },
            onRequest(
                method: string,
                handler: (params: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>
            ) {
                const unsubscribe = client.onRequest(method, handler);
                cleanups.push(unsubscribe);
                return unsubscribe;
            },
        };
        return built as unknown as PortablePluginContext;
    }

    async function runCleanups(): Promise<void> {
        active = false;
        activationController?.abort('plugin activation stopped');
        activationController = null;
        for (const callback of [...cleanups].reverse()) {
            try {
                await callback();
            } catch {
                // A failing cleanup must not prevent the remaining ones.
            }
        }
        cleanups.length = 0;
        for (const dispose of [...contributionDisposers.values()]) {
            try {
                dispose();
            } catch {
                // Withdrawal is best-effort; the host also drops contributions
                // when it terminates the sandbox.
            }
        }
        contributionDisposers.clear();
    }

    async function activate(bootstrap: PortableBootstrapPayload): Promise<void> {
        if (settled) return;
        settled = true;
        try {
            context = buildContext(bootstrap);
            await definition.setup(context);
            for (const callback of activations) await callback();
            active = true;
            // Acknowledge only after setup and activations succeed, so a host that
            // waits for this never records a failed activation as ready.
            client.emit(PORTABLE_BOOTSTRAP_READY_EVENT, {});
            resolveReady();
        } catch (error) {
            await runCleanups();
            rejectReady(error);
            const message = error instanceof Error ? error.message : String(error);
            client.emit(PORTABLE_BOOTSTRAP_FAILED_EVENT, {
                code: 'activation-failed',
                message,
            });
            logger.error('Portable plugin activation failed', { message });
        }
    }

    client.onEvent((event) => {
        if (event.name === PORTABLE_BOOTSTRAP_EVENT) {
            void activate(event.payload as PortableBootstrapPayload);
        }
    });

    if (options.bootstrap) {
        void activate(options.bootstrap);
    }

    return {
        definition,
        manifest: definition.manifest,
        setup: definition.setup,
        ready,
        context: () => context,
        active: () => active,
    };
}

function isPortableView(value: unknown): value is PortableUiView {
    return Boolean(
        value && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes)
    );
}
