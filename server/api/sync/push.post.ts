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
import { defineEventHandler, createError, setResponseHeader } from 'h3';
import { z } from 'zod';
import {
    PendingOpSchema,
    PushResultSchema,
    SyncScopeSchema,
    TABLE_PAYLOAD_SCHEMAS,
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
import { MAX_SYNC_PAYLOAD_BYTES } from '~~/shared/sync/sanitize';

type PendingOp = z.infer<typeof PendingOpSchema>;
type PushResultItem = z.infer<typeof PushResultSchema>['results'][number];

const PushEnvelopeSchema = z.object({
    scope: SyncScopeSchema,
    ops: z.array(z.unknown()).max(MAX_SYNC_PUSH_BATCH_OPS),
});

function serializedPayloadBytes(payload: unknown): number {
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

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

    const op = { ...parsed.data };
    if (
        op.payload !== undefined &&
        serializedPayloadBytes(op.payload) > MAX_SYNC_PAYLOAD_BYTES
    ) {
        return {
            result: {
                opId: op.stamp.opId,
                success: false,
                error: `Payload too large for ${op.tableName}: exceeds ${MAX_SYNC_PAYLOAD_BYTES} bytes`,
                errorCode: 'OVERSIZED',
            },
        };
    }

    if (op.operation === 'put') {
        const schema = TABLE_PAYLOAD_SCHEMAS[op.tableName];
        if (schema) {
            const payload = schema.safeParse(op.payload ?? {});
            if (!payload.success) {
                return {
                    result: validationFailure(
                        op.stamp.opId,
                        `Invalid payload for ${op.tableName}: ${payload.error.message}`
                    ),
                };
            }
            op.payload = payload.data as Record<string, unknown>;
        }
    }

    return { op };
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

    const body: unknown = await readLimitedJsonBody(
        event,
        MAX_SYNC_PUSH_BATCH_BYTES
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

    const rateLimitResult = checkSyncRateLimit(session.user.id, 'sync:push');
    enforceRateLimit(event, rateLimitResult);

    const stats = getSyncRateLimitStats(session.user.id, 'sync:push');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    recordSyncRequest(session.user.id, 'sync:push');

    const merged: PushResultItem[] = new Array(envelope.data.ops.length);
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

    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Sync adapter not configured' });
    }

    const normalizedBatch = {
        scope: envelope.data.scope,
        ops: validOps,
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
