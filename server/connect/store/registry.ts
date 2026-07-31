import { createRuntimeConfigRegistry } from '../../utils/registry/create-runtime-config-registry';
import type {
    ConnectStore,
    ConnectStoreRegistryItem,
} from './types';

const registry = createRuntimeConfigRegistry<
    ConnectStore,
    ConnectStoreRegistryItem
>({
    warnLabel: 'connect-store',
    cacheInstances: true,
    resolveActiveId: (config) => {
        const connect = (
            config as unknown as {
                connect?: { enabled?: boolean; provider?: string };
            }
        ).connect;
        return connect?.enabled ? connect.provider : null;
    },
});

export function registerConnectStore(item: ConnectStoreRegistryItem): void {
    registry.register(item);
}

export function getConnectStore(id: string): ConnectStore | null {
    return registry.get(id);
}

export function getActiveConnectStore(): ConnectStore | null {
    return registry.getActive();
}

export function listConnectStoreIds(): string[] {
    return registry.listIds();
}
