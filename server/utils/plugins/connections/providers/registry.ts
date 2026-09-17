/**
 * Provider registry for plugin connections.
 *
 * A provider declares the operations a plugin may run against it. The dispatcher
 * refuses anything not declared here, so there is no generic HTTP proxy.
 */

import type { ConnectionProviderDescriptor } from '~~/shared/plugins/connections/contracts';

const providers = new Map<string, ConnectionProviderDescriptor>();

export function registerConnectionProvider(provider: ConnectionProviderDescriptor): void {
    if (providers.has(provider.id)) {
        throw new Error(`Connection provider already registered: ${provider.id}`);
    }
    providers.set(provider.id, provider);
}

export function getConnectionProvider(id: string): ConnectionProviderDescriptor | null {
    return providers.get(id) ?? null;
}

export function listConnectionProviders(): readonly ConnectionProviderDescriptor[] {
    return [...providers.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Test helper: clear registrations between cases. */
export function clearConnectionProviders(): void {
    providers.clear();
}
