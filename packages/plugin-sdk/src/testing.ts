import type {
    PluginJsonValue,
    PluginSettingsClient,
    PluginStorageMutationOptions,
    PluginStorageClient,
} from './clients';
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
import {
    createUnsupportedPluginClients,
    type PluginActivitySource,
    type PluginCommandDefinition,
    type PluginCommandHandler,
    type PluginCommandInvocation,
    type PluginEventMap,
    type PluginEventName,
    type PluginFileRef,
    type PluginFileRead,
    type PluginHostClients,
    type PluginProgressHandle,
    type PluginPaneRef,
    type PluginUiSurface,
    type PluginSecretRef,
    type PluginSecretState,
    type PluginChatRef,
    type PluginChatMessage,
} from './capabilities';
import { createHostPluginContext, type HostPluginScope } from './host';
import type { PluginError, PluginErrorCode, PluginResult } from './results';
import { pluginError, pluginOk } from './results';
import type { PluginGrant } from './manifest';
import type { PortableClient, PortableHostResult } from './portable';
import type { PortableUiView } from './ui';
import {
    validatePluginPaneDefinition,
    validatePluginPaneOpenInput,
} from './pane-schema';
import {
    validatePluginSecretKey,
    validatePluginSecretValue,
} from './secret-schema';
import { validatePluginChatMessage } from './chat-schema';
import { validatePluginFileRef } from './file-schema';

export type PluginTestCapability = 'settings' | 'storage' | 'workspace';

export interface PluginTestFile extends PluginFileRef {
    readonly data: Uint8Array;
}

export interface PluginTestHostOptions {
    /** Optional owner for the initial fixture state; otherwise first install owns it. */
    readonly pluginId?: string;
    readonly approvedGrants?: readonly PluginGrant[];
    readonly supportedFeatures?: readonly string[];
    readonly workspaceId?: string;
    readonly initialSettings?: Readonly<Record<string, PluginJsonValue>>;
    readonly settingsDefaults?: Readonly<Record<string, PluginJsonValue>>;
    readonly initialStorage?: Readonly<Record<string, PluginJsonValue>>;
    readonly initialSecrets?: Readonly<Record<string, string>>;
    readonly initialFiles?: readonly PluginTestFile[];
    readonly confirmResult?: boolean;
}

export interface PluginTestHostSnapshot {
    readonly active: boolean;
    readonly workspaceId: string;
    readonly generation: number;
    readonly contributionCount: number;
    readonly hookCount: number;
    readonly cleanupCount: number;
    readonly palettePostSources: readonly PluginContribution[];
    readonly paletteCommands: readonly PluginContribution[];
    readonly panes: readonly PluginPaneRef[];
    readonly commands: readonly string[];
    readonly uiRegistrations: readonly Readonly<{
        readonly surface: PluginUiSurface;
        readonly id: string;
    }>[];
    readonly activitySources: readonly Readonly<{
        readonly id: string;
        readonly label: string;
    }>[];
}

export type PluginTestActivationResult = PluginResult<{
    readonly context: PluginContext;
    readonly generation: number;
}>;

function asFailure<T>(result: PluginResult<never>): PluginResult<T> {
    return result;
}

function errorResult(code: PluginErrorCode, message: string): PluginResult<never> {
    return pluginError(code, message);
}

/**
 * Storage cursors use the same UTF-16 code-unit ordering as the host's
 * namespaced KV adapter. Keep the comparison explicit so filtering and
 * sorting cannot silently drift between the harness and portable host.
 */
