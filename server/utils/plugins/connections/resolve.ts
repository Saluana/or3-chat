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
    const secret = config.admin?.pluginConnectionSecret;
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
