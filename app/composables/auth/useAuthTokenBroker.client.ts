/**
 * Client-side AuthTokenBroker registry.
 * Provider packages register implementations during Nuxt plugin setup.
 */
import { useRuntimeConfig } from '#imports';

export interface ProviderTokenRequest {
    providerId: string;
    template?: string;
}

export interface AuthTokenBroker {
    getProviderToken(input: ProviderTokenRequest): Promise<string | null>;
}

export type AuthTokenBrokerFactory = () => AuthTokenBroker;

const DEFAULT_BROKER: AuthTokenBroker = {
    async getProviderToken() {
        return null;
    },
};

const GLOBAL_KEY = '__or3_client_auth_token_broker__';

type BrokerRegistry = {
    factory?: AuthTokenBrokerFactory;
};

function getRegistry(): BrokerRegistry {
    const globalAny = globalThis as typeof globalThis & {
        [GLOBAL_KEY]?: BrokerRegistry;
    };
    if (!globalAny[GLOBAL_KEY]) {
        globalAny[GLOBAL_KEY] = {};
    }
    return globalAny[GLOBAL_KEY]!;
}

export function registerAuthTokenBroker(factory: AuthTokenBrokerFactory): void {
    const registry = getRegistry();
    registry.factory = factory;
}

export function useAuthTokenBroker(): AuthTokenBroker {
    const runtimeConfig = useRuntimeConfig();

    return {
        async getProviderToken(input) {
            if (!runtimeConfig.public.ssrAuthEnabled) {
                return null;
            }
            try {
                // Resolve the broker lazily so late-registered providers are honored.
                const registry = getRegistry();
                const broker = registry.factory ? registry.factory() : DEFAULT_BROKER;
                return await broker.getProviderToken(input);
            } catch (error) {
                console.error('[auth-token-broker] Failed to get provider token', {
                    providerId: input.providerId,
                    error,
                });
                return null;
            }
        },
    };
}
