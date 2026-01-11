/**
 * Auth token broker for provider-specific JWT templates.
 * Used by direct sync providers to obtain backend-specific tokens.
 */

export interface AuthTokenBroker {
    /**
     * Get a provider-specific token using a JWT template.
     * @param input.providerId - Target provider (e.g., 'convex', 'supabase')
     * @param input.template - Optional JWT template name
     * @returns Token string or null if unavailable
     */
    getProviderToken(input: {
        providerId: string;
        template?: string;
    }): Promise<string | null>;
}

/**
 * Create a token broker instance.
 * Stub implementation - will be wired to Clerk's getToken() when in direct mode.
 */
export function createTokenBroker(): AuthTokenBroker {
    return {
        async getProviderToken(_input) {
            // TODO: Wire to Clerk's getToken({ template }) for direct provider access
            // Example: return await clerkClient.sessions.getToken({ template: input.template })
            return null;
        },
    };
}
