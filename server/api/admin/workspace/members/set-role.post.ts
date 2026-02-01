import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';

const BodySchema = z.object({
    userId: z.string().min(1),
    role: z.enum(['owner', 'editor', 'viewer']),
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
    await store.setMemberRole({
        workspaceId,
        userId: body.data.userId,
        role: body.data.role,
    });

    await event.context.adminHooks?.doAction('admin.user:action:role_changed', {
        workspaceId,
        userId: body.data.userId,
        role: body.data.role,
    });

    return { ok: true };
});