function comparePluginStorageKeys(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function isUint8Chunk(value: unknown): value is Uint8Array {
    if (value instanceof Uint8Array) return true;
    return Boolean(
        value &&
            typeof value === 'object' &&
            ArrayBuffer.isView(value) &&
            value.constructor?.name === 'Uint8Array'
    );
}

const logger: PluginLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

function notifyPluginListener<T>(
    listener: (payload: T) => void | Promise<void>,
    payload: T
): void {
    try {
        const result = listener(payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
            void (result as Promise<void>).catch(() => undefined);
        }
    } catch {
        // A subscriber cannot abort a host lifecycle transition or another
        // subscriber's delivery. Recovery is a fresh snapshot, not a replay.
    }
}

export class PluginTestHost {
    readonly #settingsByWorkspace = new Map<string, Map<string, PluginJsonValue>>();
    readonly #settingsDefaultsByWorkspace = new Map<string, Map<string, PluginJsonValue>>();
    readonly #settingsRevisionsByWorkspace = new Map<string, Map<string, number>>();
    readonly #storageByWorkspace = new Map<string, Map<string, PluginJsonValue>>();
    readonly #storageRevisionsByWorkspace = new Map<string, Map<string, number>>();
    readonly #storageUpdatedAtByWorkspace = new Map<string, Map<string, number>>();
    readonly #secretsByWorkspace = new Map<
        string,
        Map<string, { value: string; revision: number; persistence: 'memory' | 'session' | 'persistent' }>
    >();
    readonly #filesByWorkspace = new Map<string, Map<string, PluginTestFile>>();
    readonly #panes = new Map<string, PluginPaneRef & {
        data: PluginJsonValue;
        focused: boolean;
        ownerPluginId: string;
        ownerGeneration: number;
    }>();
    readonly #uiDefinitions = new Map<string, {
        readonly surface: PluginUiSurface;
        readonly id: string;
        readonly definition: PluginJsonValue;
    }>();
    readonly #commands = new Map<
        string,
        { definition: PluginCommandDefinition; handler: PluginCommandHandler; scope: HostPluginScope }
    >();
    readonly #chats = new Map<string, {
        pluginId: string;
        workspaceId: string;
        title?: string;
        messages: Map<string, PluginChatMessage>;
    }>();
    readonly #chatRequestIds = new Map<string, string>();
    readonly #eventListeners = new Map<PluginEventName, Set<(payload: never) => void | Promise<void>>>();
    readonly #workspaceListeners = new Set<
        (change: PluginEventMap['workspace.changed']) => void | Promise<void>
    >();
    readonly #activitySources = new Map<
        string,
        { readonly pluginId: string; readonly source: PluginActivitySource }
    >();
    readonly #supportedFeatures: Set<string>;
    readonly #failures = new Map<PluginTestCapability, PluginError>();
    readonly #initialWorkspaceId: string;
    readonly #initialSettings: Readonly<Record<string, PluginJsonValue>>;
    readonly #initialSettingsDefaults: Readonly<Record<string, PluginJsonValue>>;
    readonly #initialStorage: Readonly<Record<string, PluginJsonValue>>;
    readonly #initialSecrets: Readonly<Record<string, string>>;
    readonly #initialFiles: readonly PluginTestFile[];
    #initialStateOwner?: string;
    #approvedGrants: Set<PluginGrant>;
    #workspaceId: string;
    #cleanupSink?: Array<() => void | Promise<void>>;
    #nextPaneId = 0;
    #nextChatId = 0;
    #nextMessageId = 0;
    #confirmResult: boolean;
    #activeContext?: PluginContext;
    #workspaceSwitchTail: Promise<void> = Promise.resolve();
    #generation = 0;
    #activeGeneration?: number;
    #controller?: AbortController;
    #cleanups: Array<() => void | Promise<void>> = [];
    #contributionCount = 0;
    #hookCount = 0;
    #palettePostSources: PluginContribution[] = [];
    #paletteCommands: PluginContribution[] = [];
    #commandHandlers = new Map<
        string,
        () => Promise<unknown> | unknown
    >();
    #activeDefinition?: Or3PluginDefinition;

    /** Recommended ergonomic dispatch facade for plugin package tests. */
    readonly commands = Object.freeze({
        run: (commandId: string, data?: PluginJsonValue) => this.#runCommand(commandId, data),
    });
    readonly ui = Object.freeze({
        panes: () => Object.freeze([...this.#panes.values()].map(({ id, app, instanceKey }) => ({ id, app, instanceKey }))),
        registrations: () => Object.freeze(
            [...this.#uiDefinitions.values()].map(({ surface, id }) => ({ surface, id }))
        ),
    });
    readonly activity = Object.freeze({
        sources: () => Object.freeze(
            [...this.#activitySources.values()]
                .map(({ source }) => ({ id: source.id, label: source.label }))
                .sort((left, right) => left.id.localeCompare(right.id))
        ),
    });
    readonly storage = Object.freeze({
        get: <T extends PluginJsonValue = PluginJsonValue>(key: string) =>
            this.#activeContext?.storage.get<T>(key) ?? Promise.resolve(pluginError('host-unavailable', 'No plugin is installed')),
        set: (key: string, value: PluginJsonValue) =>
            this.#activeContext?.storage.set(key, value) ?? Promise.resolve(pluginError('host-unavailable', 'No plugin is installed')),
    });

    constructor(options: PluginTestHostOptions = {}) {
        this.#approvedGrants = new Set(options.approvedGrants ?? []);
        this.#supportedFeatures = new Set(options.supportedFeatures ?? []);
        this.#workspaceId = options.workspaceId ?? 'local';
        this.#initialWorkspaceId = this.#workspaceId;
        this.#initialStateOwner = options.pluginId;
        this.#initialSettings = options.initialSettings ?? {};
        this.#initialSettingsDefaults = options.settingsDefaults ?? {};
        this.#initialStorage = options.initialStorage ?? {};
        this.#initialSecrets = options.initialSecrets ?? {};
        this.#initialFiles = options.initialFiles ?? [];
        this.#confirmResult = options.confirmResult ?? true;
    }

    setApprovedGrants(grants: readonly PluginGrant[]): void {
        this.#approvedGrants = new Set(grants);
    }

    failNext(
        capability: PluginTestCapability,
        code: PluginErrorCode = 'host-unavailable',
        message = `Injected ${capability} failure`
    ): void {
        const result = pluginError(code, message);
        if (!result.ok) this.#failures.set(capability, result.error);
    }

    snapshot(): PluginTestHostSnapshot {
        return Object.freeze({
            active: this.#activeGeneration !== undefined,
            workspaceId: this.#workspaceId,
            generation: this.#generation,
            contributionCount: this.#contributionCount,
            hookCount: this.#hookCount,
            cleanupCount: this.#cleanups.length,
            palettePostSources: Object.freeze([...this.#palettePostSources]),
            paletteCommands: Object.freeze([...this.#paletteCommands]),
            panes: Object.freeze([...this.#panes.values()].map(({ id, app, instanceKey }) => ({ id, app, instanceKey }))),
            commands: Object.freeze([...this.#commands.keys()]),
            uiRegistrations: Object.freeze(
                [...this.#uiDefinitions.values()].map(({ surface, id }) => ({ surface, id }))
            ),
            activitySources: this.activity.sources(),
        });
    }

    /**
     * Simulate host-mediated execution of an isolated palette command.
     * Handlers are never serialized; only command ids cross the boundary.
     */
    async executePaletteCommand(commandId: string): Promise<unknown> {
        const handler = this.#commandHandlers.get(commandId);
        if (!handler) {
            throw new Error(`No mediated handler for command "${commandId}"`);
        }
        return handler();
    }

    registerMediatedPaletteCommandHandler(
        commandId: string,
        handler: () => Promise<unknown> | unknown
    ): void {
        this.#commandHandlers.set(commandId, handler);
    }

    async switchWorkspace(id: string): Promise<PluginResult<{ readonly id: string }>> {
        const operation = this.#workspaceSwitchTail.then(
            () => this.#switchWorkspace(id),
            () => this.#switchWorkspace(id)
        );
        this.#workspaceSwitchTail = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }

    async #switchWorkspace(id: string): Promise<PluginResult<{ readonly id: string }>> {
        if (!id || id.length > 200) return pluginError('invalid-input', 'Workspace id is invalid');
        if (id === this.#workspaceId) return pluginOk({ id });
        const previousId = this.#workspaceId;
        const definition = this.#activeDefinition;
        const previousListeners = [...this.#workspaceListeners];
        let deactivationFailure: unknown;
        try {
            await this.deactivate();
        } catch (error) {
            deactivationFailure = error;
        }
        if (deactivationFailure) {
            this.#workspaceId = previousId;
            this.#activeDefinition = definition;
            return pluginError(
                'internal',
                deactivationFailure instanceof Error
                    ? `Workspace switch could not stop the current plugin: ${deactivationFailure.message}`
                    : 'Workspace switch could not stop the current plugin'
            );
        }
        this.#workspaceId = id;
        if (!definition) return pluginOk({ id });
        const reactivated = await this.activate(definition);
        if (!reactivated.ok) {
            // A failed or cancelled switch is transactional: restore the old
            // scope and the old definition so callers can retry without losing
            // the running plugin. The failed generation has already been
            // disposed by activate().
            this.#workspaceId = previousId;
            this.#activeDefinition = definition;
            await this.activate(definition);
            return pluginError(
                reactivated.error.code,
                `Workspace switch activated no plugin: ${reactivated.error.message}`,
                {
                    retryable: reactivated.error.retryable,
                    ...(reactivated.error.details === undefined
                        ? {}
                        : { details: reactivated.error.details }),
                }
            );
        }
        // Notify the old generation only after the new scope has committed.
        // Subscribers are best-effort and may already be stale by the time
        // they run; the new setup receives the authoritative snapshot.
        const change = { previousId, id, reason: 'user' } as const;
        for (const listener of previousListeners) {
            notifyPluginListener(listener, change);
        }
        for (const listener of this.#eventListeners.get('workspace.changed') ?? []) {
            notifyPluginListener(
                listener as (payload: PluginEventMap['workspace.changed']) => void | Promise<void>,
                change
            );
        }
        return pluginOk({ id });
    }

    async install(definition: Or3PluginDefinition): Promise<PluginTestActivationResult> {
        return this.activate(definition);
    }

    async disable(): Promise<void> {
        this.#activeDefinition = undefined;
        await this.deactivate();
    }

    async activate(definition: Or3PluginDefinition): Promise<PluginTestActivationResult> {
        try {
            await this.deactivate();
        } catch (error) {
            return pluginError(
                'internal',
                error instanceof Error
                    ? `Plugin activation could not stop the previous generation: ${error.message}`
                    : 'Plugin activation could not stop the previous generation'
            );
        }
        this.#activeDefinition = definition;
        const generation = ++this.#generation;
        const controller = new AbortController();
        const cleanups: Array<() => void | Promise<void>> = [];
        const activations: Array<() => void | Promise<void>> = [];
        this.#cleanupSink = cleanups;
        const requested = new Set(definition.manifest.requestedGrants);
        const grants = [...this.#approvedGrants].filter((grant) => requested.has(grant));
        const approved = new Set(grants);
        let stagedContributions = 0;
        let stagedHooks = 0;
        const handle = (dispose: () => void): PluginRegistrationHandle => {
            let disposed = false;
            const registration = Object.freeze({
                dispose: () => {
                    if (disposed) return;
                    disposed = true;
                    dispose();
                },
            });
            cleanups.push(registration.dispose);
            return registration;
        };
        const contributions: PluginContributions = {
            register: <TDefinition>(contribution: PluginContribution<TDefinition>) => {
                const kind = contribution.kind;
                const needsPalette =
                    kind === 'ui.command-palette.post-source' ||
                    kind === 'ui.command-palette.command';
                if (needsPalette && !approved.has('ui.command-palette.register')) {
                    throw new Error(
                        'Grant ui.command-palette.register was not approved'
                    );
                }
                if (
                    !needsPalette &&
                    !approved.has('ui.dashboard.register')
                ) {
                    throw new Error('Grant ui.dashboard.register was not approved');
                }
                stagedContributions += 1;
                const recorded = contribution as PluginContribution;
                if (kind === 'ui.command-palette.post-source') {
                    this.#palettePostSources.push(recorded);
                }
                if (kind === 'ui.command-palette.command') {
                    this.#paletteCommands.push(recorded);
                }
                return handle(() => {
                    stagedContributions = Math.max(0, stagedContributions - 1);
                    if (kind === 'ui.command-palette.post-source') {
                        this.#palettePostSources = this.#palettePostSources.filter(
                            (entry) => entry !== recorded
                        );
                    }
                    if (kind === 'ui.command-palette.command') {
                        this.#paletteCommands = this.#paletteCommands.filter(
                            (entry) => entry !== recorded
                        );
                        this.#commandHandlers.delete(contribution.id);
                    }
                });
            },
        };
        const hooks: PluginHooks = {
            onAction: () => {
                if (!approved.has('hooks.register')) {
                    throw new Error('Grant hooks.register was not approved');
                }
                stagedHooks += 1;
                return handle(() => {
                    stagedHooks = Math.max(0, stagedHooks - 1);
                });
            },
            onFilter: () => {
                if (!approved.has('hooks.register')) {
                    throw new Error('Grant hooks.register was not approved');
                }
                stagedHooks += 1;
                return handle(() => {
                    stagedHooks = Math.max(0, stagedHooks - 1);
                });
            },
        };
        const features: PluginFeatureNegotiation = {
            has: (feature) => this.#supportedFeatures.has(feature),
            require: (feature) => {
                if (!this.#supportedFeatures.has(feature)) {
                    throw new Error(`Required test feature is unavailable: ${feature}`);
                }
            },
            optional: (feature) => this.#supportedFeatures.has(feature),
            available: this.#supportedFeatures,
        };
        const context = createHostPluginContext({
            identity: {
                pluginId: definition.manifest.id,
                version: definition.manifest.version,
                workspaceId: this.#workspaceId,
                generation,
                trust: definition.manifest.trust,
            },
            grants,
            signal: controller.signal,
            logger,
            features,
            hooks,
            contributions,
            clients: {
                createSettingsClient: (scope) => this.#createSettingsClient(scope),
                createStorageClient: (scope) => this.#createStorageClient(scope),
                createClients: (scope) => this.#createClients(scope),
            },
            onCleanup: (callback) => cleanups.push(callback),
            onActivate: (callback) => activations.push(callback),
        });
        this.#activeGeneration = generation;
        this.#controller = controller;
        try {
            await definition.setup(context);
            for (const callback of activations) await callback();
            this.#cleanups = cleanups;
            this.#cleanupSink = undefined;
            this.#activeContext = context;
            this.#contributionCount = stagedContributions;
            this.#hookCount = stagedHooks;
            return pluginOk({ context, generation });
        } catch (error) {
            controller.abort();
            for (const callback of [...cleanups].reverse()) {
                try {
                    await callback();
                } catch {
                    // The original activation failure remains authoritative.
                }
            }
            this.#activeGeneration = undefined;
            this.#controller = undefined;
            this.#cleanups = [];
            this.#cleanupSink = undefined;
            this.#activeContext = undefined;
            this.#activeDefinition = undefined;
            this.#contributionCount = 0;
            this.#hookCount = 0;
            return pluginError(
                'internal',
                error instanceof Error ? error.message : 'Plugin activation failed'
            );
        }
    }

    async deactivate(): Promise<void> {
        if (this.#activeGeneration === undefined) return;
        this.#controller?.abort();
        let firstFailure: unknown;
        for (const callback of [...this.#cleanups].reverse()) {
            try {
                await callback();
            } catch (error) {
                firstFailure ??= error;
            }
        }
        this.#activeGeneration = undefined;
        this.#controller = undefined;
        this.#cleanups = [];
        this.#cleanupSink = undefined;
        this.#activeContext = undefined;
        this.#contributionCount = 0;
        this.#hookCount = 0;
        this.#palettePostSources = [];
        this.#paletteCommands = [];
        this.#commandHandlers.clear();
        this.#commands.clear();
        this.#panes.clear();
        this.#uiDefinitions.clear();
        this.#chatRequestIds.clear();
        this.#eventListeners.clear();
        this.#workspaceListeners.clear();
        this.#activitySources.clear();
        if (firstFailure) throw firstFailure;
    }

    async #runCommand(commandId: string, data?: PluginJsonValue): Promise<PluginResult<PluginJsonValue>> {
        if (this.#activeGeneration === undefined || !this.#activeContext) {
            return pluginError('host-unavailable', 'No plugin is installed');
        }
        const command = this.#commands.get(commandId);
        if (!command) return pluginError('not-found', `Command ${commandId} was not found`);
        try {
            return await command.handler({
                commandId,
                signal: this.#activeContext.signal,
                ...(data === undefined ? {} : { data }),
            });
        } catch (error) {
            return pluginError('internal', error instanceof Error ? error.message : String(error));
        }
    }

    #registerUiDefinition(
        scope: HostPluginScope,
        surface: PluginUiSurface,
        definition: object,
        handle: (dispose: () => void) => PluginRegistrationHandle
    ): PluginRegistrationHandle {
        const rawDefinition = definition as Record<string, unknown>;
        if (
            typeof rawDefinition.id !== 'string' ||
            rawDefinition.id.length === 0 ||
            rawDefinition.id.length > 128 ||
            /[\u0000-\u001f\u007f]/.test(rawDefinition.id)
        ) {
            throw new Error(`${surface} registration id must be a bounded identifier`);
        }
        const label = rawDefinition.label ?? rawDefinition.title;
        if (typeof label !== 'string' || label.length === 0 || label.length > 256) {
            throw new Error(`${surface} registration requires a bounded label`);
        }
        const key = `${scope.pluginId}\u0000${surface}\u0000${rawDefinition.id}`;
        if (this.#uiDefinitions.has(key)) {
            throw new Error(`${surface} registration ${rawDefinition.id} is already registered`);
        }
        const recorded = {
            surface,
            id: rawDefinition.id,
            definition: rawDefinition as PluginJsonValue,
        } as const;
        this.#uiDefinitions.set(key, recorded);
        return handle(() => {
            if (this.#uiDefinitions.get(key) === recorded) this.#uiDefinitions.delete(key);
        });
    }

    #guard(scope: HostPluginScope, grant: PluginGrant, capability?: PluginTestCapability) {
        const scoped = this.#scopeFailure(scope, grant);
        if (scoped) return scoped;
        const failure = capability === undefined ? undefined : this.#failures.get(capability);
        if (failure && capability !== undefined) {
            this.#failures.delete(capability);
            return pluginError(failure.code, failure.message, {
                retryable: failure.retryable,
                details: failure.details,
            });
        }
        return null;
    }

    #resultGuard<T>(scope: HostPluginScope, grant: PluginGrant): PluginResult<T> | null {
        const denied = this.#guard(scope, grant);
        return denied ? asFailure<T>(denied) : null;
    }

    #scopeFailure(scope: HostPluginScope, grant: PluginGrant): PluginResult<never> | null {
        if (scope.generation !== this.#activeGeneration) {
            return errorResult('conflict', 'Plugin generation is stale');
        }
        if (scope.signal.aborted) return errorResult('aborted', 'Plugin generation is stopped');
        if (!scope.grants.has(grant)) {
            return errorResult('permission-denied', `Grant ${grant} was not approved`);
        }
        return null;
    }

    #createClients(scope: HostPluginScope): PluginHostClients {
        const base = createUnsupportedPluginClients({ workspaceId: scope.workspaceId });
        const secretsStore = this.#secretsFor(scope.workspaceId, scope.pluginId);
        const filesStore = this.#filesFor(scope.workspaceId, scope.pluginId);
        const guard = (grant: PluginGrant): void => {
            if (scope.generation !== this.#activeGeneration) {
                throw new Error('Plugin generation is stale');
            }
            if (scope.signal.aborted) throw new Error('Plugin generation is stopped');
            if (!scope.grants.has(grant)) {
                throw new Error(`Grant ${grant} was not approved`);
            }
        };
        const handle = (dispose: () => void): PluginRegistrationHandle => {
            let disposed = false;
            const registration = Object.freeze({
                dispose: () => {
                    if (disposed) return;
                    disposed = true;
                    dispose();
                },
            });
            (this.#cleanupSink ?? this.#cleanups).push(registration.dispose);
            return registration;
        };
        const emit = <K extends PluginEventName>(
            name: K,
            payload: PluginEventMap[K]
        ): void => {
            for (const listener of this.#eventListeners.get(name) ?? []) {
                notifyPluginListener(listener as (value: PluginEventMap[K]) => void | Promise<void>, payload);
            }
        };
        const events = {
            on: <K extends PluginEventName>(
                name: K,
                listener: (payload: PluginEventMap[K]) => void | Promise<void>
            ) => {
                guard('events.register');
                let listeners = this.#eventListeners.get(name);
                if (!listeners) {
                    listeners = new Set();
                    this.#eventListeners.set(name, listeners);
                }
                const callback = listener as (payload: never) => void | Promise<void>;
                listeners.add(callback);
                return handle(() => {
                    listeners.delete(callback);
                    if (listeners.size === 0) this.#eventListeners.delete(name);
                });
            },
        };
        const workspace = {
            id: scope.workspaceId,
            onChange: (listener: (change: PluginEventMap['workspace.changed']) => void | Promise<void>) => {
                guard('workspace.read');
                this.#workspaceListeners.add(listener);
                return handle(() => this.#workspaceListeners.delete(listener));
            },
            switch: async (id: string) => {
                const denied = this.#resultGuard<{ readonly id: string }>(scope, 'workspace.switch');
                if (denied) return denied;
                return this.switchWorkspace(id);
            },
            connections: base.workspace.connections,
        };
        const panes = {
            open: async (input: { app: string; data: PluginJsonValue; instanceKey?: string; target?: 'focus-or-new' | 'new' | 'replace-active' }) => {
                const denied = this.#resultGuard<PluginPaneRef>(scope, 'panes.open');
                if (denied) return denied;
                const validated = validatePluginPaneOpenInput(input);
                if (!validated.ok) {
                    const quota =
                        validated.message.includes('exceeds') ||
                        validated.message.includes('oversized') ||
                        validated.message.includes('items');
                    return pluginError(
                        quota ? 'quota-exceeded' : 'invalid-input',
                        validated.message
                    );
                }
                const { app, data, instanceKey, target = 'focus-or-new' } = validated.value;
                if (target === 'focus-or-new' && instanceKey) {
                    const existing = [...this.#panes.values()].find(
                        (pane) => pane.app === app && pane.instanceKey === instanceKey
                    );
                    if (existing) {
                        for (const pane of this.#panes.values()) pane.focused = false;
                        existing.focused = true;
                        return pluginOk({ id: existing.id, app: existing.app, instanceKey: existing.instanceKey });
                    }
                }
                if (target === 'replace-active') {
                    for (const [id, pane] of this.#panes) {
                        if (pane.focused) this.#panes.delete(id);
                    }
                }
                for (const pane of this.#panes.values()) pane.focused = false;
                const id = `pane-${++this.#nextPaneId}`;
                const resolvedInstanceKey = instanceKey ?? id;
                const ref = { id, app, instanceKey: resolvedInstanceKey };
                this.#panes.set(id, {
                    ...ref,
                    data,
                    focused: true,
                    ownerPluginId: scope.pluginId,
                    ownerGeneration: scope.generation,
                });
                (this.#cleanupSink ?? this.#cleanups).push(() => {
                    this.#panes.delete(id);
                });
                return pluginOk(ref);
            },
            focus: async (id: string) => {
                const denied = this.#resultGuard<void>(scope, 'panes.open');
                if (denied) return denied;
                const pane = this.#panes.get(id);
                if (!pane || pane.ownerPluginId !== scope.pluginId) {
                    return pluginError('not-found', `Pane ${id} was not found`);
                }
                for (const current of this.#panes.values()) current.focused = false;
                pane.focused = true;
                return pluginOk(undefined);
            },
            close: async (id: string) => {
                const denied = this.#resultGuard<void>(scope, 'panes.open');
                if (denied) return denied;
                const pane = this.#panes.get(id);
                if (!pane || pane.ownerPluginId !== scope.pluginId) {
                    return pluginError('not-found', `Pane ${id} was not found`);
                }
                this.#panes.delete(id);
                return pluginOk(undefined);
            },
        };
        const commands = {
            register: (definition: PluginCommandDefinition, handlerFn: PluginCommandHandler) => {
                guard('commands.register');
                if (this.#commands.has(definition.id)) {
                    throw new Error(`Command ${definition.id} is already registered`);
                }
                this.#commands.set(definition.id, { definition, handler: handlerFn, scope });
                return handle(() => this.#commands.delete(definition.id));
            },
            run: async (commandId: string, data?: PluginJsonValue) => {
                const command = this.#commands.get(commandId);
                if (!command) return pluginError('not-found', `Command ${commandId} was not found`);
                const commandGrant = command.scope.pluginId === scope.pluginId
                    ? 'commands.register'
                    : 'commands.run.public';
                const runDenied = this.#resultGuard<PluginJsonValue>(scope, commandGrant);
                if (runDenied) return runDenied;
                try {
                    const invocation: PluginCommandInvocation = {
                        commandId,
                        signal: scope.signal,
                        ...(data === undefined ? {} : { data }),
                    };
                    return await command.handler(invocation);
                } catch (error) {
                    return pluginError('internal', error instanceof Error ? error.message : String(error));
                }
            },
        };
        const ui = {
            registerSidebar: (definition: { id: string; label: string; icon?: string; order?: number }) => {
                guard('ui.sidebar.register');
                return this.#registerUiDefinition(scope, 'sidebar', definition, handle);
            },
            registerPane: (definition: { id: string; label: string; icon?: string; order?: number; dataVersion?: number }) => {
                guard('ui.pane.register');
                const validated = validatePluginPaneDefinition(definition);
                if (!validated.ok) throw new Error(validated.message);
                return this.#registerUiDefinition(scope, 'pane', validated.value, handle);
            },
            registerCard: (definition: { id: string; title: string; order?: number }) => {
                guard('ui.card.register');
                return this.#registerUiDefinition(scope, 'card', definition, handle);
            },
            registerAction: (definition: { id: string; label: string; surface: 'sidebar' | 'pane' | 'chat' | 'message'; order?: number }) => {
                guard('ui.action.register');
                return this.#registerUiDefinition(scope, 'action', definition, handle);
            },
            toast: (input: { message: string; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; durationMs?: number }) => {
                const denied = this.#resultGuard<void>(scope, 'ui.toast');
                if (denied) return denied;
                if (!input.message) return pluginError('invalid-input', 'Toast message is required');
                return pluginOk(undefined);
            },
            confirm: async () => {
                const denied = this.#resultGuard<boolean>(scope, 'ui.confirm');
                if (denied) return denied;
                return pluginOk(this.#confirmResult);
            },
            progress: (input: { label: string; max?: number }) => {
                const denied = this.#resultGuard<PluginProgressHandle>(scope, 'ui.progress');
                if (denied) return denied;
                if (!input.label) return pluginError('invalid-input', 'Progress label is required');
                let disposed = false;
                const progress = {
                    update: () => disposed ? pluginError('stale-context', 'Progress is disposed') : pluginOk(undefined),
                    dispose: () => { disposed = true; },
                };
                const registration = handle(progress.dispose);
                return pluginOk({ ...progress, dispose: registration.dispose });
            },
        };
        const chat = {
            create: async (input: { title?: string } = {}) => {
                const denied = this.#resultGuard<PluginChatRef>(scope, 'chat.create');
                if (denied) return denied;
                const id = `chat-${++this.#nextChatId}`;
                this.#chats.set(id, {
                    pluginId: scope.pluginId,
                    workspaceId: scope.workspaceId,
                    title: input.title,
                    messages: new Map(),
                });
                emit('chat.created', { chatId: id, ...(input.title ? { title: input.title } : {}) });
                return pluginOk({ id, ...(input.title ? { title: input.title } : {}) });
            },
            open: async (id: string) => {
                const denied = this.#resultGuard<PluginChatRef>(scope, 'chat.read');
                if (denied) return denied;
                const chatRecord = this.#chats.get(id);
                if (
                    !chatRecord ||
                    chatRecord.pluginId !== scope.pluginId ||
                    chatRecord.workspaceId !== scope.workspaceId
                ) return pluginError('not-found', `Chat ${id} was not found`);
                return pluginOk({ id, ...(chatRecord.title ? { title: chatRecord.title } : {}) });
            },
            appendMessage: async (
                chatId: string,
                message: PluginChatMessage,
                options: { readonly requestId?: string } = {}
            ) => {
                const denied = this.#resultGuard<{ readonly messageId: string }>(scope, 'chat.message.write');
                if (denied) return denied;
                const chatRecord = this.#chats.get(chatId);
                if (
                    !chatRecord ||
                    chatRecord.pluginId !== scope.pluginId ||
                    chatRecord.workspaceId !== scope.workspaceId
                ) return pluginError('not-found', `Chat ${chatId} was not found`);
                const validated = validatePluginChatMessage(message);
                if (!validated.ok) return pluginError('invalid-input', validated.message);
                const attachmentIds = new Set<string>([
                    ...(validated.value.fileIds ?? []),
                    ...(validated.value.attachments ?? []).map((attachment) => attachment.fileId),
                ]);
                for (const fileId of attachmentIds) {
                    if (!filesStore.has(fileId)) {
                        return pluginError('not-found', `File ${fileId} was not found`);
                    }
                }
                const requestId = options.requestId;
                if (requestId !== undefined) {
                    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) {
                        return pluginError('invalid-input', 'Chat requestId is invalid');
                    }
                    const requestKey = `${scope.pluginId}\u0000${chatId}\u0000${requestId}`;
                    const existing = this.#chatRequestIds.get(requestKey);
                    if (existing) return pluginOk({ messageId: existing });
                    this.#chatRequestIds.set(requestKey, `message-${this.#nextMessageId + 1}`);
                }
                const messageId = `message-${++this.#nextMessageId}`;
                chatRecord.messages.set(messageId, validated.value);
                emit('chat.message.created', { chatId, messageId, role: validated.value.role });
                return pluginOk({ messageId });
            },
        };
        const secrets = {
            get: async (key: string) => {
                const denied = this.#resultGuard<string | null>(scope, 'secrets.read');
                if (denied) return denied;
                const validKey = validatePluginSecretKey(key);
                if (!validKey.ok) return pluginError('invalid-input', validKey.message);
                return pluginOk(secretsStore.get(key)?.value ?? null);
            },
            set: async (
                key: string,
                value: string,
                options: { readonly persistence?: 'session' | 'remember' } = {}
            ) => {
                const denied = this.#resultGuard<void>(scope, 'secrets.write');
                if (denied) return denied;
                const validKey = validatePluginSecretKey(key);
                if (!validKey.ok) return pluginError('invalid-input', validKey.message);
                const validValue = validatePluginSecretValue(value);
                if (!validValue.ok) return pluginError('invalid-input', validValue.message);
                const revision = (secretsStore.get(key)?.revision ?? 0) + 1;
                secretsStore.set(key, {
                    value,
                    revision,
                    persistence: options.persistence === 'remember' ? 'persistent' : 'session',
                });
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#resultGuard<void>(scope, 'secrets.write');
                if (denied) return denied;
                const validKey = validatePluginSecretKey(key);
                if (!validKey.ok) return pluginError('invalid-input', validKey.message);
                secretsStore.delete(key);
                return pluginOk(undefined);
            },
            ref: async (key: string) => {
                const denied = this.#resultGuard<PluginSecretRef>(scope, 'secrets.use');
                if (denied) return denied;
                const validKey = validatePluginSecretKey(key);
                if (!validKey.ok) return pluginError('invalid-input', validKey.message);
                const secret = secretsStore.get(key);
                if (!secret) return pluginError('not-found', `Secret ${key} was not found`);
                return pluginOk({
                    id: key,
                    revision: secret.revision,
                    owner: 'plugin' as const,
                    persistence: secret.persistence,
                    state: 'available' as const,
                });
            },
            status: async (key?: string) => {
                const denied = this.#resultGuard<PluginSecretState>(scope, 'secrets.use');
                if (denied) return denied;
                if (key !== undefined) {
                    const validKey = validatePluginSecretKey(key);
                    if (!validKey.ok) return pluginError('invalid-input', validKey.message);
                }
                const value: PluginSecretState = key === undefined
                    ? 'available'
                    : secretsStore.has(key) ? 'available' : 'missing';
                return pluginOk(value);
            },
            unlock: async () => {
                const denied = this.#resultGuard<void>(scope, 'secrets.use');
                if (denied) return denied;
                return pluginOk(undefined);
            },
        };
        const files = {
            pick: async (options: { multiple?: boolean; accept?: readonly string[]; signal?: AbortSignal } = {}) => {
                const denied = this.#resultGuard<readonly PluginFileRef[]>(scope, 'files.pick');
                if (denied) return denied;
                if (options.signal?.aborted) return pluginError('aborted', 'File selection was cancelled');
                const selected = [...filesStore.values()].filter((file) =>
                    !options.accept?.length || options.accept.some((accept) => file.mimeType === accept || accept === '*/*')
                );
                return pluginOk(options.multiple ? selected.map(({ data: _data, ...ref }) => ref) : selected.slice(0, 1).map(({ data: _data, ...ref }) => ref));
            },
            read: async (id: string, options: { signal?: AbortSignal } = {}) => {
                const denied = this.#resultGuard<PluginFileRead>(scope, 'files.read');
                if (denied) return denied;
                const file = filesStore.get(id);
                if (!file) return pluginError('not-found', `File ${id} was not found`);
                const validRef = validatePluginFileRef(file);
                if (!validRef.ok) return pluginError('internal', validRef.message);
                const controller = new AbortController();
                let settled = false;
                let settleResult!: (result: PluginResult<void>) => void;
                const result = new Promise<PluginResult<void>>((resolve) => {
                    settleResult = resolve;
                });
                let onAbort: (() => void) | undefined;
                const settle = (value: PluginResult<void>) => {
                    if (settled) return;
                    settled = true;
                    settleResult(value);
                    if (onAbort && options.signal) {
                        options.signal.removeEventListener('abort', onAbort);
                    }
                };
                const scopeFailure = () => this.#scopeFailure(scope, 'files.read');
                onAbort = () => {
                    controller.abort();
                    settle(pluginError('aborted', 'File read was cancelled'));
                };
                options.signal?.addEventListener('abort', onAbort, { once: true });
                if (options.signal?.aborted) {
                    controller.abort();
                    settle(pluginError('aborted', 'File read was cancelled'));
                }
                const chunks = async function* () {
                    for (let offset = 0; offset < file.data.byteLength; offset += 64 * 1024) {
                        const stale = scopeFailure();
                        if (stale) {
                            settle(asFailure<void>(stale));
                            return;
                        }
                        if (controller.signal.aborted) {
                            settle(pluginError('aborted', 'File read was cancelled'));
                            return;
                        }
                        yield file.data.slice(offset, Math.min(offset + 64 * 1024, file.data.byteLength));
                    }
                    settle(pluginOk(undefined));
                };
                const iterable: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: chunks };
                return pluginOk({
                    ...iterable,
                    result,
                    cancel: () => {
                        controller.abort();
                        settle(pluginError('aborted', 'File read was cancelled'));
                    },
                } as PluginFileRead);
            },
            write: async (input: { name: string; mimeType: string; data: AsyncIterable<Uint8Array>; replace?: { id: string; ifRevision: number }; signal?: AbortSignal }) => {
                const denied = this.#resultGuard<PluginFileRef>(scope, 'files.write');
                if (denied) return denied;
                if (input.signal?.aborted) return pluginError('aborted', 'File write was cancelled');
                const metadata = validatePluginFileRef({
                    id: input.replace?.id ?? 'file-pending',
                    name: input.name,
                    mimeType: input.mimeType,
                    size: 0,
                    revision: 1,
                    origin: 'generated',
                });
                if (!metadata.ok) return pluginError('invalid-input', metadata.message);
                if (input.replace) {
                    const current = filesStore.get(input.replace.id);
                    if (!current || (current.revision ?? 0) !== input.replace.ifRevision) {
                        return pluginError('conflict', 'File revision is stale');
                    }
                }
                const parts: Uint8Array[] = [];
                let size = 0;
                try {
                    for await (const chunk of input.data) {
                        if (input.signal?.aborted) return pluginError('aborted', 'File write was cancelled');
                        if (!isUint8Chunk(chunk)) {
                            return pluginError('invalid-input', 'File chunks must be Uint8Array values');
                        }
                        size += chunk.byteLength;
                        if (size > 4 * 1024 * 1024) return pluginError('quota-exceeded', 'File exceeds the test host limit');
                        parts.push(new Uint8Array(chunk));
                    }
                } catch (error) {
                    if (input.signal?.aborted) return pluginError('aborted', 'File write was cancelled');
                    return pluginError('internal', error instanceof Error ? error.message : 'File input failed');
                }
                const stale = this.#scopeFailure(scope, 'files.write');
                if (stale) return asFailure<PluginFileRef>(stale);
                if (input.replace) {
                    const current = filesStore.get(input.replace.id);
                    if (!current || (current.revision ?? 0) !== input.replace.ifRevision) {
                        return pluginError('conflict', 'File revision is stale');
                    }
                }
                const data = new Uint8Array(size);
                let offset = 0;
                for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
                let id = input.replace?.id;
                if (!id) {
                    let nextId = filesStore.size + 1;
                    id = `file-${nextId}`;
                    while (filesStore.has(id)) {
                        nextId += 1;
                        id = `file-${nextId}`;
                    }
                }
                const revision = (filesStore.get(id)?.revision ?? 0) + 1;
                const ref: PluginTestFile = { id, name: input.name, mimeType: input.mimeType, size, revision, origin: 'generated', data };
                const validRef = validatePluginFileRef(ref);
                if (!validRef.ok) return pluginError('invalid-input', validRef.message);
                filesStore.set(id, ref);
                const { data: _data, ...publicRef } = ref;
                return pluginOk(publicRef);
            },
        };
        const activity = {
            registerSource: (input: PluginActivitySource) => {
                guard('activity.register');
                if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(input.id) || input.id.length > 100) {
                    throw new Error('Activity source id is invalid');
                }
                if (!input.label || input.label.length > 100) {
                    throw new Error('Activity source label is invalid');
                }
                const key = `${scope.pluginId}\u0000${input.id}`;
                if (this.#activitySources.has(key)) {
                    throw new Error(`Activity source ${input.id} is already registered`);
                }
                this.#activitySources.set(key, { pluginId: scope.pluginId, source: input });
                return handle(() => {
                    if (this.#activitySources.get(key)?.source === input) {
                        this.#activitySources.delete(key);
                    }
                });
            },
        };
        return {
            ...base,
            ui,
            panes,
            commands,
            chat,
            workspace,
            events,
            secrets,
            files,
            activity,
        };
    }

    #createSettingsClient(scope: HostPluginScope): PluginSettingsClient {
        const settings = this.#settingsFor(scope.workspaceId, scope.pluginId);
        const defaults = this.#settingsDefaultsFor(scope.workspaceId, scope.pluginId);
        const revisions = this.#settingsRevisionsFor(scope.workspaceId, scope.pluginId);
        const validateKey = (key: string): PluginResult<never> | null => {
            if (!key || key.length > 200 || key.includes('\u0000')) {
                return pluginError('invalid-input', 'Setting keys must be 1–200 characters without NUL');
            }
            return null;
        };
        return Object.freeze({
            get: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'settings.read', 'settings');
                if (denied) return asFailure<T | null>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<T | null>(invalid);
                return pluginOk((settings.get(key) ?? null) as T | null);
            },
            list: async () => {
                const denied = this.#guard(scope, 'settings.read', 'settings');
                if (denied) return asFailure<Readonly<Record<string, PluginJsonValue>>>(denied);
                return pluginOk(Object.freeze(Object.fromEntries(settings)));
            },
            set: async (key: string, value: PluginJsonValue) => {
                const denied = this.#guard(scope, 'settings.write', 'settings');
                if (denied) return asFailure<void>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<void>(invalid);
                settings.set(key, value);
                const revision = (revisions.get(key) ?? 0) + 1;
                revisions.set(key, revision);
                for (const listener of this.#eventListeners.get('settings.changed') ?? []) {
                    notifyPluginListener(
                        listener as (value: PluginEventMap['settings.changed']) => void | Promise<void>,
                        { key, revision, deleted: false }
                    );
                }
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#guard(scope, 'settings.write', 'settings');
                if (denied) return asFailure<void>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<void>(invalid);
                const defaultValue = defaults.get(key);
                if (defaultValue === undefined) settings.delete(key);
                else settings.set(key, defaultValue);
                const revision = (revisions.get(key) ?? 0) + 1;
                revisions.set(key, revision);
                for (const listener of this.#eventListeners.get('settings.changed') ?? []) {
                    notifyPluginListener(
                        listener as (value: PluginEventMap['settings.changed']) => void | Promise<void>,
                        { key, revision, deleted: true }
                    );
                }
                return pluginOk(undefined);
            },
        });
    }

    #claimInitialState(pluginId: string): boolean {
        this.#initialStateOwner ??= pluginId;
        return this.#initialStateOwner === pluginId;
    }

    #settingsFor(workspaceId: string, pluginId: string): Map<string, PluginJsonValue> {
        const scopeKey = this.#pluginWorkspaceKey(workspaceId, pluginId);
        let settings = this.#settingsByWorkspace.get(scopeKey);
        if (!settings) {
            settings = new Map();
            this.#settingsByWorkspace.set(scopeKey, settings);
            if (this.#claimInitialState(pluginId) && workspaceId === this.#initialWorkspaceId) {
                for (const [key, value] of Object.entries(this.#initialSettings)) settings.set(key, value);
            }
        }
        return settings;
    }

    #settingsDefaultsFor(workspaceId: string, pluginId: string): Map<string, PluginJsonValue> {
        const scopeKey = this.#pluginWorkspaceKey(workspaceId, pluginId);
        let defaults = this.#settingsDefaultsByWorkspace.get(scopeKey);
        if (!defaults) {
            defaults = new Map();
            this.#settingsDefaultsByWorkspace.set(scopeKey, defaults);
            if (this.#claimInitialState(pluginId) && workspaceId === this.#initialWorkspaceId) {
                for (const [key, value] of Object.entries(this.#initialSettingsDefaults)) defaults.set(key, value);
            }
        }
        return defaults;
    }

    #settingsRevisionsFor(workspaceId: string, pluginId: string): Map<string, number> {
        const scopeKey = this.#pluginWorkspaceKey(workspaceId, pluginId);
        let revisions = this.#settingsRevisionsByWorkspace.get(scopeKey);
        if (!revisions) {
            revisions = new Map();
            this.#settingsRevisionsByWorkspace.set(scopeKey, revisions);
            if (this.#claimInitialState(pluginId) && workspaceId === this.#initialWorkspaceId) {
                for (const key of Object.keys(this.#initialSettings)) revisions.set(key, 1);
            }
        }
        return revisions;
    }

    #pluginWorkspaceKey(workspaceId: string, pluginId: string): string {
        return `${workspaceId}\u0000${pluginId}`;
    }

    #storageFor(workspaceId: string, pluginId: string): {
        readonly values: Map<string, PluginJsonValue>;
        readonly revisions: Map<string, number>;
        readonly updatedAt: Map<string, number>;
    } {
        const scopeKey = this.#pluginWorkspaceKey(workspaceId, pluginId);
        let values = this.#storageByWorkspace.get(scopeKey);
        if (!values) {
            values = new Map();
            this.#storageByWorkspace.set(scopeKey, values);
        }
        let revisions = this.#storageRevisionsByWorkspace.get(scopeKey);
        if (!revisions) {
            revisions = new Map();
            this.#storageRevisionsByWorkspace.set(scopeKey, revisions);
        }
        let updatedAt = this.#storageUpdatedAtByWorkspace.get(scopeKey);
        if (!updatedAt) {
            updatedAt = new Map();
            this.#storageUpdatedAtByWorkspace.set(scopeKey, updatedAt);
        }
        if (this.#claimInitialState(pluginId) && workspaceId === this.#initialWorkspaceId && values.size === 0) {
            for (const [key, value] of Object.entries(this.#initialStorage)) {
                values.set(key, value);
                revisions.set(key, 1);
                updatedAt.set(key, 0);
            }
        }
        return { values, revisions, updatedAt };
    }

    #secretsFor(workspaceId: string, pluginId: string): Map<string, {
        value: string;
        revision: number;
        persistence: 'memory' | 'session' | 'persistent';
    }> {
        const scopeKey = this.#pluginWorkspaceKey(workspaceId, pluginId);
        let secrets = this.#secretsByWorkspace.get(scopeKey);
        if (!secrets) {
            secrets = new Map();
            this.#secretsByWorkspace.set(scopeKey, secrets);
            if (this.#claimInitialState(pluginId) && workspaceId === this.#initialWorkspaceId) {
                for (const [key, value] of Object.entries(this.#initialSecrets)) {
                    secrets.set(key, { value, revision: 1, persistence: 'session' });
                }
            }
        }
        return secrets;
    }

    #filesFor(workspaceId: string, pluginId: string): Map<string, PluginTestFile> {
        const scopeKey = this.#pluginWorkspaceKey(workspaceId, pluginId);
        let files = this.#filesByWorkspace.get(scopeKey);
        if (!files) {
            files = new Map();
            this.#filesByWorkspace.set(scopeKey, files);
            if (this.#claimInitialState(pluginId) && workspaceId === this.#initialWorkspaceId) {
                for (const file of this.#initialFiles) {
                    files.set(file.id, Object.freeze({ ...file, data: new Uint8Array(file.data) }));
                }
            }
        }
        return files;
    }

    #createStorageClient(scope: HostPluginScope): PluginStorageClient {
        const storage = this.#storageFor(scope.workspaceId, scope.pluginId);
        const validateKey = (key: string): PluginResult<never> | null => {
            if (!key || key.length > 200 || key.includes('\u0000')) {
                return pluginError('invalid-input', 'Storage keys must be 1–200 characters without NUL');
            }
            return null;
        };
        return Object.freeze({
            get: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<T | null>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<T | null>(invalid);
                return pluginOk((storage.values.get(key) ?? null) as T | null);
            },
            getRecord: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<{
                    readonly value: T | null;
                    readonly revision: number;
                    readonly sizeBytes: number;
                    readonly updatedAt: number;
                }>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<{
                    readonly value: T | null;
                    readonly revision: number;
                    readonly sizeBytes: number;
                    readonly updatedAt: number;
                }>(invalid);
                const value = (storage.values.get(key) ?? null) as T | null;
                return pluginOk({
                    value,
                    revision: storage.revisions.get(key) ?? 0,
                    sizeBytes: value === null ? 0 : new TextEncoder().encode(JSON.stringify(value)).byteLength,
                    updatedAt: storage.updatedAt.get(key) ?? 0,
                });
            },
            set: async (
                key: string,
                value: PluginJsonValue,
                options: PluginStorageMutationOptions = {}
            ) => {
                const denied = this.#guard(scope, 'storage.write', 'storage');
                if (denied) return asFailure<void>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<void>(invalid);
                let serialized: string;
                try {
                    const encoded = JSON.stringify(value);
                    if (typeof encoded !== 'string') {
                        return pluginError('invalid-input', 'Storage values must be JSON-serializable');
                    }
                    serialized = encoded;
                } catch {
                    return pluginError('invalid-input', 'Storage values must be JSON-serializable');
                }
                if (new TextEncoder().encode(serialized).byteLength > 32 * 1024) {
                    return pluginError('quota-exceeded', 'Storage values must be at most 32768 bytes');
                }
                const currentRevision = storage.revisions.get(key) ?? 0;
                if (
                    options.ifRevision !== undefined &&
                    (options.ifRevision === null
                        ? storage.values.has(key)
                        : options.ifRevision !== currentRevision)
                ) {
                    return pluginError('conflict', 'Storage revision is stale', {
                        details: { key, expected: options.ifRevision, current: currentRevision },
                    });
                }
                storage.values.set(key, value);
                storage.revisions.set(key, currentRevision + 1);
                storage.updatedAt.set(key, Date.now());
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#guard(scope, 'storage.write', 'storage');
                if (denied) return asFailure<void>(denied);
                const invalid = validateKey(key);
                if (invalid) return asFailure<void>(invalid);
                storage.values.delete(key);
                storage.revisions.delete(key);
                storage.updatedAt.delete(key);
                return pluginOk(undefined);
            },
            list: async (prefix = '') => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<readonly never[]>(denied);
                if (prefix.length > 200 || prefix.includes('\u0000')) {
                    return pluginError('invalid-input', 'Storage list prefix is invalid');
                }
                return pluginOk(
                    [...storage.values.entries()]
                        .filter(([key]) => key.startsWith(prefix))
                        .sort(([left], [right]) => comparePluginStorageKeys(left, right))
                        .map(([key, value]) => ({
                            key,
                            sizeBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength,
                            updatedAt: storage.updatedAt.get(key) ?? 0,
                            revision: storage.revisions.get(key) ?? 0,
                        }))
                );
            },
            listPage: async (options: { prefix?: string; cursor?: string; limit?: number } = {}) => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<{ entries: readonly never[] }>(denied);
                const prefix = options.prefix ?? '';
                if (prefix.length > 200 || prefix.includes('\u0000')) {
                    return pluginError('invalid-input', 'Storage list prefix is invalid');
                }
                if (options.cursor !== undefined && !options.cursor.startsWith('cursor:')) {
                    return pluginError('invalid-input', 'Storage list cursor is invalid');
                }
                const requestedLimit = typeof options.limit === 'number' && Number.isFinite(options.limit)
                    ? Math.floor(options.limit)
                    : 100;
                const limit = Math.max(1, Math.min(200, requestedLimit));
                const cursor = options.cursor?.startsWith('cursor:') ? options.cursor.slice(7) : '';
                if (cursor.length > 200 || cursor.includes('\u0000')) {
                    return pluginError('invalid-input', 'Storage list cursor is invalid');
                }
                const entries = [...storage.values.entries()]
                    .filter(([key]) => key.startsWith(prefix) && comparePluginStorageKeys(key, cursor) > 0)
                    .sort(([left], [right]) => comparePluginStorageKeys(left, right))
                    .map(([key, value]) => ({
                        key,
                        sizeBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength,
                        updatedAt: storage.updatedAt.get(key) ?? 0,
                        revision: storage.revisions.get(key) ?? 0,
                    }));
                const page = entries.slice(0, limit);
                return pluginOk({
                    entries: page,
                    ...(entries.length > page.length && page.length > 0
                        ? { nextCursor: `cursor:${page[page.length - 1]!.key}` }
                        : {}),
                });
            },
        });
    }
}

