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

export const PROVIDER_PACKAGE_CONTRACTS: Readonly<
    Record<string, ProviderPackageContract>
> = {
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
    {
        id: 'basic-convex',
        auth: 'basic-auth',
        sync: 'convex',
        storage: 'convex',
    },
    {
        id: 'basic-convex-s3',
        auth: 'basic-auth',
        sync: 'convex',
        storage: 's3',
    },
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
    return Array.from(
        new Set(
            ([stack.auth, stack.sync, stack.storage] as const)
                .filter((id): id is string => typeof id === 'string')
                .map(providerIdToModuleId)
                .filter((id): id is string => typeof id === 'string'),
        ),
    );
}

/** Package-backed requirements; custom registrations are verified at server startup. */
export function requiredProviderModules(
    config: import('../../types/or3-cloud-config').Or3CloudConfig,
    env: Readonly<Record<string, string | undefined>>,
): { moduleId: string; setting: string }[] {
    if (!config.auth.enabled || env.OR3_WIZARD_UI_ENABLED === 'true') return [];
    const selections: [string, string | undefined][] = [
        ['auth.provider', config.auth.provider],
        // Auth session provisioning uses this store even with sync transfer disabled.
        ['auth workspace store (sync.provider)', config.sync.provider],
        [
            'storage.provider',
            config.storage.enabled ? config.storage.provider : undefined,
        ],
        [
            'connect.provider',
            env.OR3_CONNECT_ENABLED === 'true'
                ? env.OR3_CONNECT_PROVIDER?.trim() || config.sync.provider
                : undefined,
        ],
        [
            'limits.storageProvider',
            config.limits?.enabled ? config.limits.storageProvider : undefined,
        ],
        [
            'backgroundStreaming.storageProvider',
            config.backgroundStreaming?.enabled
                ? config.backgroundStreaming.storageProvider
                : undefined,
        ],
    ];
    const modules = new Map<string, string>();
    for (const [setting, provider] of selections) {
        if (!provider) continue;
        const moduleId = providerIdToModuleId(provider);
        if (moduleId && !modules.has(moduleId)) modules.set(moduleId, setting);
    }
    return [...modules].map(([moduleId, setting]) => ({ moduleId, setting }));
}
