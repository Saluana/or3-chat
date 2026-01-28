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
        
        if (publicFeatures) {
            return {
                ...or3Config,
                features: {
                    workflows: {
                        enabled: publicFeatures.workflows?.enabled ?? or3Config.features.workflows.enabled,
                        editor: publicFeatures.workflows?.editor ?? or3Config.features.workflows.editor,
                        slashCommands: publicFeatures.workflows?.slashCommands ?? or3Config.features.workflows.slashCommands,
                        execution: publicFeatures.workflows?.execution ?? or3Config.features.workflows.execution,
                    },
                    documents: {
                        enabled: publicFeatures.documents?.enabled ?? or3Config.features.documents.enabled,
                    },
                    backup: {
                        enabled: publicFeatures.backup?.enabled ?? or3Config.features.backup.enabled,
                    },
                    mentions: {
                        enabled: publicFeatures.mentions?.enabled ?? or3Config.features.mentions.enabled,
                        documents: publicFeatures.mentions?.documents ?? or3Config.features.mentions.documents,
                        conversations: publicFeatures.mentions?.conversations ?? or3Config.features.mentions.conversations,
                    },
                    dashboard: {
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
        const workflows = runtimeConfig.public.features?.workflows;
        if (workflows) {
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
        const mentions = runtimeConfig.public.features?.mentions;
        if (mentions) {
            return mentions.enabled && (mentions[source] ?? true);
        }
    }
    const { mentions } = or3Config.features;
    return mentions.enabled && mentions[source];
}
