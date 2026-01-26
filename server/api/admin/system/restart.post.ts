import { defineEventHandler, createError } from 'h3';
import { requireAdminApi } from '../../../admin/api';
import { requestRestart } from '../../../admin/system/server-control';

export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const config = useRuntimeConfig();
    const adminConfig = config.admin as { allowRestart?: boolean } | undefined;
    if (!adminConfig?.allowRestart) {
        throw createError({ statusCode: 501, statusMessage: 'Restart disabled' });
    }

    await requestRestart();
    return { ok: true };
});
