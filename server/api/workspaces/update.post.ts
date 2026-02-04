import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '~/server/auth/session';
import { requireCan, requireSession } from '~/server/auth/can';
import { isSsrAuthEnabled } from '~/server/utils/auth/is-ssr-auth-enabled';
import { getWorkspaceStoreOrThrow } from '~/server/utils/workspaces/store';

const UpdateSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
});

export default defineEventHandler(async (event) => {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' });
    }

    const session = await resolveSessionContext(event);
    requireSession(session);
    requireCan(session, 'workspace.settings.manage', {
        kind: 'workspace',
        id: session.workspace?.id,
    });

    const body = UpdateSchema.parse(await readBody(event));
    const store = getWorkspaceStoreOrThrow(event);
    await store.updateWorkspace({
        userId: session.user.id,
        id: body.id,
        name: body.name,
        description: body.description ?? null,
    });

    return { ok: true };
});
