import { useRuntimeConfig } from '#imports';
import type { ResolvedOr3Config } from '../../types/or3-config';

const FALLBACK_OR3_CONFIG: ResolvedOr3Config = {
    site: {
        name: 'OR3',
        description: '',
        logoUrl: '',
        faviconUrl: '',
        defaultTheme: 'blank',
    },
    features: {
        workflows: {
            enabled: true,
            editor: true,
            slashCommands: true,
            execution: true,
        },
        documents: {
            enabled: true,
        },
        backup: {
            enabled: true,
        },
        mentions: {
            enabled: true,
            documents: true,
            conversations: true,
        },
        dashboard: {
            enabled: true,
        },
    },
    limits: {
        maxFileSizeBytes: 20 * 1024 * 1024,
        maxCloudFileSizeBytes: 100 * 1024 * 1024,
        maxFilesPerMessage: 10,
        localStorageQuotaMB: null,
    },
    ui: {
        defaultPaneCount: 1,
        maxPanes: 4,
        sidebarCollapsedByDefault: false,
    },
    extensions: {
        plugins: {
            modules: [],
            defaultEnabled: [],
        },
    },
    legal: {
        termsUrl: '',
        privacyUrl: '',
    },
};

function parsePositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.floor(parsed);
}

/**
 * Access the validated OR3 base configuration.
 *
 * Returns the resolved config with all defaults applied.
 * On client-side, merges with runtime config to pick up admin dashboard changes.
 *
 * @example
 * ```ts
 * const config = useOr3Config();
 * console.log(config.site.name); // 'OR3'
 * console.log(config.features.workflows.enabled); // true
 * ```
 */
export function useOr3Config(): Readonly<ResolvedOr3Config> {
    const runtimeConfig = useRuntimeConfig();
    const publicConfig = runtimeConfig.public as unknown as {
        features?: Partial<ResolvedOr3Config['features']>;
        or3?: {
            site?: Partial<ResolvedOr3Config['site']>;
            limits?: {
                maxFileSizeBytes?: number | string;
                maxCloudFileSizeBytes?: number | string;
                maxFilesPerMessage?: number | string;
                localStorageQuotaMB?: number | string | null;
            };
            ui?: Partial<ResolvedOr3Config['ui']>;
            legal?: Partial<ResolvedOr3Config['legal']>;
            plugins?: {
                defaultEnabled?: string[];
            };
        };
    };

    const rawLimits = publicConfig.or3?.limits;
    const maxFileSizeBytes =
        parsePositiveNumber(rawLimits?.maxFileSizeBytes) ??
        FALLBACK_OR3_CONFIG.limits.maxFileSizeBytes;
    const maxCloudFileSizeBytes =
        parsePositiveNumber(rawLimits?.maxCloudFileSizeBytes) ??
        FALLBACK_OR3_CONFIG.limits.maxCloudFileSizeBytes;
    const maxFilesPerMessage =
        parsePositiveNumber(rawLimits?.maxFilesPerMessage) ??
        FALLBACK_OR3_CONFIG.limits.maxFilesPerMessage;
    const localStorageQuotaMB: number | null =
        rawLimits?.localStorageQuotaMB == null
            ? null
            : parsePositiveNumber(rawLimits.localStorageQuotaMB) ??
              FALLBACK_OR3_CONFIG.limits.localStorageQuotaMB;

    return {
        ...FALLBACK_OR3_CONFIG,
        site: {
            ...FALLBACK_OR3_CONFIG.site,
            ...(publicConfig.or3?.site ?? {}),
        },
        limits: {
            maxFileSizeBytes,
            maxCloudFileSizeBytes,
            maxFilesPerMessage,
            localStorageQuotaMB,
        },
        ui: {
            ...FALLBACK_OR3_CONFIG.ui,
            ...(publicConfig.or3?.ui ?? {}),
        },
        legal: {
            ...FALLBACK_OR3_CONFIG.legal,
            ...(publicConfig.or3?.legal ?? {}),
        },
        extensions: {
            ...FALLBACK_OR3_CONFIG.extensions,
            plugins: {
                ...FALLBACK_OR3_CONFIG.extensions.plugins,
                defaultEnabled:
                    publicConfig.or3?.plugins?.defaultEnabled ??
                    FALLBACK_OR3_CONFIG.extensions.plugins.defaultEnabled,
            },
        },
        features: {
            workflows: {
                ...FALLBACK_OR3_CONFIG.features.workflows,
                ...(publicConfig.features?.workflows ?? {}),
            },
            documents: {
                ...FALLBACK_OR3_CONFIG.features.documents,
                ...(publicConfig.features?.documents ?? {}),
            },
            backup: {
                ...FALLBACK_OR3_CONFIG.features.backup,
                ...(publicConfig.features?.backup ?? {}),
            },
            mentions: {
                ...FALLBACK_OR3_CONFIG.features.mentions,
                ...(publicConfig.features?.mentions ?? {}),
            },
            dashboard: {
                ...FALLBACK_OR3_CONFIG.features.dashboard,
                ...(publicConfig.features?.dashboard ?? {}),
            },
        },
    };
}

/**
 * Check if a feature is enabled in the config.
 * Reads from runtime config on client-side to respect admin dashboard settings.
 *
 * @param feature - The feature name to check
 * @returns Whether the feature is enabled
 *
 * @example
 * ```ts
 * if (isFeatureEnabled('workflows')) {
 *     // Initialize workflow feature
 * }
 * ```
 */
export function isFeatureEnabled(
    feature: 'workflows' | 'documents' | 'backup' | 'mentions' | 'dashboard'
): boolean {
    return useOr3Config().features[feature].enabled;
}

/**
 * Check if a specific workflow sub-feature is enabled.
 * Reads from runtime config on client-side to respect admin dashboard settings.
 *
 * @param subFeature - The workflow sub-feature to check
 * @returns Whether the sub-feature is enabled (also checks master toggle)
 */
export function isWorkflowFeatureEnabled(
    subFeature: 'editor' | 'slashCommands' | 'execution'
): boolean {
    const { workflows } = useOr3Config().features;
    return workflows.enabled && workflows[subFeature];
}

/**
 * Check if a specific mentions sub-feature is enabled.
 * Reads from runtime config on client-side to respect admin dashboard settings.
 *
 * @param source - The mention source to check
 * @returns Whether the source is enabled (also checks master toggle)
 */
export function isMentionSourceEnabled(source: 'documents' | 'conversations'): boolean {
    const { mentions } = useOr3Config().features;
    return mentions.enabled && mentions[source];
}
