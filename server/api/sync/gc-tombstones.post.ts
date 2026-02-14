/**
 * @module server/api/sync/gc-tombstones.post
 *
 * Purpose:
 * Cleans up deletion markers (tombstones) that have exceeded the retention period.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { SyncScopeSchema } from '~~/shared/sync/schemas';
import { resolveSessionContext } from '../../auth/session';
import { requireCan } from '../../auth/can';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { isSyncEnabled } from '../../utils/sync/is-sync-enabled';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';

const GcRequestSchema = z.object({
    scope: SyncScopeSchema,
    retentionSeconds: z.number().int().positive(),
});

/**
 * POST /api/sync/gc-tombstones
 *
 * Purpose:
 * Forget about deleted items after X time.
 *
 * Behavior:
 * - Requires `workspace.settings.manage` permission (elevated from workspace.write for security).
 * - Rate limited to prevent abuse.
 * - Dispatches to registered SyncGatewayAdapter.
 *
 * Impact:
 * - Clients that have been offline longer than `retentionSeconds` must do a full re-sync, as they will miss deletions.
 */
export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event) || !isSyncEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const body: unknown = await readBody(event);
    const parsed = GcRequestSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid GC request' });
    }

    const session = await resolveSessionContext(event);
    if (!session.authenticated || !session.user || !session.workspace) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.settings.manage', {
        kind: 'workspace',
        id: parsed.data.scope.workspaceId,
    });

    // Rate limiting for GC operations (even admins need limits)
    const { checkSyncRateLimit, recordSyncRequest } = await import('../../utils/sync/rate-limiter');
    const rateLimitResult = checkSyncRateLimit(session.user.id, 'sync:gc');
    if (!rateLimitResult.allowed) {
        throw createError({
            statusCode: 429,
            statusMessage: 'Too many GC requests. Please wait before retrying.',
        });
    }

    // Get sync gateway adapter from registry
    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter) {
        throw createError({ statusCode: 500, statusMessage: 'Sync adapter not configured' });
    }

    // Check if adapter supports GC tombstones
    if (!adapter.gcTombstones) {
        throw createError({ statusCode: 501, statusMessage: 'GC tombstones not supported by adapter' });
    }

    // Dispatch to adapter
    const result = await adapter.gcTombstones(event, parsed.data);

    // Record successful request for rate limiting
    recordSyncRequest(session.user.id, 'sync:gc');

    return result;
});
