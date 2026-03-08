import { createError, defineEventHandler, readBody, setResponseHeader } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getAuthWorkspaceStore } from '../../../../auth/store/registry';
import { createInviteToken, hashInviteToken } from '../../../../auth/invite-token';
import { isAdminEnabled } from '../../../../utils/admin/is-admin-enabled';

const BodySchema = z.object({
    email: z.string().email().max(320),
    role: z.enum(['owner', 'editor', 'viewer']).default('viewer'),
    expiresInSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
});

function isMissingConvexFunctionError(error: unknown, functionName: string): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.includes(`Could not find public function for '${functionName}'`);
}

export default defineEventHandler(async (event) => {
    if (!isAdminEnabled(event)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
        });
    }

    const adminCtx = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });
    setResponseHeader(event, 'Cache-Control', 'no-store');

    const session = adminCtx.session;
    if (!session?.workspace || !session.user) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Workspace admin session required',
        });
    }

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = session.workspace.id;
    const invitedByUserId = session.user.id;

    const config = useRuntimeConfig();
    const authConfig = config.auth as { invite?: { tokenSecret?: string; tokenTtlSeconds?: number } };
    const secret = authConfig.invite?.tokenSecret;
    if (!secret) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Invite token secret not configured',
        });
    }

    const storeId = config.public.sync.provider;
    const store = getAuthWorkspaceStore(storeId);
    if (!store || typeof store.createInvite !== 'function') {
        throw createError({
            statusCode: 503,
            statusMessage: 'Selected auth store does not support invites',
        });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = body.data.expiresInSeconds ?? Math.max(60, Number(authConfig.invite?.tokenTtlSeconds ?? 7 * 24 * 60 * 60));
    const expiresAt = nowSeconds + ttlSeconds;

    const email = body.data.email.trim().toLowerCase();

    const token = createInviteToken(
        {
            workspaceId,
            email,
            exp: expiresAt,
        },
        secret
    );

    let created;
    try {
        created = await store.createInvite({
            workspaceId,
            email,
            role: body.data.role,
            invitedByUserId,
            expiresAt,
            tokenHash: hashInviteToken(token),
        });
    } catch (error) {
        if (isMissingConvexFunctionError(error, 'workspaces:createInvite')) {
            throw createError({
                statusCode: 503,
                statusMessage:
                    'Invites are unavailable because Convex invite functions are not deployed.',
            });
        }
        throw error;
    }

    return {
        ok: true,
        invite: {
            id: created.inviteId,
            email,
            role: body.data.role,
            expiresAt,
            token,
            inviteUrl: `/?invite=${encodeURIComponent(token)}`,
        },
    };
});
