/**
 * @module server/api/admin/system/rebuild-restart.post
 *
 * Purpose:
 * Triggers a system rebuild followed by a restart.
 */
import { defineEventHandler, createError } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { rebuildAndRestart } from '../../../admin/system/server-control';

/**
 * POST /api/admin/system/rebuild-restart
 *
 * Purpose:
 * Apply updates or configuration changes that require recompilation (e.g. repomix config).
 *
 * Behavior:
 * - Checks `admin.allowRebuild` feature flag.
 * - Blocks execution in non-production environments (usually).
 * - Spawns shell command defined in config.
 *
 * Errors:
 * - 501: Feature disabled.
 * - 409: Dev mode only.
 */
export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const config = useRuntimeConfig();
    const adminConfig = config.admin as {
        allowRebuild?: boolean;
        rebuildCommand?: string;
    } | undefined;
    if (!adminConfig?.allowRebuild) {
        throw createError({ statusCode: 501, statusMessage: 'Rebuild disabled' });
    }
    if (process.env.NODE_ENV !== 'production') {
        throw createError({
            statusCode: 409,
            statusMessage: 'Rebuild not supported in development mode',
        });
    }

    const command = adminConfig.rebuildCommand || 'bun run build';
    try {
        await rebuildAndRestart(command);
    } catch (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error instanceof Error ? error.message : 'Rebuild failed',
        });
    }

    return { ok: true };
});
