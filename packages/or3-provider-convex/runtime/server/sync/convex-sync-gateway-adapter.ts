import { createError } from 'h3';
import type { SyncGatewayAdapter } from '~~/server/sync/gateway/types';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import { getProviderToken, getConvexGatewayClient } from '../utils/convex-gateway';
import { CONVEX_JWT_TEMPLATE, CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export const convexSyncGatewayAdapter: SyncGatewayAdapter = {
    id: CONVEX_PROVIDER_ID,
    async pull(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        return await client.query(api.sync.pull, {
            workspace_id: input.scope.workspaceId as Id<'workspaces'>,
            cursor: input.cursor,
            limit: input.limit,
            tables: input.tables,
        });
    },
    async push(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        return await client.mutation(api.sync.push, {
            workspace_id: input.scope.workspaceId as Id<'workspaces'>,
            ops: input.ops.map((op) => ({
                op_id: op.stamp.opId,
                table_name: op.tableName,
                operation: op.operation,
                pk: op.pk,
                payload: op.payload,
                clock: op.stamp.clock,
                hlc: op.stamp.hlc,
                device_id: op.stamp.deviceId,
            })),
        });
    },
    async updateCursor(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        await client.mutation(api.sync.updateDeviceCursor, {
            workspace_id: input.scope.workspaceId as Id<'workspaces'>,
            device_id: input.deviceId,
            last_seen_version: input.version,
        });
    },
    async gcTombstones(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        await client.mutation(api.sync.gcTombstones, {
            workspace_id: input.scope.workspaceId as Id<'workspaces'>,
            retention_seconds: input.retentionSeconds,
        });
    },
    async gcChangeLog(event, input) {
        const token = await getProviderToken(event, CONVEX_JWT_TEMPLATE);
        if (!token) {
            throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
        }
        const client = getConvexGatewayClient(event, token);
        await client.mutation(api.sync.gcChangeLog, {
            workspace_id: input.scope.workspaceId as Id<'workspaces'>,
            retention_seconds: input.retentionSeconds,
        });
    },
};
