import type {
    PluginHttpClient,
    PluginHttpRequest,
    PluginHttpResponse,
    PluginJsonValue,
    PluginSettingsClient,
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
import { createHostPluginContext, type HostPluginScope } from './host';
import type { PluginError, PluginErrorCode, PluginResult } from './results';
import { pluginError, pluginOk } from './results';
import type { PluginGrant } from './manifest';

export type PluginTestCapability = 'settings' | 'storage' | 'http';

export interface PluginTestHostOptions {
    readonly approvedGrants?: readonly PluginGrant[];
    readonly supportedFeatures?: readonly string[];
    readonly initialSettings?: Readonly<Record<string, PluginJsonValue>>;
    readonly initialStorage?: Readonly<Record<string, PluginJsonValue>>;
    readonly httpHandler?: (
        request: PluginHttpRequest,
        scope: HostPluginScope
    ) => Promise<PluginResult<PluginHttpResponse<unknown>>>;
}

export interface PluginTestHostSnapshot {
    readonly active: boolean;
    readonly generation: number;
    readonly contributionCount: number;
    readonly hookCount: number;
    readonly cleanupCount: number;
    readonly palettePostSources: readonly PluginContribution[];
    readonly paletteCommands: readonly PluginContribution[];
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

const logger: PluginLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

export class PluginTestHost {
    readonly #settings = new Map<string, PluginJsonValue>();
    readonly #storage = new Map<string, PluginJsonValue>();
    readonly #supportedFeatures: Set<string>;
    readonly #httpHandler?: PluginTestHostOptions['httpHandler'];
    readonly #failures = new Map<PluginTestCapability, PluginError>();
    #approvedGrants: Set<PluginGrant>;
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

    constructor(options: PluginTestHostOptions = {}) {
        this.#approvedGrants = new Set(options.approvedGrants ?? []);
        this.#supportedFeatures = new Set(options.supportedFeatures ?? []);
        this.#httpHandler = options.httpHandler;
        for (const [key, value] of Object.entries(options.initialSettings ?? {})) {
            this.#settings.set(key, value);
        }
        for (const [key, value] of Object.entries(options.initialStorage ?? {})) {
            this.#storage.set(key, value);
        }
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
            generation: this.#generation,
            contributionCount: this.#contributionCount,
            hookCount: this.#hookCount,
            cleanupCount: this.#cleanups.length,
            palettePostSources: Object.freeze([...this.#palettePostSources]),
            paletteCommands: Object.freeze([...this.#paletteCommands]),
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

    async activate(definition: Or3PluginDefinition): Promise<PluginTestActivationResult> {
        await this.deactivate();
        const generation = ++this.#generation;
        const controller = new AbortController();
        const cleanups: Array<() => void | Promise<void>> = [];
        const activations: Array<() => void | Promise<void>> = [];
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
                createHttpClient: (scope) => this.#createHttpClient(scope),
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
        this.#contributionCount = 0;
        this.#hookCount = 0;
        this.#palettePostSources = [];
        this.#paletteCommands = [];
        this.#commandHandlers.clear();
        if (firstFailure) throw firstFailure;
    }

    #guard(scope: HostPluginScope, grant: PluginGrant, capability: PluginTestCapability) {
        if (scope.generation !== this.#activeGeneration) {
            return errorResult('conflict', 'Plugin generation is stale');
        }
        if (scope.signal.aborted) return errorResult('aborted', 'Plugin generation is stopped');
        if (!scope.grants.has(grant)) {
            return errorResult('permission-denied', `Grant ${grant} was not approved`);
        }
        const failure = this.#failures.get(capability);
        if (failure) {
            this.#failures.delete(capability);
            return pluginError(failure.code, failure.message, {
                retryable: failure.retryable,
                details: failure.details,
            });
        }
        return null;
    }

    #createSettingsClient(scope: HostPluginScope): PluginSettingsClient {
        return Object.freeze({
            get: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'settings.read', 'settings');
                if (denied) return asFailure<T | null>(denied);
                return pluginOk((this.#settings.get(key) ?? null) as T | null);
            },
            list: async () => {
                const denied = this.#guard(scope, 'settings.read', 'settings');
                if (denied) return asFailure<Readonly<Record<string, PluginJsonValue>>>(denied);
                return pluginOk(Object.freeze(Object.fromEntries(this.#settings)));
            },
            set: async (key: string, value: PluginJsonValue) => {
                const denied = this.#guard(scope, 'settings.write', 'settings');
                if (denied) return asFailure<void>(denied);
                this.#settings.set(key, value);
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#guard(scope, 'settings.write', 'settings');
                if (denied) return asFailure<void>(denied);
                this.#settings.delete(key);
                return pluginOk(undefined);
            },
        });
    }

    #createStorageClient(scope: HostPluginScope): PluginStorageClient {
        return Object.freeze({
            get: async <T extends PluginJsonValue>(key: string) => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<T | null>(denied);
                return pluginOk((this.#storage.get(key) ?? null) as T | null);
            },
            set: async (key: string, value: PluginJsonValue) => {
                const denied = this.#guard(scope, 'storage.write', 'storage');
                if (denied) return asFailure<void>(denied);
                this.#storage.set(key, value);
                return pluginOk(undefined);
            },
            delete: async (key: string) => {
                const denied = this.#guard(scope, 'storage.write', 'storage');
                if (denied) return asFailure<void>(denied);
                this.#storage.delete(key);
                return pluginOk(undefined);
            },
            list: async (prefix = '') => {
                const denied = this.#guard(scope, 'storage.read', 'storage');
                if (denied) return asFailure<readonly never[]>(denied);
                return pluginOk(
                    [...this.#storage.entries()]
                        .filter(([key]) => key.startsWith(prefix))
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([key, value]) => ({
                            key,
                            sizeBytes: JSON.stringify(value).length,
                            updatedAt: 0,
                        }))
                );
            },
        });
    }

    #createHttpClient(scope: HostPluginScope): PluginHttpClient {
        return Object.freeze({
            request: async <T>(request: PluginHttpRequest) => {
                const denied = this.#guard(scope, 'network.http', 'http');
                if (denied) return asFailure<PluginHttpResponse<T>>(denied);
                if (!this.#httpHandler) {
                    return asFailure<PluginHttpResponse<T>>(
                        errorResult('host-unavailable', 'No fake HTTP handler is configured')
                    );
                }
                return (await this.#httpHandler(request, scope)) as PluginResult<
                    PluginHttpResponse<T>
                >;
            },
        });
    }
}

export function createPluginTestHost(options: PluginTestHostOptions = {}): PluginTestHost {
    return new PluginTestHost(options);
}
