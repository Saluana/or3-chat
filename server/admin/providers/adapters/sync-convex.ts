import type { H3Event } from 'h3';
import { createError } from 'h3';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../../utils/sync/convex-gateway';
import {
    CLERK_PROVIDER_ID,
    CONVEX_JWT_TEMPLATE,
    CONVEX_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';
import type {
    ProviderAdminAdapter,
    ProviderAdminStatusResult,
    ProviderStatusContext,
    ProviderActionContext,
} from '../types';

const DEFAULT_RETENTION_SECONDS = 30 * 24 * 3600;

function resolveRetentionSeconds(payload?: Record<string, unknown>): number {
    const days = typeof payload?.retentionDays === 'number' ? payload.retentionDays : null;
    const seconds =
        typeof payload?.retentionSeconds === 'number' ? payload.retentionSeconds : null;
    if (seconds && Number.isFinite(seconds) && seconds > 0) return seconds;
    if (days && Number.isFinite(days) && days > 0) return Math.floor(days * 24 * 3600);
    return DEFAULT_RETENTION_SECONDS;
}

export const convexSyncAdminAdapter: ProviderAdminAdapter = {
    id: CONVEX_PROVIDER_ID,
    kind: 'sync',
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        const config = useRuntimeConfig();
        const warnings: ProviderAdminStatusResult['warnings'] = [];

        if (ctx.enabled && !config.sync.convexUrl) {
            warnings.push({
                level: 'error',
                message: 'Convex sync is enabled but no Convex URL is configured.',
            });
        }
        if (ctx.enabled && config.auth.provider !== CLERK_PROVIDER_ID) {
            warnings.push({
                level: 'warning',
                message:
                    'Convex admin actions currently expect Clerk gateway tokens.',
            });
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
                    description: 'Purge old change_log entries after retention window.',
                    danger: true,
                },
                {
                    id: 'sync.gc-tombstones',
                    label: 'Run Sync Tombstone GC',
                    description: 'Purge tombstones after retention window.',
                    danger: true,
                },
            ],
        };
    },
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

        const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
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