export function createPluginTestHost(options: PluginTestHostOptions = {}): PluginTestHost {
    return new PluginTestHost(options);
}

/** Recommended short name for the host-backed SDK harness. */
export function createTestHost(options: PluginTestHostOptions = {}): PluginTestHost {
    return createPluginTestHost(options);
}

/* ---------------------------------------------------------------------------
 * Portable profile test host
 * ------------------------------------------------------------------------ */

export interface PortableTestCall {
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly deadlineMs?: number;
}

export type PortableTestResponse = unknown | ((params: Readonly<Record<string, unknown>>) => unknown);

export interface PortableTestHostOptions {
    readonly approvedGrants?: readonly PluginGrant[];
    readonly supportedFeatures?: readonly string[];
    readonly pluginId?: string;
    readonly generation?: number;
    /** Canned capability answers: `ai.models`, `ai.complete`, custom methods. */
    readonly responses?: Readonly<Record<string, PortableTestResponse>>;
    readonly initialSettings?: Readonly<Record<string, PluginJsonValue>>;
    readonly initialStorage?: Readonly<Record<string, PluginJsonValue>>;
    /**
     * Capabilities this host does not provide. A call to an unavailable
     * capability is refused like the production broker refuses an unregistered
     * method, so a package cannot pass its tests against a host that would not
     * expose the capability in production.
     */
    readonly unavailableCapabilities?: readonly PluginTestCapability[];
}

