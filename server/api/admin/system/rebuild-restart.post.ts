import { defineEventHandler, createError } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { rebuildAndRestart } from '../../../admin/system/server-control';

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
