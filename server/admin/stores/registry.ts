import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { WorkspaceAccessStore, WorkspaceSettingsStore } from './types';
import {
    createConvexWorkspaceAccessStore,
    createConvexWorkspaceSettingsStore,
} from './convex/convex-store';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export function getWorkspaceAccessStore(event: H3Event): WorkspaceAccessStore {
    const config = useRuntimeConfig();
    const provider = config.sync.provider as string | undefined;

    if (provider === CONVEX_PROVIDER_ID) {
        return createConvexWorkspaceAccessStore(event);
    }

    throw createError({
        statusCode: 501,
        statusMessage: `Workspace access store not implemented for provider: ${provider}`,
    });
}

export function getWorkspaceSettingsStore(event: H3Event): WorkspaceSettingsStore {
    const config = useRuntimeConfig();
    const provider = config.sync.provider as string | undefined;

    if (provider === CONVEX_PROVIDER_ID) {
        return createConvexWorkspaceSettingsStore(event);
    }

    throw createError({
        statusCode: 501,
        statusMessage: `Workspace settings store not implemented for provider: ${provider}`,
    });
}