export interface PortableTestHost {
    readonly client: PortableClient;
    readonly bootstrap: {
        readonly pluginId: string;
        readonly workspaceId: string;
        readonly abiVersion: number;
        readonly features: readonly string[];
        readonly grants: readonly string[];
        readonly session: { readonly sessionId: string; readonly sourceId: string; readonly generation: number };
    };
    readonly calls: PortableTestCall[];
    readonly renders: PortableUiView[];
    readonly contributions: readonly { readonly slot: string; readonly id: string; readonly view: PortableUiView }[];
    readonly events: readonly { readonly name: string; readonly payload: Readonly<Record<string, unknown>> }[];
    readonly settings: Map<string, PluginJsonValue>;
    readonly storage: Map<string, PluginJsonValue>;
    /**
     * Deliver a host→plugin request exactly as the runtime would: the resolved
     * value is the same `{ ok, result } | { ok: false, code, message }` envelope
     * `WorkerIsolationRuntime.callPlugin()` produces, never the raw handler
     * payload. Package tests must read `result` like production code does.
     */
    invokeRequest(
        method: string,
        params?: Readonly<Record<string, unknown>>
    ): Promise<{ readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly code: string; readonly message: string }>;
    /** True when a request handler is registered for the method. */
    hasRequestHandler(method: string): boolean;
}

