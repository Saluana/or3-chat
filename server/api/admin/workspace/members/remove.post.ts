import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';

const BodySchema = z.object({
    userId: z.string().min(1),
});

export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace not resolved' });
    }

    const store = getWorkspaceAccessStore(event);
    await store.removeMember({
        workspaceId,
        userId: body.data.userId,
    });

    return { ok: true };
});
