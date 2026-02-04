import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { resolveSessionContext } from '~/server/auth/session';
import { requireCan, requireSession } from '~/server/auth/can';
import { isSsrAuthEnabled } from '~/server/utils/auth/is-ssr-auth-enabled';
import { getWorkspaceStoreOrThrow } from '~/server/utils/workspaces/store';

const CreateSchema = z.object({
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

    const body = CreateSchema.parse(await readBody(event));
    const store = getWorkspaceStoreOrThrow(event);
    const { id } = await store.createWorkspace({
        userId: session.user.id,
        name: body.name,
        description: body.description ?? null,
    });

    return { id };
});
