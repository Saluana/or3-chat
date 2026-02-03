/**
 * @module server/api/storage/gc/run.post
 *
 * Purpose:
 * Manually triggers Garbage Collection for orphaned storage blobs in a workspace.
 *
 * Responsibilities:
 * - Identifies files not referenced by any attachment/record.
 * - Enforces retention policies (default 30 days).
 * - Rate limits execution to prevent abuse (1 min cooldown per workspace).
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../../auth/session';
import { requireCan } from '../../../auth/can';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../../utils/storage/is-storage-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../../utils/sync/convex-gateway';
import { CONVEX_JWT_TEMPLATE } from '~~/shared/cloud/provider-ids';

const BodySchema = z.object({
    workspace_id: z.string(),
    retention_seconds: z.number().optional(),
    limit: z.number().optional(),
});

// Simple in-memory rate limiting (resets on server restart)
const GC_COOLDOWN_MS = 60_000; // 1 minute cooldown
const MAX_TRACKED_WORKSPACES = 1000;
const lastGcRunByWorkspace = new Map<string, number>();

function recordGcRun(workspaceId: string, now: number): void {
    if (lastGcRunByWorkspace.size >= MAX_TRACKED_WORKSPACES) {
        for (const [id, timestamp] of lastGcRunByWorkspace) {
            if (now - timestamp > GC_COOLDOWN_MS) {
                lastGcRunByWorkspace.delete(id);
            }
        }
    }
    lastGcRunByWorkspace.set(workspaceId, now);
}

/**
 * POST /api/storage/gc/run
 *
 * Purpose:
 * Clean up storage.
 *
 * Behavior:
 * - Requires `admin.access` on the workspace.
 * - Delegates to `api.storage.gcDeletedFiles`.
 * - Returns count of deleted objects.
 *
 * Constraints:
 * - Cooldown: 60s/workspace.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isStorageEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const session = await resolveSessionContext(event);
    requireCan(session, 'admin.access', {
        kind: 'workspace',
        id: body.data.workspace_id,
    });

    // Rate limit check
    const now = Date.now();
    const lastRun = lastGcRunByWorkspace.get(body.data.workspace_id) ?? 0;
    if (now - lastRun < GC_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((GC_COOLDOWN_MS - (now - lastRun)) / 1000);
        throw createError({
            statusCode: 429,
            statusMessage: `GC rate limited, wait ${waitSeconds} seconds`,
        });
    }
    recordGcRun(body.data.workspace_id, now);

    const token = await getClerkProviderToken(event, CONVEX_JWT_TEMPLATE);
    if (!token) {
        throw createError({ statusCode: 401, statusMessage: 'Missing provider token' });
    }

    const client = getConvexGatewayClient(event, token);
    const retentionSeconds = body.data.retention_seconds ?? 30 * 24 * 3600;
    const result = await client.mutation(api.storage.gcDeletedFiles, {
        workspace_id: body.data.workspace_id as Id<'workspaces'>,
        retention_seconds: retentionSeconds,
        limit: body.data.limit,
    });

    return { deleted_count: result.deletedCount };
});
