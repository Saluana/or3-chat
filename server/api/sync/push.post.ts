import { prepareSyncWrite, SyncWriteError } from '~~/shared/sync/prepare-sync-write';
import { observeSyncRequest } from '../../sync/observations';
import { WORKSPACE_ITEM_CAPABILITY } from "~~/shared/posts/workspace-item-capability";
import { hasWorkspaceItemSemantics } from '~~/shared/posts/workspace-item-capability';
import { requireWorkspaceItemCapability } from '../../utils/sync/workspace-item-capability';
/**
 * @module server/api/sync/push.post
 *
 * Purpose:
 * Receives a batch of local mutations (ops) and pushes them to the server.
 *
 * Responsibilities:
 * - Bounds the request body before parsing.
 * - Authorizes write access (`workspace.write`).
 * - Records rate limits on admission.
 * - Validates each operation independently and returns mixed HTTP 200 results.
 * - Dispatches valid ops to the registered SyncGatewayAdapter.
 */
import { requireCloudMutation } from '../../utils/security/cloud-mutation';
import { defineEventHandler, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import {
    PendingOpSchema,
    PushResultSchema,
    SyncScopeSchema,
    MAX_SYNC_PUSH_BATCH_BYTES,
    MAX_SYNC_PUSH_BATCH_OPS,
    getPushResultContractError,
} from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';
import {
    checkSyncRateLimit,
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';
import { enforceRateLimit } from '../../utils/rate-limit/enforce';
import { setNoCacheHeaders } from '../../utils/headers';
import { readLimitedJsonBody } from '../../utils/security/limited-json-body';
import {
    isGenericFileMetaPayload,
    requireFileKindCapability,
} from '../../utils/storage/file-kind-capability';
import { FILE_KIND_CAPABILITY } from '~~/shared/files/file-capability';

type PendingOp = z.infer<typeof PendingOpSchema>;
type PushResultItem = z.infer<typeof PushResultSchema>['results'][number];

const PushEnvelopeSchema = z.object({
    scope: SyncScopeSchema,
    ops: z.array(z.unknown()).max(MAX_SYNC_PUSH_BATCH_OPS),
    fileKindCapability: z.literal(FILE_KIND_CAPABILITY).optional(),
    workspaceItemCapability: z.literal(WORKSPACE_ITEM_CAPABILITY).optional(),
});

function opIdFromUnknown(op: unknown, index: number): string {
    if (
        op &&
        typeof op === 'object' &&
        'stamp' in op &&
        op.stamp &&
        typeof op.stamp === 'object' &&
        'opId' in op.stamp &&
        typeof op.stamp.opId === 'string' &&
        op.stamp.opId.length > 0
    ) {
        return op.stamp.opId;
    }
    return `invalid-op-${index}`;
}

function validationFailure(opId: string, error: string): PushResultItem {
    return {
        opId,
        success: false,
        error,
        errorCode: 'VALIDATION_ERROR',
    };
}

function validateOneOp(
    raw: unknown,
    index: number
): { op?: PendingOp; result?: PushResultItem } {
    const parsed = PendingOpSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            result: validationFailure(
                opIdFromUnknown(raw, index),
                parsed.error.message
            ),
        };
    }

    try {
        return { op: { ...parsed.data, ...prepareSyncWrite(parsed.data) } };
    } catch (error) {
        if (!(error instanceof SyncWriteError)) throw error;
        return { result: { opId: parsed.data.stamp.opId, success: false, error: error.message, errorCode: error.code } };
    }
}

/**
 * POST /api/sync/push
 *
 * Behavior:
 * 1. Bounds JSON body.
 * 2. Authenticates and authorizes workspace.write.
 * 3. Records the request against the push rate limit.
 * 4. Validates each op; invalid ops become mixed 200 results.
 * 5. Forwards valid ops to the adapter.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    setNoCacheHeaders(event);

    requireCloudMutation(event);

    const body: unknown = await readLimitedJsonBody(
        event,
        MAX_SYNC_PUSH_BATCH_BYTES,
        { allowGzip: true }
    );
    const envelope = PushEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid push request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.write', {
        kind: 'workspace',
        id: envelope.data.scope.workspaceId,
    });

    const userId = session.user.id;
    return await observeSyncRequest(event, userId, envelope.data.scope.workspaceId, 'push', async () => {
        const rateLimitResult = checkSyncRateLimit(userId, 'sync:push');
        enforceRateLimit(event, rateLimitResult);

        const stats = getSyncRateLimitStats(userId, 'sync:push');
        if (stats) {
            setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
            setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
        }

        recordSyncRequest(userId, 'sync:push');

        const merged = new Array<PushResultItem>(envelope.data.ops.length);
        const validOps: PendingOp[] = [];
        const validIndexes: number[] = [];

        for (const [index, raw] of envelope.data.ops.entries()) {
            const { op, result } = validateOneOp(raw, index);
            if (result) {
                merged[index] = result;
                continue;
            }
            validOps.push(op!);
            validIndexes.push(index);
        }

        if (validOps.length === 0) {
            return {
                results: merged,
                serverVersion: 0,
            };
        }

        if (validOps.some((op) =>
            op.operation === 'put' &&
            isGenericFileMetaPayload(op.tableName, op.payload)
        )) {
            requireFileKindCapability(envelope.data.fileKindCapability);
        }

        if (validOps.some(op => hasWorkspaceItemSemantics(op.tableName, op.payload))) {
            requireWorkspaceItemCapability(envelope.data.workspaceItemCapability);
        }
        const adapter = getActiveSyncGatewayAdapter();
        if (!adapter) {
            throw createError({ statusCode: 500, statusMessage: 'Sync adapter not configured' });
        }
        if (validOps.some(op => hasWorkspaceItemSemantics(op.tableName, op.payload)) && adapter.capabilities?.workspaceItems !== 'v1') {
            throw createError({ statusCode: 503, statusMessage: 'The selected sync provider needs workspace Files support' });
        }

        const normalizedBatch = {
            scope: envelope.data.scope,
            ops: validOps,
            ...(envelope.data.workspaceItemCapability ? { workspaceItemCapability: envelope.data.workspaceItemCapability } : {}),
        };

        const adapterResult = PushResultSchema.safeParse(
            await adapter.push(event, normalizedBatch)
        );
        if (
            !adapterResult.success ||
            getPushResultContractError(normalizedBatch, adapterResult.data)
        ) {
            throw createError({
                statusCode: 502,
                statusMessage: 'Invalid push response',
            });
        }

        const adapterByOpId = new Map(
            adapterResult.data.results.map((item) => [item.opId, item])
        );
        for (let i = 0; i < validIndexes.length; i++) {
            const index = validIndexes[i]!;
            const op = validOps[i]!;
            const item = adapterByOpId.get(op.stamp.opId);
            if (item) merged[index] = item;
        }

        return {
            results: merged,
            serverVersion: adapterResult.data.serverVersion,
        };
    });
});
