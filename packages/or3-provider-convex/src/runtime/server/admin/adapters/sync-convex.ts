/**
 * @module server/admin/providers/adapters/sync-convex.ts
 *
 * Purpose:
 * Admin adapter for the Convex sync provider. Provides maintenance tools for
 * the sync change log and tombstone tracking.
 *
 * Key Operations:
 * - **Change Log GC**: Purges historical sync entries that have been fully
 *   propagated to all devices beyond the retention window.
 * - **Tombstone GC**: Permanently deletes metadata records of deleted entities.
 *
 * Constraints:
 * - Requires a valid Clerk gateway token for authentication.
 * - Actions are workspace-scoped.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getConvexGatewayClient } from '../../utils/convex-gateway';
import {
    CLERK_PROVIDER_ID,
    CONVEX_JWT_TEMPLATE,
    CONVEX_PROVIDER_ID,
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

/** Default retention window for sync metadata (30 days). */
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
 * Singleton implementation of the Convex Sync admin adapter.
 */
export const convexSyncAdminAdapter: ProviderAdminAdapter = {
    id: CONVEX_PROVIDER_ID,
    kind: 'sync',

    /**
     * Purpose:
     * Checks sync configuration and reports warnings.
     */
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        const config = useRuntimeConfig();
        const warnings: ProviderAdminStatusResult['warnings'] = [];

        if (ctx.enabled && !config.sync.convexUrl) {
            warnings.push({
                level: 'error',
                message: 'Convex sync is enabled but no Convex URL is configured in the environment.',
            });
        }
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
                        `Convex admin actions will use the "${config.auth.provider}" token broker for authentication.`,
                });
            }
        }

        return {
            details: {
                convexUrl: config.sync.convexUrl,
            },
            warnings,
            actions: [
                {
                    id: 'sync.gc-change-log',
                    label: 'Run Sync Change Log GC',
                    description: 'Purge old change_log entries from the database after the retention window.',
                    danger: true,
                },
                {
                    id: 'sync.gc-tombstones',
                    label: 'Run Sync Tombstone GC',
                    description: 'Purge metadata tombstones after the retention window.',
                    danger: true,
                },
            ],
        };
    },

    /**
     * Purpose:
     * Executes sync maintenance tasks.
     *
     * Behavior:
     * - `sync.gc-change-log`: Calls the purge mutation for historical change logs.
     * - `sync.gc-tombstones`: Calls the purge mutation for entity tombstones.
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
            providerId: CONVEX_PROVIDER_ID,
            template: CONVEX_JWT_TEMPLATE,
        });
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }

        const client = getConvexGatewayClient(event, token);
        const workspaceId = ctx.session.workspace.id as Id<'workspaces'>;
        const retentionSeconds = resolveRetentionSeconds(payload);

        if (actionId === 'sync.gc-change-log') {
            return await client.mutation(api.sync.gcChangeLog, {
                workspace_id: workspaceId,
                retention_seconds: retentionSeconds,
            });
        }

        if (actionId === 'sync.gc-tombstones') {
            return await client.mutation(api.sync.gcTombstones, {
                workspace_id: workspaceId,
                retention_seconds: retentionSeconds,
            });
        }

        throw createError({ statusCode: 400, statusMessage: 'Unknown action' });
    },
};