/* ---------------------------------------------------------------------------
 * Portable UI validation mirror
 *
 * The host re-validates every rendered tree in `shared/plugins/isolation/
 * ui-primitives.ts`. The SDK package cannot import host code, so this mirrors
 * the host's schema and budgets for the test host. `tests/unit/
 * plugin-sdk-test-harness.test.ts` runs a corpus through both validators so a
 * drift in either one fails a repository test instead of silently weakening
 * package tests.
 * ------------------------------------------------------------------------ */

const TEST_UI_MAX_TEXT_BYTES = 8 * 1024;
const TEST_UI_MAX_TREE_BYTES = 64 * 1024;
const TEST_UI_MAX_NODES = 1000;
const TEST_UI_MAX_DEPTH = 12;
/** Whole-tree item budget (`maxUiTreeItems` in the host containment budgets). */
const TEST_UI_MAX_TREE_ITEMS = 12_000;
/** Per-collection cap (`PORTABLE_UI_MAX_ITEMS`: children, list items, rows). */
const TEST_UI_MAX_ITEMS = 200;
const TEST_UI_MAX_COLUMNS = 12;
const TEST_UI_MAX_OPTIONS = 100;
const TEST_UI_MAX_BADGES = 4;
const TEST_UI_MAX_ITEM_CHILDREN = 50;
const TEST_UI_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

