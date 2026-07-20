export type PluginTrustMode = 'trusted-host' | 'isolated-client' | 'isolated-server';
export type PluginClientIsolation = 'host' | 'iframe' | 'worker';
export type PluginServerRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type PluginGrant =
    | 'ui.dashboard.register'
    | 'documents.read'
    | 'documents.write'
    | 'tools.register.client'
    | 'tools.register.server'
    | 'hooks.register'
    | 'network.http'
    | 'storage.read'
    | 'storage.write'
    | 'settings.read'
    | 'settings.write';

export interface PluginDependencyV2 {
    readonly id: string;
    readonly range: string;
    readonly features?: readonly string[];
}

export interface PluginManifestV2 {
    readonly manifestVersion: 2;
    readonly kind: 'plugin';
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly capabilities?: readonly string[];
    readonly engines: {
        readonly or3: string;
        readonly pluginApi: string;
    };
    readonly runtime: {
        readonly client?: {
            readonly entry: string;
            readonly format: 'esm';
            readonly isolation: PluginClientIsolation;
        };
        readonly server?: {
            readonly entry?: string;
            readonly routes?: readonly {
                readonly method: PluginServerRouteMethod;
                readonly path: string;
                readonly handler: string;
                readonly permission?: string;
            }[];
        };
    };
    readonly requestedGrants: readonly PluginGrant[];
    readonly features: {
        readonly required: readonly string[];
        readonly optional: readonly string[];
    };
    readonly dependencies: {
        readonly required: readonly PluginDependencyV2[];
        readonly optional: readonly PluginDependencyV2[];
    };
    readonly trust: PluginTrustMode;
    readonly settings: {
        readonly schema?: string;
        readonly version: number;
    };
    readonly stateCompatibility: {
        readonly version: number;
        readonly reads: {
            readonly minimum: number;
            readonly maximum: number;
        };
        readonly rollback: 'safe' | 'migration-required' | 'unsupported';
    };
    readonly integrity?: {
        readonly package: `sha256-${string}`;
    };
}
