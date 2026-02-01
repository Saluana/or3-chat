import { defineEventHandler } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { getProviderAdminAdapter } from '../../../admin/providers/registry';
import { createStubProviderAdapter } from '../../../admin/providers/adapters/stub';
import type { ProviderAdminStatus } from '../../../admin/providers/types';

export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);

    const config = useRuntimeConfig();

    const authProvider = config.auth.provider;
    const syncProvider = config.sync.provider;
    const storageProvider = config.storage.provider;

    const authAdapter =
        getProviderAdminAdapter('auth', authProvider) ??
        createStubProviderAdapter('auth', authProvider);
    const syncAdapter =
        getProviderAdminAdapter('sync', syncProvider) ??
        createStubProviderAdapter('sync', syncProvider);
    const storageAdapter =
        getProviderAdminAdapter('storage', storageProvider) ??
        createStubProviderAdapter('storage', storageProvider);

    const [authResult, syncResult, storageResult] = await Promise.all([
        authAdapter.getStatus(event, {
            enabled: Boolean(config.auth.enabled),
            provider: authProvider,
        }),
        syncAdapter.getStatus(event, {
            enabled: Boolean(config.sync.enabled),
            provider: syncProvider,
        }),
        storageAdapter.getStatus(event, {
            enabled: Boolean(config.storage.enabled),
            provider: storageProvider,
        }),
    ]);

    const auth: ProviderAdminStatus = {
        enabled: Boolean(config.auth.enabled),
        provider: authProvider,
        details: authResult.details,
        warnings: authResult.warnings,
        actions: authResult.actions,
    };
    const sync: ProviderAdminStatus = {
        enabled: Boolean(config.sync.enabled),
        provider: syncProvider,
        details: syncResult.details,
        warnings: syncResult.warnings,
        actions: syncResult.actions,
    };
    const storage: ProviderAdminStatus = {
        enabled: Boolean(config.storage.enabled),
        provider: storageProvider,
        details: storageResult.details,
        warnings: storageResult.warnings,
        actions: storageResult.actions,
    };

    const status = {
        auth,
        sync,
        storage,
        backgroundStreaming: {
            enabled: Boolean(config.backgroundJobs.enabled),
            storageProvider: config.backgroundJobs.storageProvider,
        },
        admin: {
            allowRestart: Boolean(config.admin.allowRestart),
            allowRebuild: Boolean(config.admin.allowRebuild),
        },
    };

    const warnings = [
        ...auth.warnings,
        ...sync.warnings,
        ...storage.warnings,
    ];

    return {
        status,
        warnings,
        session: {
            workspaceId: session.workspace?.id,
            role: session.role,
        },
    };
});