const TEST_UI_FIELD_TYPES = new Set(['field.text', 'field.textarea', 'field.select', 'field.toggle']);
const TEST_UI_TONES = ['neutral', 'info', 'success', 'warning', 'danger'];
const TEST_UI_TEXT_TONES = ['default', 'muted', 'success', 'warning', 'danger'];
const TEST_UI_ACCENTS = ['slate', 'blue', 'violet', 'pink', 'green', 'amber', 'orange', 'red'];

function testUtf8Bytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

/**
 * Validate a rendered view the way the host does: known node types, host-safe
 * identifiers, per-string and whole-tree text budgets, node/depth/item caps.
 * Throws on the first violation with the offending field named.
 */
export function assertValidPortableTestView(view: PortableUiView, source: string): void {
    const rawView: unknown = view;
    if (!rawView || typeof rawView !== 'object' || !Array.isArray((rawView as { nodes?: unknown }).nodes)) {
        throw new Error(`${source}: render() requires a PortableUiView ({ title?, nodes })`);
    }
    let nodes = 0;
    let textBytes = 0;
    let items = 0;
    let maxDepth = 0;

    function fail(message: string): never {
        throw new Error(`${source}: ${message}`);
    }
    const addText = (value: string): void => {
        textBytes += testUtf8Bytes(value);
        if (textBytes > TEST_UI_MAX_TREE_BYTES) {
            fail(`UI tree text exceeds ${TEST_UI_MAX_TREE_BYTES} bytes`);
        }
    };
    const visitData = (value: unknown): void => {
        if (typeof value === 'string') {
            addText(value);
            return;
        }
        if (Array.isArray(value)) {
            items += value.length;
            if (items > TEST_UI_MAX_TREE_ITEMS) {
                fail(`UI tree has more than ${TEST_UI_MAX_TREE_ITEMS} items`);
            }
            for (const entry of value) visitData(entry);
            return;
        }
        if (value && typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>);
            items += entries.length;
            if (items > TEST_UI_MAX_TREE_ITEMS) {
                fail(`UI tree has more than ${TEST_UI_MAX_TREE_ITEMS} items`);
            }
            for (const [, entry] of entries) visitData(entry);
        }
    };
    const boundedString = (value: unknown, field: string, maxBytes = TEST_UI_MAX_TEXT_BYTES): string => {
        if (typeof value !== 'string') return fail(`${field} must be a string`);
        if (testUtf8Bytes(value) > maxBytes) fail(`${field} exceeds ${maxBytes} bytes`);
        return value;
    };
    const boundedId = (value: unknown, field: string): string => {
        if (typeof value !== 'string' || !TEST_UI_ID_PATTERN.test(value)) {
            fail(`${field} must match ${String(TEST_UI_ID_PATTERN)}`);
        }
        return value;
    };
    /**
     * Per-collection cap only. The whole-tree item budget is counted once, by
     * the generic `visitData` pass over the node's fields, exactly like the
     * host's `walkData`; counting here too would refuse trees production accepts.
     */
    const boundedItems = (value: unknown, field: string, max: number): readonly unknown[] => {
        if (!Array.isArray(value)) fail(`${field} must be an array`);
        if (value.length > max) fail(`${field} exceeds ${max}`);
        return value;
    };

    const visit = (raw: unknown, depth: number): void => {
        if (depth > TEST_UI_MAX_DEPTH) fail(`UI tree depth exceeds ${TEST_UI_MAX_DEPTH}`);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('UI node must be an object');
        maxDepth = Math.max(maxDepth, depth);
        nodes += 1;
        if (nodes > TEST_UI_MAX_NODES) fail(`UI tree has more than ${TEST_UI_MAX_NODES} nodes`);
        const node = raw as Record<string, unknown>;
        const type = typeof node.type === 'string' ? node.type : '';
        switch (type) {
            case 'heading':
                boundedString(node.text, 'heading.text', 512);
                if (node.level !== undefined && node.level !== 2 && node.level !== 3) fail('heading.level must be 2 or 3');
                if (node.description !== undefined) boundedString(node.description, 'heading.description', 1024);
                if (node.meta !== undefined) boundedString(node.meta, 'heading.meta', 256);
                break;
            case 'badge':
                boundedString(node.label, 'badge.label', 64);
                if (node.tone !== undefined && !TEST_UI_TONES.includes(String(node.tone))) {
                    fail('badge.tone must be one of neutral|info|success|warning|danger');
                }
                break;
            case 'divider':
                break;
            case 'item':
                boundedId(node.id, 'item.id');
                boundedString(node.label, 'item.label', 512);
                boundedString(node.action, 'item.action', 256);
                if (node.description !== undefined) boundedString(node.description, 'item.description', 1024);
                if (node.meta !== undefined) boundedString(node.meta, 'item.meta', 256);
                if (node.color !== undefined && !TEST_UI_ACCENTS.includes(String(node.color))) {
                    fail('item.color must be a known accent');
                }
                if (node.badges !== undefined) {
                    const badges = boundedItems(node.badges, 'item.badges', TEST_UI_MAX_BADGES);
                    for (const badge of badges) {
                        if (!badge || typeof badge !== 'object' || Array.isArray(badge)) {
                            fail('item.badges entries must be objects');
                        }
                        const record = badge as { label?: unknown; tone?: unknown };
                        boundedString(record.label, 'badge.label', 64);
                        if (record.tone !== undefined && !TEST_UI_TONES.includes(String(record.tone))) {
                            fail('badge.tone must be one of neutral|info|success|warning|danger');
                        }
                    }
                }
                if (node.deleteAction !== undefined) boundedString(node.deleteAction, 'item.deleteAction', 256);
                if (node.detailAction !== undefined) boundedString(node.detailAction, 'item.detailAction', 256);
                if (node.expandAction !== undefined) boundedString(node.expandAction, 'item.expandAction', 256);
                if (node.expanded !== undefined && typeof node.expanded !== 'boolean') {
                    fail('item.expanded must be boolean');
                }
                if (node.selected !== undefined && typeof node.selected !== 'boolean') fail('item.selected must be boolean');
                if (node.checked !== undefined && typeof node.checked !== 'boolean') fail('item.checked must be boolean');
                if (node.children !== undefined) {
                    boundedItems(node.children, 'item.children', TEST_UI_MAX_ITEM_CHILDREN);
                }
                break;
            case 'columns': {
                const bands = boundedItems(node.children, 'columns children', TEST_UI_MAX_COLUMNS);
                if (bands.length === 0) fail('columns requires column children');
                for (const band of bands) {
                    if (!band || typeof band !== 'object' || Array.isArray(band)) {
                        fail('columns children must be column nodes');
                    }
                    if ((band as { type?: unknown }).type !== 'column') {
                        fail('columns children must be column nodes');
                    }
                }
                break;
            }
            case 'column':
                if (
                    node.width !== undefined &&
                    !['sm', 'md', 'lg', 'fill'].includes(String(node.width))
                ) {
                    fail('column.width must be sm|md|lg|fill');
                }
                break;
            case 'text':
                boundedString(node.text, 'text');
                if (node.tone !== undefined && !TEST_UI_TEXT_TONES.includes(String(node.tone))) {
                    fail('text.tone must be one of default|muted|success|warning|danger');
                }
                break;
            case 'markdown':
                boundedString(node.markdown, 'markdown');
                break;
            case 'link': {
                boundedString(node.label, 'label', 512);
                const href = boundedString(node.href, 'href', 2048);
                if (!/^https:\/\//.test(href)) fail('link href must be an https URL');
                break;
            }
            case 'result':
                boundedString(node.label, 'result.label', 512);
                boundedString(node.text, 'result.text');
                break;
            case 'progress': {
                const value = Number(node.value);
                if (!Number.isFinite(value)) fail('progress.value must be a number');
                if (node.max !== undefined && (!Number.isFinite(Number(node.max)) || Number(node.max) <= 0)) {
                    fail('progress.max must be a positive number');
                }
                if (node.label !== undefined) boundedString(node.label, 'progress.label', 512);
                break;
            }
            case 'list': {
                const listItems = boundedItems(node.items, 'list items', TEST_UI_MAX_ITEMS);
                for (const item of listItems) {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        fail('list items must be objects');
                    }
                    const record = item as { label?: unknown; description?: unknown };
                    boundedString(record.label, 'item.label', 512);
                    if (record.description !== undefined) {
                        boundedString(record.description, 'item.description');
                    }
                }
                break;
            }
            case 'table': {
                const columns = boundedItems(node.columns, 'table columns', TEST_UI_MAX_COLUMNS);
                if (columns.length === 0) fail('table requires columns');
                for (const column of columns) {
                    if (!column || typeof column !== 'object' || Array.isArray(column)) {
                        fail('table columns must be objects');
                    }
                    const record = column as { key?: unknown; label?: unknown };
                    boundedString(record.key, 'column.key', 64);
                    boundedString(record.label, 'column.label', 512);
                }
                const rows = boundedItems(node.rows, 'table rows', TEST_UI_MAX_ITEMS);
                for (const row of rows) {
                    if (!row || typeof row !== 'object' || Array.isArray(row)) {
                        fail('table rows must be objects');
                    }
                    const record = row as Record<string, unknown>;
                    for (const column of columns) {
                        const key = String((column as { key: string }).key);
                        const cell = record[key];
                        if (cell === undefined || cell === null) continue;
                        boundedString(String(cell), `table cell ${key}`);
                    }
                }
                if (node.caption !== undefined) boundedString(node.caption, 'table.caption', 512);
                break;
            }
            case 'open-document':
                boundedString(node.label, 'open-document.label', 512);
                boundedId(node.documentId, 'open-document.documentId');
                break;
            case 'open-pane':
                boundedString(node.label, 'open-pane.label', 512);
                boundedId(node.paneId, 'open-pane.paneId');
                break;
            case 'form': {
                boundedId(node.id, 'form.id');
                if (
                    node.layout !== undefined &&
                    !['card', 'inline', 'plain'].includes(String(node.layout))
                ) {
                    fail('form.layout must be card|inline|plain');
                }
                const formChildren = Array.isArray(node.children) ? node.children : [];
                for (const child of formChildren) {
                    const childType =
                        child && typeof child === 'object' && !Array.isArray(child)
                            ? String((child as { type?: unknown }).type ?? '')
                            : '';
                    if (!childType.startsWith('field.') && childType !== 'button') {
                        fail('form children must be fields or buttons');
                    }
                }
                break;
            }
            case 'button':
                boundedId(node.id, 'button.id');
                boundedString(node.label, 'button.label', 512);
                boundedId(node.action, 'button.action');
                break;
            case 'field.text':
            case 'field.textarea':
            case 'field.select':
            case 'field.toggle': {
                boundedId(node.id, 'field.id');
                boundedString(node.label, 'field.label', 512);
                // The host reads a string value for text/textarea/select and
                // coerces anything else for toggle; anything stricter here
                // would refuse a tree production accepts.
                if (type !== 'field.toggle' && node.value !== undefined && typeof node.value !== 'string') {
                    fail('field.value must be a string');
                }
                if (node.description !== undefined) boundedString(node.description, 'field.description');
                if (type === 'field.text' && node.placeholder !== undefined) {
                    boundedString(node.placeholder, 'field.placeholder');
                }
                if (type === 'field.text' && node.search !== undefined && typeof node.search !== 'boolean') {
                    fail('field.search must be boolean');
                }
                if (type === 'field.select' && node.onChange !== undefined) {
                    boundedId(node.onChange, 'field.select.onChange');
                }
                if (type === 'field.select') {
                    const options = boundedItems(node.options, 'field.select options', TEST_UI_MAX_OPTIONS);
                    if (options.length === 0) fail('field.select requires options');
                    for (const option of options) {
                        if (!option || typeof option !== 'object' || Array.isArray(option)) {
                            fail('field.select options must be objects');
                        }
                        const record = option as { value?: unknown; label?: unknown };
                        boundedString(record.value, 'option.value', 512);
                        boundedString(record.label, 'option.label', 512);
                    }
                }
                break;
            }
            case 'stack':
                if (node.direction !== 'row' && node.direction !== 'column') {
                    fail('stack.direction must be row|column');
                }
                break;
            case 'box':
                break;
            default:
                if (!type) fail('UI node requires a type');
                fail(`Unsupported UI node type: ${type}`);
        }
        if (TEST_UI_FIELD_TYPES.has(type) && typeof node.value === 'string' && testUtf8Bytes(node.value) > TEST_UI_MAX_TEXT_BYTES) {
            fail(`field.value exceeds ${TEST_UI_MAX_TEXT_BYTES} bytes`);
        }
        const children = Array.isArray(node.children) ? node.children : [];
        if (children.length > TEST_UI_MAX_NODES) fail(`children exceeds ${TEST_UI_MAX_NODES} nodes`);
        for (const [key, value] of Object.entries(node)) {
            if (key === 'children' || key === 'type') continue;
            visitData(value);
        }
        for (const child of children) visit(child, depth + 1);
    };

    for (const node of [...view.nodes, ...(view.navigation ?? [])]) visit(node, 1);
}

