/**
 * @module server/api/workspaces/_helpers
 *
 * Purpose:
 * Shared helpers for workspace SSR endpoints.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { getAuthWorkspaceStore } from '../../auth/store/registry';
import type { AuthWorkspaceStore } from '../../auth/store/types';
import { useRuntimeConfig } from '#imports';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';

export async function requireWorkspaceSession(
    event: H3Event
): Promise<SessionContext & { authenticated: true }> {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: session.workspace?.id,
    });

    if (!session.authenticated) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    return session as SessionContext & { authenticated: true };
}

export function resolveWorkspaceStore(event: H3Event): AuthWorkspaceStore {
    const config = useRuntimeConfig(event);
    const storeId =
        config.public.sync?.provider ||
        config.sync?.provider ||
        'convex';
    const store = getAuthWorkspaceStore(storeId);
    if (!store) {
        throw createError({
            statusCode: 500,
            statusMessage:
                `AuthWorkspaceStore not registered for provider "${storeId}". ` +
                `Install the provider package that registers this store (e.g. or3-provider-${storeId}).`,
        });
    }
    return store;
}
