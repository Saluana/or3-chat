import { createError } from 'h3';
import { getAuthWorkspaceStore } from '~/server/auth/store/registry';

export function getWorkspaceStoreOrThrow(event?: Parameters<typeof useRuntimeConfig>[0]) {
    const config = useRuntimeConfig(event);
    const storeId = config.sync.provider;
    if (!storeId) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Workspace store not configured',
        });
    }
    if (!event) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Workspace store requires request context',
        });
    }
    const store = getAuthWorkspaceStore(storeId, event);
    if (!store) {
        throw createError({
            statusCode: 500,
            statusMessage: `Workspace store not registered for ${storeId}`,
        });
    }
    return store;
}
