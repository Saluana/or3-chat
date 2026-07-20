/**
 * Shared OpenRouter key availability policy used by chat input, welcome card,
 * sidebar connect affordances, and AI send guards.
 */
export type OpenRouterPublicConfig = {
    allowUserOverride?: boolean;
    requireUserKey?: boolean;
    hasInstanceKey?: boolean;
};

export type OpenRouterKeyAvailability = {
    requireUserKey: boolean;
    allowUserOverride: boolean;
    hasInstanceKey: boolean;
    /** True when the UI should offer connect / paste-key affordances. */
    canAcceptUserKey: boolean;
    /** True when the user already has a usable key path (user or instance). */
    hasUsableKey: (userKey: string | null | undefined) => boolean;
};

export function resolveOpenRouterKeyAvailability(
    config: OpenRouterPublicConfig | null | undefined
): OpenRouterKeyAvailability {
    const requireUserKey = config?.requireUserKey === true;
    const allowUserOverride =
        config?.allowUserOverride !== false || requireUserKey;
    const hasInstanceKey =
        config?.hasInstanceKey === true && !requireUserKey;

    return {
        requireUserKey,
        allowUserOverride,
        hasInstanceKey,
        canAcceptUserKey: allowUserOverride && !hasInstanceKey,
        hasUsableKey: (userKey) => Boolean(userKey) || hasInstanceKey,
    };
}
