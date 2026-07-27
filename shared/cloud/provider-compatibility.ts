export type ProviderRole = 'auth' | 'sync' | 'storage';

export interface ProviderPackageContract {
    packageName: string;
    roles: readonly ProviderRole[];
}

export interface SupportedProviderStack {
    id: string;
    auth: string | null;
    sync: string | null;
    storage: string | null;
}

export const LOCAL_PROVIDER_IDS = new Set([
    'custom',
    'memory',
    'redis',
    'postgres',
]);

export const PROVIDER_PACKAGE_CONTRACTS: Readonly<Record<string, ProviderPackageContract>> = {
    'basic-auth': {
        packageName: 'or3-provider-basic-auth',
        roles: ['auth'],
    },
    clerk: {
        packageName: 'or3-provider-clerk',
        roles: ['auth'],
    },
    convex: {
        packageName: 'or3-provider-convex',
        roles: ['sync', 'storage'],
    },
    sqlite: {
        packageName: 'or3-provider-sqlite',
        roles: ['sync'],
    },
    fs: {
        packageName: 'or3-provider-fs',
        roles: ['storage'],
    },
    s3: {
        packageName: 'or3-provider-s3',
        roles: ['storage'],
    },
};

export const SUPPORTED_PROVIDER_STACKS: readonly SupportedProviderStack[] = [
    { id: 'local-only', auth: null, sync: null, storage: null },
    { id: 'legacy-cloud', auth: 'clerk', sync: 'convex', storage: 'convex' },
    { id: 'default-ssr', auth: 'basic-auth', sync: 'sqlite', storage: 'fs' },
    { id: 'clerk-sqlite-fs', auth: 'clerk', sync: 'sqlite', storage: 'fs' },
    { id: 'basic-convex', auth: 'basic-auth', sync: 'convex', storage: 'convex' },
    { id: 'basic-convex-s3', auth: 'basic-auth', sync: 'convex', storage: 's3' },
];

export function providerIdToModuleId(providerId: string): string | null {
    const id = providerId.trim();
    if (!id || LOCAL_PROVIDER_IDS.has(id)) return null;
    const packageName =
        PROVIDER_PACKAGE_CONTRACTS[id]?.packageName ?? `or3-provider-${id}`;
    return `${packageName}/nuxt`;
}

export function providerModuleIdsForStack(
    stack: SupportedProviderStack,
): string[] {
    return Array.from(new Set(
        ([stack.auth, stack.sync, stack.storage] as const)
            .filter((id): id is string => typeof id === 'string')
            .map(providerIdToModuleId)
            .filter((id): id is string => typeof id === 'string'),
    ));
}
