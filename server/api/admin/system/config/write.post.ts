import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../../admin/api';
import { writeConfigEntries } from '../../../../admin/config/config-manager';

const BodySchema = z.object({
    entries: z.array(
        z.object({
            key: z.string().min(1),
            value: z.string().nullable(),
        })
    ),
});

export default defineEventHandler(async (event) => {
    await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    try {
        await writeConfigEntries(body.data.entries);
    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: error instanceof Error ? error.message : 'Validation failed',
        });
    }

    return { ok: true, restartRequired: true };
});
