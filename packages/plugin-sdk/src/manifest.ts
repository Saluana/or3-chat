export type PluginTrustMode = 'trusted-host' | 'isolated-client' | 'isolated-server';
export type PluginClientIsolation = 'host' | 'iframe' | 'worker';
export type PluginServerRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type PluginGrant =
    | 'ui.dashboard.register'
    | 'ui.sidebar.register'
    | 'ui.pane.register'
    | 'ui.card.register'
    | 'ui.action.register'
    | 'ui.command-palette.register'
    | 'ui.toast'
    | 'ui.confirm'
    | 'ui.progress'
    | 'panes.open'
    | 'commands.register'
    | 'commands.run.public'
    | 'chat.create'
    | 'chat.read'
    | 'chat.message.write'
    | 'workspace.read'
    | 'workspace.switch'
    | 'workspace.connections.read'
    | 'workspace.connections.manage'
    | 'events.register'
    | 'ai.models'
    | 'ai.complete'
    | 'secrets.read'
    | 'secrets.write'
    | 'secrets.use'
    | 'files.pick'
    | 'files.read'
    | 'files.write'
    | 'network.stream'
    | 'activity.register'
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
    /** Package-relative path to a validated static PNG or WebP app icon. */
    readonly icon?: string;
    /** Publisher-declared SPDX license identifier or expression. */
    readonly license?: string;
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
