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

function waitForClerk(timeoutMs = 5000): Promise<ClerkClient | null> {
    return new Promise((resolve) => {
        const startTime = Date.now();

        const check = () => {
            const clerk = (window as unknown as { Clerk?: ClerkClient }).Clerk;
            if (clerk) {
                resolve(clerk);
                return;
            }

            // Check if timed out
            if (Date.now() - startTime > timeoutMs) {
                console.warn('[auth-token-broker] Clerk load timeout');
                resolve(null);
                return;
            }

            // Check again in 50ms
            setTimeout(check, 50);
        };

        check();
    });
}

export function useAuthTokenBroker(): AuthTokenBroker {
    const runtimeConfig = useRuntimeConfig();

    return {
        async getProviderToken(input) {
            if (!runtimeConfig.public.ssrAuthEnabled) {
                return null;
            }

            try {
                // Wait for Clerk to load with timeout
                const clerk = await waitForClerk();
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
