/**
 * Client-side AuthTokenBroker.
 * Uses Clerk's session when available to mint provider JWTs.
 */
import { useRuntimeConfig } from '#imports';

export interface ProviderTokenRequest {
    providerId: string;
    template?: string;
}

export interface AuthTokenBroker {
    getProviderToken(input: ProviderTokenRequest): Promise<string | null>;
}

// Clerk client type
interface ClerkClient {
    session?: {
        getToken: (options?: { template?: string }) => Promise<string | null>;
    } | null;
}

export function useAuthTokenBroker(): AuthTokenBroker {
    const runtimeConfig = useRuntimeConfig();

    return {
        async getProviderToken(input) {
            if (!runtimeConfig.public.ssrAuthEnabled) {
                return null;
            }

            try {
                // Access Clerk via window object (set by @clerk/nuxt)
                const clerk = (window as unknown as { Clerk?: ClerkClient }).Clerk;
                if (!clerk?.session) {
                    return null;
                }

                return await clerk.session.getToken({ template: input.template });
            } catch (error) {
                console.error('[auth-token-broker] Failed to get provider token:', error);
                return null;
            }
        },
    };
}
