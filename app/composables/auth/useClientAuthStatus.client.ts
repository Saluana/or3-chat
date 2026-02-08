/**
 * Client-side auth status resolver registry.
 *
 * Provider packages can register a resolver that reports whether the
 * provider SDK is ready and whether a user session is present.
 */

export interface ClientAuthStatus {
    ready: boolean;
    authenticated: boolean | undefined;
}

export type ClientAuthStatusResolver = () =>
    | ClientAuthStatus
    | Promise<ClientAuthStatus>;

const GLOBAL_KEY = '__or3_client_auth_status_resolver__';

type ResolverRegistry = {
    resolver?: ClientAuthStatusResolver;
};

function getRegistry(): ResolverRegistry {
    const globalAny = globalThis as typeof globalThis & {
        [GLOBAL_KEY]?: ResolverRegistry;
    };
    if (!globalAny[GLOBAL_KEY]) {
        globalAny[GLOBAL_KEY] = {};
    }
    return globalAny[GLOBAL_KEY]!;
}

export function registerClientAuthStatusResolver(
    resolver: ClientAuthStatusResolver
): void {
    const registry = getRegistry();
    registry.resolver = resolver;
}

export async function resolveClientAuthStatus(): Promise<ClientAuthStatus> {
    const resolver = getRegistry().resolver;
    if (!resolver) {
        return { ready: true, authenticated: undefined };
    }
    return await resolver();
}
