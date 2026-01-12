/**
 * Client-side AuthTokenBroker.
 * Uses Clerk's useAuth() when available to mint provider JWTs.
 */
import { useRuntimeConfig } from '#imports';

export interface ProviderTokenRequest {
    providerId: string;
    template?: string;
}

export interface AuthTokenBroker {
    getProviderToken(input: ProviderTokenRequest): Promise<string | null>;
}

type UseAuthComposable = () => {
    getToken: { value: (options?: { template?: string; skipCache?: boolean }) => Promise<string | null> };
};

let cachedUseAuth: UseAuthComposable | undefined;

async function resolveUseAuth(): Promise<UseAuthComposable | undefined> {
    if (cachedUseAuth !== undefined) {
        return cachedUseAuth;
    }

    try {
        const imports = (await import('#imports')) as { useAuth?: UseAuthComposable };
        cachedUseAuth = imports.useAuth;
    } catch {
        cachedUseAuth = undefined;
    }

    return cachedUseAuth;
}

export function useAuthTokenBroker(): AuthTokenBroker {
    const runtimeConfig = useRuntimeConfig();
    let auth: ReturnType<UseAuthComposable> | null = null;

    return {
        async getProviderToken(input) {
            if (!runtimeConfig.public.ssrAuthEnabled) {
                return null;
            }

            const useAuth = await resolveUseAuth();
            if (!useAuth) {
                return null;
            }

            if (!auth) {
                auth = useAuth();
            }

            try {
                return await auth.getToken.value({
                    template: input.template,
                    skipCache: false,
                });
            } catch (error) {
                console.error('[auth-token-broker] Failed to get provider token:', error);
                return null;
            }
        },
    };
}
