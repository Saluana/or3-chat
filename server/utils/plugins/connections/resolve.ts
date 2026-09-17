/**
 * Resolves the active plugin connection service for the running host.
 *
 * The store follows the active sync provider (SQLite in a Cloud deployment);
 * the encryption key comes from `OR3_PLUGIN_CONNECTION_SECRET` and is never
 * persisted. When no durable store is registered, the memory store is used and
 * `durable` reports false so callers do not imply persistence.
 */

import { useRuntimeConfig } from '#imports';
import { PluginConnectionService } from './service';
import {
    getPluginConnectionStore,
    listPluginConnectionStoreIds,
} from './store/registry';
import { createMemoryPluginConnectionStore } from './store/memory';

/**
 * The in-memory fallback is cached as well: a fresh store per call would imply a
 * session-scoped store that does not actually survive one request.
 */
let memoryStore: ReturnType<typeof createMemoryPluginConnectionStore> | null = null;

/**
 * The encryption key is read at runtime only. `admin.pluginConnectionSecret`
 * carries the Nuxt runtime override (containers translate
 * `OR3_PLUGIN_CONNECTION_SECRET` into `NUXT_ADMIN_PLUGIN_CONNECTION_SECRET` at
 * startup); the documented variable is also honoured directly, since reading it
 * here cannot bake it into a build.
 */
function connectionSecret(config: ConnectionRuntimeConfig): string | undefined {
    const fromRuntimeConfig = config.admin?.pluginConnectionSecret;
    if (typeof fromRuntimeConfig === 'string' && fromRuntimeConfig.trim().length > 0) {
        return fromRuntimeConfig;
    }
    const fromEnvironment = process.env.OR3_PLUGIN_CONNECTION_SECRET;
    return typeof fromEnvironment === 'string' && fromEnvironment.trim().length > 0
        ? fromEnvironment
        : undefined;
}

export interface ResolvedConnectionService {
    readonly service: PluginConnectionService;
    readonly storeId: string;
    readonly durable: boolean;
}

type ConnectionRuntimeConfig = {
    sync?: { provider?: string };
    public?: { sync?: { provider?: string } };
    admin?: { pluginConnectionSecret?: string };
};

function activeProviderId(config: ConnectionRuntimeConfig): string | null {
    const provider =
        config.sync?.provider ?? config.public?.sync?.provider ?? undefined;
    return typeof provider === 'string' && provider.length > 0 ? provider : null;
}

export function resolveConnectionService(
    config: ConnectionRuntimeConfig = useRuntimeConfig() as ConnectionRuntimeConfig
): ResolvedConnectionService {
    const secret = connectionSecret(config);
    const providerId = activeProviderId(config);
    const registered = providerId ? getPluginConnectionStore(providerId) : null;

    if (registered) {
        return {
            service: new PluginConnectionService({ store: registered, secret }),
            storeId: providerId!,
            durable: true,
        };
    }

    memoryStore ??= createMemoryPluginConnectionStore();
    return {
        service: new PluginConnectionService({ store: memoryStore, secret }),
        storeId: providerId ?? 'memory',
        durable: false,
    };
}

export function listRegisteredConnectionStores(): readonly string[] {
    return listPluginConnectionStoreIds();
}
