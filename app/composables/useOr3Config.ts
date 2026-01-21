import { or3Config } from '../../config.or3';
import type { ResolvedOr3Config } from '../../types/or3-config';

/**
 * Access the validated OR3 base configuration.
 *
 * Returns the resolved config with all defaults applied.
 * This is SSR-compatible and returns the same values on server and client.
 *
 * @example
 * ```ts
 * const config = useOr3Config();
 * console.log(config.site.name); // 'OR3'
 * console.log(config.features.workflows.enabled); // true
 * ```
 */
export function useOr3Config(): Readonly<ResolvedOr3Config> {
    return or3Config;
}

/**
 * Check if a feature is enabled in the config.
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
    return or3Config.features[feature].enabled;
}

/**
 * Check if a specific workflow sub-feature is enabled.
 *
 * @param subFeature - The workflow sub-feature to check
 * @returns Whether the sub-feature is enabled (also checks master toggle)
 */
export function isWorkflowFeatureEnabled(
    subFeature: 'editor' | 'slashCommands' | 'execution'
): boolean {
    const { workflows } = or3Config.features;
    return workflows.enabled && workflows[subFeature];
}

/**
 * Check if a specific mentions sub-feature is enabled.
 *
 * @param source - The mention source to check
 * @returns Whether the source is enabled (also checks master toggle)
 */
export function isMentionSourceEnabled(source: 'documents' | 'conversations'): boolean {
    const { mentions } = or3Config.features;
    return mentions.enabled && mentions[source];
}