/**
 * A portable-profile host stand-in for package tests.
 *
 * It implements the same `PortableClient` contract the sandbox shim provides, so
 * a package's `client.mjs` runs through the real `createPortablePlugin()` path
 * with canned capability answers and captured renders — no browser, no worker.
 */
export function createPortableTestHost(options: PortableTestHostOptions = {}): PortableTestHost {
    const calls: PortableTestCall[] = [];
    const renders: PortableUiView[] = [];
    const contributions: { slot: string; id: string; view: PortableUiView }[] = [];
    const events: { name: string; payload: Readonly<Record<string, unknown>> }[] = [];
    const requestHandlers = new Map<
        string,
        (params: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>
    >();
    const settings = new Map<string, PluginJsonValue>(Object.entries(options.initialSettings ?? {}));
    const storage = new Map<string, PluginJsonValue>(Object.entries(options.initialStorage ?? {}));
    const storageRevisions = new Map<string, number>(
        [...storage.keys()].map((key) => [key, 1])
    );
    const storageUpdatedAt = new Map<string, number>();
    const eventListeners = new Set<(event: { name: string; payload: Readonly<Record<string, unknown>> }) => void>();
    const unavailable = new Set<PluginTestCapability>(options.unavailableCapabilities ?? []);
    const responses = options.responses ?? {};
    const pluginId = options.pluginId ?? 'or3.test-plugin';
    const generation = options.generation ?? 1;

    const client: PortableClient = {
        emit(name, payload = {}) {
            const event = { name, payload };
            events.push(event);
            for (const listener of eventListeners) listener(event);
        },
        render(view) {
            // A test host that accepts any tree hides exactly the contract
            // errors (bad identifiers, oversized strings) the production host
            // refuses.
            assertValidPortableTestView(view, 'render');
            renders.push(view);
        },
        contribute(slot, id, view) {
            assertValidPortableTestView(view, 'contribute');
            contributions.push({ slot, id, view });
        },
        withdraw(id) {
            if (id === undefined) {
                contributions.length = 0;
                return;
            }
            const kept = contributions.filter((entry) => entry.id !== id);
            contributions.length = 0;
            contributions.push(...kept);
        },
        async call<T = unknown>(
            method: string,
            params: Readonly<Record<string, unknown>> = {},
            callOptions: { readonly deadlineMs?: number } = {}
        ): Promise<PortableHostResult<T>> {
            calls.push({
                method,
                params,
                ...(callOptions.deadlineMs === undefined ? {} : { deadlineMs: callOptions.deadlineMs }),
            });
            // The host-owned stores behave like the real ones, so a package's
            // settings/storage code is exercised without canned responses.
            const capability: PluginTestCapability | null = method.startsWith('settings.')
                ? 'settings'
                : method.startsWith('storage.')
                  ? 'storage'
                  : null;
            if (capability && unavailable.has(capability)) {
                return {
                    ok: false,
                    code: 'not-found',
                    message: `No host method ${method}`,
                };
            }
            const store = capability === 'settings' ? settings : capability === 'storage' ? storage : null;
            const key = typeof params.key === 'string' ? params.key : '';
            if (store) {
                if (method.endsWith('.get')) {
                    return { ok: true, result: { value: store.get(key) ?? null } as T };
                }
                if (method === 'storage.getRecord') {
                    const value = store.get(key) ?? null;
                    const serialized = JSON.stringify(value);
                    return {
                        ok: true,
                        result: {
                            value,
                            revision: storageRevisions.get(key) ?? 0,
                            sizeBytes: value === null ? 0 : new TextEncoder().encode(serialized).byteLength,
                            updatedAt: storageUpdatedAt.get(key) ?? 0,
                        } as T,
                    };
                }
                if (method.endsWith('.set')) {
                    const currentRevision = storageRevisions.get(key) ?? 0;
                    if (
                        method.startsWith('storage.') &&
                        params.ifRevision !== undefined &&
                        (params.ifRevision === null
                            ? store.has(key)
                            : params.ifRevision !== currentRevision)
                    ) {
                        return {
                            ok: false,
                            code: 'conflict',
                            message: 'Storage revision is stale',
                        };
                    }
                    store.set(key, (params.value ?? null) as PluginJsonValue);
                    if (method.startsWith('storage.')) {
                        storageRevisions.set(key, currentRevision + 1);
                        storageUpdatedAt.set(key, Date.now());
                    }
                    return { ok: true, result: {} as T };
                }
                if (method.endsWith('.delete')) {
                    store.delete(key);
                    if (method.startsWith('storage.')) {
                        storageRevisions.set(key, (storageRevisions.get(key) ?? 0) + 1);
                        storageUpdatedAt.set(key, Date.now());
                    }
                    return { ok: true, result: {} as T };
                }
                if (method === 'storage.listPage') {
                    const prefix = typeof params.prefix === 'string' ? params.prefix : '';
                    const cursor = typeof params.cursor === 'string' && params.cursor.startsWith('cursor:')
                        ? params.cursor.slice(7)
                        : '';
                    const limit = Math.max(1, Math.min(200, Math.floor(typeof params.limit === 'number' ? params.limit : 100)));
                    const all = [...store.entries()]
                        .filter(([entryKey]) => entryKey.startsWith(prefix) && comparePluginStorageKeys(entryKey, cursor) > 0)
                        .sort(([left], [right]) => comparePluginStorageKeys(left, right))
                        .map(([entryKey, value]) => ({
                            key: entryKey,
                            sizeBytes: new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength,
                            updatedAt: 0,
                            revision: storageRevisions.get(entryKey) ?? 0,
                        }));
                    const entries = all.slice(0, limit);
                    return {
                        ok: true,
                        result: {
                            entries,
                            ...(all.length > entries.length && entries.length > 0
                                ? { nextCursor: `cursor:${entries[entries.length - 1]!.key}` }
                                : {}),
                        } as T,
                    };
                }
                if (method.endsWith('.list')) {
                    const prefix = typeof params.prefix === 'string' ? params.prefix : '';
                    const entries = [...store.entries()]
                        .filter(([entryKey]) => entryKey.startsWith(prefix))
                        .map(([entryKey, value]) => ({
                            key: entryKey,
                            sizeBytes: new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength,
                            updatedAt: 0,
                            ...(method.startsWith('storage.') ? { revision: storageRevisions.get(entryKey) ?? 0 } : {}),
                        }));
                    return {
                        ok: true,
                        result: (method.startsWith('settings.')
                            ? { values: Object.fromEntries(store.entries()) }
                            : { entries }) as T,
                    };
                }
            }
            const configured = responses[method];
            if (configured === undefined) {
                return { ok: false, code: 'not-found', message: `No test response for ${method}` };
            }
            const value: unknown =
                typeof configured === 'function'
                    ? await (configured as (params: Readonly<Record<string, unknown>>) => unknown)(params)
                    : configured;
            // A canned refusal is returned verbatim, so failure paths are tested
            // through the same shape the real transport uses.
            if (value && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
                return value as PortableHostResult<T>;
            }
            return { ok: true, result: value as T };
        },
        onEvent(listener) {
            eventListeners.add(listener);
            return () => eventListeners.delete(listener);
        },
        onRequest(method, handler) {
            requestHandlers.set(method, handler);
            return () => {
                requestHandlers.delete(method);
            };
        },
    };

    return {
        client,
        bootstrap: {
            pluginId,
            workspaceId: 'test-workspace',
            abiVersion: 1,
            features: options.supportedFeatures ?? ['or3-portable-client-v1'],
            grants: options.approvedGrants ?? [],
            session: { sessionId: 'test-session', sourceId: 'test-source', generation },
        },
        calls,
        renders,
        contributions,
        events,
        settings,
        storage,
        hasRequestHandler: (method) => requestHandlers.has(method),
        async invokeRequest(method, params = {}) {
            const handler = requestHandlers.get(method);
            if (!handler) throw new Error(`No request handler registered for ${method}`);
            try {
                const result = await handler(params);
                return { ok: true, result };
            } catch (error) {
                return {
                    ok: false,
                    code: 'internal',
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}
