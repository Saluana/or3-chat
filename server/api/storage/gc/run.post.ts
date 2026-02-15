/**
 * @module server/api/storage/gc/run.post
 *
 * Purpose:
 * Manually triggers Garbage Collection for orphaned storage blobs in a workspace.
 *
 * Responsibilities:
 * - Identifies files not referenced by any attachment/record.
 * - Enforces retention policies (default 30 days).
 * - Rate limits execution to prevent abuse (runtime-configurable cooldown per workspace).
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { useRuntimeConfig } from '#imports';
import { resolveSessionContext } from '../../../auth/session';
import { requireCan } from '../../../auth/can';
import { isSsrAuthEnabled } from '../../../utils/auth/is-ssr-auth-enabled';
import { isStorageEnabled } from '../../../utils/storage/is-storage-enabled';
import { getActiveStorageGatewayAdapter } from '../../../storage/gateway/registry';
import {
    DEFAULT_STORAGE_GC_COOLDOWN_MS,
    DEFAULT_STORAGE_GC_RETENTION_SECONDS,
} from '~~/shared/config/constants';

const BodySchema = z.object({
    workspace_id: z.string(),
    retention_seconds: z.number().optional(),
    limit: z.number().optional(),
});

// Simple in-memory rate limiting (resets on server restart)
const MAX_TRACKED_WORKSPACES = 1000;
const lastGcRunByWorkspace = new Map<string, number>();

function toNonNegativeInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}

function recordGcRun(workspaceId: string, now: number, cooldownMs: number): void {
    if (lastGcRunByWorkspace.size >= MAX_TRACKED_WORKSPACES) {
        for (const [id, timestamp] of lastGcRunByWorkspace) {
            if (now - timestamp > cooldownMs) {
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
 * - Dispatches to registered StorageGatewayAdapter.
 * - Returns count of deleted objects.
 *
 * Constraints:
 * - Cooldown: runtime-configurable per workspace (`storage.gcCooldownMs`).
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

    const runtimeConfig = useRuntimeConfig(event);
    const storageConfig = runtimeConfig.storage as
        | {
              gcRetentionSeconds?: unknown;
              gcCooldownMs?: unknown;
          }
        | undefined;
    const gcCooldownMs = toNonNegativeInt(
        storageConfig?.gcCooldownMs,
        DEFAULT_STORAGE_GC_COOLDOWN_MS
    );
    const defaultRetentionSeconds = toNonNegativeInt(
        storageConfig?.gcRetentionSeconds,
        DEFAULT_STORAGE_GC_RETENTION_SECONDS
    );

    // Rate limit check
    const now = Date.now();
    const lastRun = lastGcRunByWorkspace.get(body.data.workspace_id) ?? 0;
    if (now - lastRun < gcCooldownMs) {
        const waitSeconds = Math.ceil((gcCooldownMs - (now - lastRun)) / 1000);
        throw createError({
            statusCode: 429,
            statusMessage: `GC rate limited, wait ${waitSeconds} seconds`,
        });
    }
    recordGcRun(body.data.workspace_id, now, gcCooldownMs);

    // Get storage gateway adapter from registry
    const adapter = getActiveStorageGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Storage adapter not configured' });
    }

    // Check if adapter supports GC
    if (!adapter.gc) {
        throw createError({ statusCode: 501, statusMessage: 'GC not supported by adapter' });
    }

    const retentionSeconds = body.data.retention_seconds ?? defaultRetentionSeconds;
    const result = await adapter.gc(event, {
        workspace_id: body.data.workspace_id,
        retention_seconds: retentionSeconds,
        limit: body.data.limit,
    });

    return result;
});
