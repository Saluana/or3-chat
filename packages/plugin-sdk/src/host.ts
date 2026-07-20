import type {
    PluginHttpClient,
    PluginSettingsClient,
    PluginStorageClient,
} from './clients';
import {
    hostCreatedPluginContext,
    type PluginContext,
    type PluginContributions,
    type PluginFeatureNegotiation,
    type PluginHooks,
    type PluginLogger,
} from './contracts';
import type { PluginGrant, PluginTrustMode } from './manifest';

export interface HostPluginScope {
    readonly pluginId: string;
    readonly version: string;
    readonly generation: number;
    readonly trust: PluginTrustMode;
    readonly grants: ReadonlySet<PluginGrant>;
    readonly signal: AbortSignal;
}

export interface HostPluginClientFactories {
    createSettingsClient(scope: HostPluginScope): PluginSettingsClient;
    createStorageClient(scope: HostPluginScope): PluginStorageClient;
    createHttpClient(scope: HostPluginScope): PluginHttpClient;
}

export interface CreateHostPluginContextInput {
    readonly identity: {
        readonly pluginId: string;
        readonly version: string;
        readonly generation: number;
        readonly trust: PluginTrustMode;
    };
    readonly grants: readonly PluginGrant[];
    readonly signal: AbortSignal;
    readonly logger: PluginLogger;
    readonly features: PluginFeatureNegotiation;
    readonly hooks: PluginHooks;
    readonly contributions: PluginContributions;
    readonly clients: HostPluginClientFactories;
    readonly onCleanup: (callback: () => void | Promise<void>) => void;
    readonly onActivate: (callback: () => void | Promise<void>) => void;
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
        ) => {
            set.forEach((value) => callback.call(thisArg, value, value, facade));
        },
        entries: () => set.entries(),
        keys: () => set.keys(),
        values: () => set.values(),
        [Symbol.iterator]: () => set[Symbol.iterator](),
    } as ReadonlySet<T>;
    return Object.freeze(facade);
}

/** Host-only construction boundary that closes identity over every mediated client. */
export function createHostPluginContext(input: CreateHostPluginContextInput): PluginContext {
    const grants = readonlySet(input.grants);
    const scope: HostPluginScope = Object.freeze({
        pluginId: input.identity.pluginId,
        version: input.identity.version,
        generation: input.identity.generation,
        trust: input.identity.trust,
        grants,
        signal: input.signal,
    });
    return Object.freeze({
        [hostCreatedPluginContext]: true as const,
        pluginId: scope.pluginId,
        version: scope.version,
        generation: scope.generation,
        trust: scope.trust,
        grants,
        signal: scope.signal,
        logger: input.logger,
        features: input.features,
        hooks: input.hooks,
        contributions: input.contributions,
        settings: input.clients.createSettingsClient(scope),
        storage: input.clients.createStorageClient(scope),
        http: input.clients.createHttpClient(scope),
        onCleanup: input.onCleanup,
        onActivate: input.onActivate,
    });
}
