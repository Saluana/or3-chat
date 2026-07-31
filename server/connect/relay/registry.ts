import { createRuntimeConfigRegistry } from '../../utils/registry/create-runtime-config-registry';
import type {
    ConnectRelay,
    ConnectRelayRegistryItem,
} from './types';

const registry = createRuntimeConfigRegistry<
    ConnectRelay,
    ConnectRelayRegistryItem
>({
    warnLabel: 'connect-relay',
    cacheInstances: true,
    resolveActiveId: (config) => {
        const connect = (
            config as unknown as {
                connect?: { enabled?: boolean; relayProvider?: string };
            }
        ).connect;
        return connect?.enabled ? connect.relayProvider : null;
    },
});

export function registerConnectRelay(item: ConnectRelayRegistryItem): void {
    registry.register(item);
}

export function getConnectRelay(id: string): ConnectRelay | null {
    return registry.get(id);
}

export function getActiveConnectRelay(): ConnectRelay | null {
    return registry.getActive();
}

export function listConnectRelayIds(): string[] {
    return registry.listIds();
}
