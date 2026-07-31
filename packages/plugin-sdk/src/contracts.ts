import type { PluginGrant, PluginManifestV2, PluginTrustMode } from './manifest';
import type { PluginHttpClient, PluginSettingsClient, PluginStorageClient } from './clients';

export interface PluginRegistrationHandle {
    readonly dispose: () => void;
}

export interface PluginLogger {
    debug(message: string, context?: Readonly<Record<string, unknown>>): void;
    info(message: string, context?: Readonly<Record<string, unknown>>): void;
    warn(message: string, context?: Readonly<Record<string, unknown>>): void;
    error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface PluginFeatureNegotiation {
    has(feature: string): boolean;
    require(feature: string): void;
    optional(feature: string): boolean;
    readonly available: ReadonlySet<string>;
}

export type PluginContributionKind =
    | 'ui.dashboard.card'
    | 'ui.sidebar.section'
    | 'ui.pane.app'
    | 'ui.command-palette.post-source'
    | 'ui.command-palette.command'
    | 'chat.action'
    | 'chat.tool.client'
    | 'chat.tool.server'
    | 'editor.extension'
    | 'editor.inspector.panel'
    | 'document.ai.action'
    | 'admin.extension';

/** Declarative command-palette post source (no function closures). */
export interface PluginCommandPalettePostSourceDefinition {
    readonly id: string;
    readonly label: string;
    readonly postType: string;
    readonly categoryId: string;
    readonly filterAliases: readonly string[];
    readonly icon?: string;
    readonly order?: number;
    readonly metaKeys?: readonly string[];
    readonly openTarget:
        | { readonly kind: 'pane-app'; readonly appId: string }
        | {
              readonly kind: 'dashboard';
              readonly pluginId: string;
              readonly pageId?: string;
          };
}

/** Declarative command-palette command metadata (handler is host-mediated). */
export interface PluginCommandPaletteCommandDefinition {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly keywords?: readonly string[];
    readonly icon?: string;
    readonly order?: number;
    readonly closeOnSuccess?: boolean;
}

export interface PluginContribution<TDefinition = unknown> {
    readonly kind: PluginContributionKind;
    readonly id: string;
    readonly definition: TDefinition;
    readonly priority?: number;
}

export interface PluginContributions {
    register<TDefinition>(
        contribution: PluginContribution<TDefinition>
    ): PluginRegistrationHandle;
}

export interface PluginHookOptions {
    readonly priority?: number;
    readonly signal?: AbortSignal;
}

export interface PluginHooks {
    onAction<TArgs extends readonly unknown[]>(
        hookName: string,
        callback: (...args: TArgs) => void | Promise<void>,
        options?: PluginHookOptions
    ): PluginRegistrationHandle;
    onFilter<TValue, TArgs extends readonly unknown[]>(
        hookName: string,
        callback: (value: TValue, ...args: TArgs) => TValue | Promise<TValue>,
        options?: PluginHookOptions
    ): PluginRegistrationHandle;
}

export const hostCreatedPluginContext = Symbol('or3.host-created-plugin-context');

/** Context identity and authority are created by the host, never supplied by plugin input. */
export interface PluginContext {
    readonly [hostCreatedPluginContext]: true;
    readonly pluginId: string;
    readonly version: string;
    readonly generation: number;
    readonly trust: PluginTrustMode;
    readonly grants: ReadonlySet<PluginGrant>;
    readonly signal: AbortSignal;
    readonly logger: PluginLogger;
    readonly features: PluginFeatureNegotiation;
    readonly hooks: PluginHooks;
    readonly contributions: PluginContributions;
    readonly settings: PluginSettingsClient;
    readonly storage: PluginStorageClient;
    readonly http: PluginHttpClient;
    onCleanup(callback: () => void | Promise<void>): void;
    onActivate(callback: () => void | Promise<void>): void;
}

export interface Or3PluginDefinition<TManifest extends PluginManifestV2 = PluginManifestV2> {
    readonly manifest: TManifest;
    setup(context: PluginContext): void | Promise<void>;
}

/** Identity helper: validation and context construction remain host responsibilities. */
export function defineOr3Plugin<const TManifest extends PluginManifestV2>(
    definition: Or3PluginDefinition<TManifest>
): Or3PluginDefinition<TManifest> {
    return Object.freeze(definition);
}
