/**
 * @module server/api/admin/workspace/members/upsert.post
 *
 * Purpose:
 * Adds a new member or updates an existing member's role.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';

const BodySchema = z.object({
    emailOrProviderId: z.string().min(1),
    role: z.enum(['owner', 'editor', 'viewer']),
    provider: z.string().optional(),
});

/**
 * POST /api/admin/workspace/members/upsert
 *
 * Purpose:
 * Add (invite) or update a user within the workspace.
 *
 * Behavior:
 * - Uses email or provider ID to resolve/create user record.
 * - Sets the specified role.
 * - Idempotent for existing members.
 */
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
    await store.upsertMember({
        workspaceId,
        emailOrProviderId: body.data.emailOrProviderId,
        role: body.data.role,
        provider: body.data.provider,
    });

    return { ok: true };
});
