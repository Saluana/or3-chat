import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import {
    uninstallExtension,
    invalidateExtensionsCache,
} from '../../../admin/extensions/extension-manager';

const BodySchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['plugin', 'theme', 'admin_plugin']),
});

export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    try {
        await uninstallExtension(body.data.kind, body.data.id);
        invalidateExtensionsCache();
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: error instanceof Error ? error.message : 'Uninstall failed',
        });
    }

    return { ok: true };
});
