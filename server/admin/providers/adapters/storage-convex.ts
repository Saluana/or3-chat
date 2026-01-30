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
    CONVEX_STORAGE_PROVIDER_ID,
} from '~~/shared/cloud/provider-ids';
import type {
    ProviderAdminAdapter,
    ProviderAdminStatusResult,
    ProviderStatusContext,
    ProviderActionContext,
} from '../types';
import { useRuntimeConfig } from '#imports';

const DEFAULT_RETENTION_SECONDS = 30 * 24 * 3600;

function resolveRetentionSeconds(payload?: Record<string, unknown>): number {
    const days = typeof payload?.retentionDays === 'number' ? payload.retentionDays : null;
    const seconds =
        typeof payload?.retentionSeconds === 'number' ? payload.retentionSeconds : null;
    if (seconds && Number.isFinite(seconds) && seconds > 0) return seconds;
    if (days && Number.isFinite(days) && days > 0) return Math.floor(days * 24 * 3600);
    return DEFAULT_RETENTION_SECONDS;
}

export const convexStorageAdminAdapter: ProviderAdminAdapter = {
    id: CONVEX_STORAGE_PROVIDER_ID,
    kind: 'storage',
    async getStatus(_event: H3Event, ctx: ProviderStatusContext): Promise<ProviderAdminStatusResult> {
        const warnings: ProviderAdminStatusResult['warnings'] = [];
        if (ctx.enabled && ctx.provider !== CONVEX_STORAGE_PROVIDER_ID) {
            warnings.push({
                level: 'warning',
                message: 'Storage provider mismatch.',
            });
        }
        const config = useRuntimeConfig();
        if (ctx.enabled && config.auth.provider !== CLERK_PROVIDER_ID) {
            warnings.push({
                level: 'warning',
                message:
                    'Convex storage admin actions currently expect Clerk gateway tokens.',
            });
        }
        return {
            warnings,
            actions: [
                {
                    id: 'storage.gc',
                    label: 'Run Storage GC',
                    description: 'Delete orphaned blobs after retention window.',
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
