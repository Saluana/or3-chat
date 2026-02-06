/**
 * @module server/admin/providers/adapters/storage-convex.ts
 *
 * Purpose:
 * Admin adapter for Convex storage. Provides maintenance tools for managing
 * blob data in the Convex backend.
 *
 * Key Operations:
 * - **Storage Garbage Collection**: Purges file blobs that were logically deleted
 *   from the database but still occupy space in the storage provider.
 *
 * Constraints:
 * - Requires a valid Clerk gateway token to perform administrative mutations.
 * - Operates within a workspace scope.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getConvexGatewayClient } from '../../utils/convex-gateway';
import {
    CLERK_PROVIDER_ID,
    CONVEX_JWT_TEMPLATE,
    CONVEX_STORAGE_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';
import { resolveProviderToken } from '~~/server/auth/token-broker/resolve';
import { listProviderTokenBrokerIds } from '~~/server/auth/token-broker/registry';
import type {
    ProviderAdminAdapter,
    ProviderAdminStatusResult,
    ProviderStatusContext,
    ProviderActionContext,
} from '~~/server/admin/providers/types';
import { useRuntimeConfig } from '#imports';

/** Default retention window for deleted files (30 days). */
const DEFAULT_RETENTION_SECONDS = 30 * 24 * 3600;

/**
 * Purpose:
 * Normalizes user-provided GC limits into seconds.
 */
function resolveRetentionSeconds(payload?: Record<string, unknown>): number {
    const days = typeof payload?.retentionDays === 'number' ? payload.retentionDays : null;
    const seconds =
        typeof payload?.retentionSeconds === 'number' ? payload.retentionSeconds : null;
    if (seconds && Number.isFinite(seconds) && seconds > 0) return seconds;
    if (days && Number.isFinite(days) && days > 0) return Math.floor(days * 24 * 3600);
    return DEFAULT_RETENTION_SECONDS;
}

/**
 * Singleton implementation of the Convex Storage admin adapter.
 */
export const convexStorageAdminAdapter: ProviderAdminAdapter = {
    id: CONVEX_STORAGE_PROVIDER_ID,
    kind: 'storage',

    /**
     * Purpose:
     * Validates storage provider alignment and configuration.
     * Warns if Clerk is not used, as many actions require Clerk JWTs.
     */
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        const warnings: ProviderAdminStatusResult['warnings'] = [];
        if (ctx.enabled && ctx.provider !== CONVEX_STORAGE_PROVIDER_ID) {
            warnings.push({
                level: 'warning',
                message: 'Storage provider mismatch. The selected provider does not match this adapter.',
            });
        }
        const config = useRuntimeConfig();
        if (ctx.enabled) {
            const brokerIds = listProviderTokenBrokerIds();
            if (!brokerIds.includes(config.auth.provider)) {
                warnings.push({
                    level: 'warning',
                    message:
                        `No ProviderTokenBroker registered for auth provider "${config.auth.provider}". ` +
                        `Install the provider package that registers this broker (e.g. or3-provider-${config.auth.provider}).`,
                });
            } else if (config.auth.provider !== CLERK_PROVIDER_ID) {
                warnings.push({
                    level: 'warning',
                    message:
                        `Convex storage admin actions will use the "${config.auth.provider}" token broker for authentication.`,
                });
            }
        }
        return {
            warnings,
            actions: [
                {
                    id: 'storage.gc',
                    label: 'Run Storage GC',
                    description: 'Delete orphaned blobs from the primary storage backend after the retention window.',
                    danger: true,
                },
            ],
        };
    },

    /**
     * Purpose:
     * Executes the requested storage maintenance action.
     *
     * Behavior:
     * - `storage.gc`: Triggers a Convex mutation to purge deleted files.
     *
     * @throws 401 Unauthorized if a valid Clerk token cannot be resolved.
     */
    async runAction(
        event: H3Event,
        actionId: string,
        payload: Record<string, unknown> | undefined,
        ctx: ProviderActionContext
    ): Promise<unknown> {
        if (!ctx.session.workspace?.id) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Workspace not resolved',
            });
        }

        const token = await resolveProviderToken(event, {
            providerId: CONVEX_STORAGE_PROVIDER_ID,
            template: CONVEX_JWT_TEMPLATE,
        });
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }

        if (actionId !== 'storage.gc') {
            throw createError({ statusCode: 400, statusMessage: 'Unknown action' });
        }

        const client = getConvexGatewayClient(event, token);
        const workspaceId = ctx.session.workspace.id as Id<'workspaces'>;
        const retentionSeconds = resolveRetentionSeconds(payload);
        const limit =
            typeof payload?.limit === 'number' && payload.limit > 0 ? payload.limit : undefined;

        const result = await client.mutation(api.storage.gcDeletedFiles, {
            workspace_id: workspaceId,
            retention_seconds: retentionSeconds,
            limit,
        });

        return { deleted_count: result.deletedCount };
    },
};
