import { useRuntimeConfig } from '#imports';
import { or3Config } from '../../config.or3';
import type { ResolvedOr3Config } from '../../types/or3-config';

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
    // On client-side, merge with runtime config to get admin dashboard changes
    if (process.client) {
        const runtimeConfig = useRuntimeConfig();
        const publicFeatures = runtimeConfig.public.features;

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (publicFeatures) {
            return {
                ...or3Config,
                features: {
                    workflows: {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        enabled: publicFeatures.workflows?.enabled ?? or3Config.features.workflows.enabled,
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        editor: publicFeatures.workflows?.editor ?? or3Config.features.workflows.editor,
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        slashCommands: publicFeatures.workflows?.slashCommands ?? or3Config.features.workflows.slashCommands,
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        execution: publicFeatures.workflows?.execution ?? or3Config.features.workflows.execution,
                    },
                    documents: {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        enabled: publicFeatures.documents?.enabled ?? or3Config.features.documents.enabled,
                    },
                    backup: {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        enabled: publicFeatures.backup?.enabled ?? or3Config.features.backup.enabled,
                    },
                    mentions: {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        enabled: publicFeatures.mentions?.enabled ?? or3Config.features.mentions.enabled,
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        documents: publicFeatures.mentions?.documents ?? or3Config.features.mentions.documents,
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        conversations: publicFeatures.mentions?.conversations ?? or3Config.features.mentions.conversations,
                    },
                    dashboard: {
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        enabled: publicFeatures.dashboard?.enabled ?? or3Config.features.dashboard.enabled,
                    },
                },
            };
        }
    }
    
    return or3Config;
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
    if (process.client) {
        const runtimeConfig = useRuntimeConfig();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return runtimeConfig.public.features?.[feature]?.enabled ?? or3Config.features[feature].enabled;
    }
    return or3Config.features[feature].enabled;
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
    if (process.client) {
        const runtimeConfig = useRuntimeConfig();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const workflows = runtimeConfig.public.features?.workflows;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (workflows) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            return workflows.enabled && (workflows[subFeature] ?? true);
        }
    }
    const { workflows } = or3Config.features;
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
    if (process.client) {
        const runtimeConfig = useRuntimeConfig();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const mentions = runtimeConfig.public.features?.mentions;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (mentions) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            return mentions.enabled && (mentions[source] ?? true);
        }
    }
    const { mentions } = or3Config.features;
    return mentions.enabled && mentions[source];
}
