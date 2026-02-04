import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '~/server/auth/session';
import { requireCan, requireSession } from '~/server/auth/can';
import { isSsrAuthEnabled } from '~/server/utils/auth/is-ssr-auth-enabled';
import { getWorkspaceStoreOrThrow } from '~/server/utils/workspaces/store';

const RemoveSchema = z.object({
    id: z.string().min(1),
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

    const body = RemoveSchema.parse(await readBody(event));
    const store = getWorkspaceStoreOrThrow(event);
    await store.removeWorkspace({ userId: session.user.id, id: body.id });

    return { ok: true };
});
