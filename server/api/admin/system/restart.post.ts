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
    if (process.env.NODE_ENV !== 'production') {
        throw createError({
            statusCode: 409,
            statusMessage: 'Restart not supported in development mode',
        });
    }

    await requestRestart();
    return { ok: true };
});
