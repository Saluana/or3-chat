import { createError } from 'h3';
import { useRuntimeConfig } from '#imports';
import { createRuntimeConfigRegistry, type RuntimeConfigRegistryItem } from '../utils/registry/create-runtime-config-registry';

export type SecretScope = Readonly<{ namespace: string; ownerUserId: string; workspaceId: string; consumerId: string }>;
export type SecretContext = Readonly<{ requestId: string; actorId?: string; activationId?: string }>;
export type SecretMeta = Readonly<{ ref: { id: string; revision: number }; name: string; state: 'available' | 'deleted'; updatedAt: string }>;
export interface ServerSecretStore {
    inspect(input: { scope: SecretScope; name: string }, context?: Partial<SecretContext>): Promise<SecretMeta | null>;
    list(input: { scope: SecretScope; after?: string; limit?: number }, context?: Partial<SecretContext>): Promise<{ items: SecretMeta[]; next?: string }>;
    put(input: { scope: SecretScope; name: string; value: string; expectedRevision: number }, context?: Partial<SecretContext>): Promise<SecretMeta>;
    resolve(input: { scope: SecretScope; selector: { name: string } | { ref: { id: string; revision: number } } }, context?: Partial<SecretContext>): Promise<{ value: string; meta: SecretMeta }>;
    delete(input: { scope: SecretScope; name: string; expectedRevision: number }, context?: Partial<SecretContext>): Promise<SecretMeta>;
    available(context?: Partial<SecretContext>): Promise<void>;
}
const registry = createRuntimeConfigRegistry<ServerSecretStore, RuntimeConfigRegistryItem<ServerSecretStore>>({
    warnLabel: 'secrets:registry', cacheInstances: true,
    resolveActiveId: config => {
        const secrets = config.secrets as typeof config.secrets | undefined;
        return secrets?.provider;
    },
});
export const registerSecretStore = registry.register;
export const listSecretStoreIds = registry.listIds;
export function getActiveSecretStore(): ServerSecretStore | null {
    const store = registry.getActive();
    const config = useRuntimeConfig();
    const secrets = config.secrets as typeof config.secrets | undefined;
    if (!store && secrets?.provider) throw createError({ statusCode: 503, statusMessage: 'Secret provider unavailable' });
    return store;
}
