/**
 * POST /api/storage/gc/run
 * Trigger storage GC for orphaned blobs.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '../../../auth/session';
import { requireCan } from '../../../auth/can';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { api } from '~~/convex/_generated/api';
import type { Id } from '~~/convex/_generated/dataModel';
import {
    getClerkProviderToken,
    getConvexGatewayClient,
} from '../../../utils/sync/convex-gateway';

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

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
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

    const token = await getClerkProviderToken(event, 'convex');
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
