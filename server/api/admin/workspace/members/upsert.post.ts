/**
 * @module server/api/admin/workspace/members/upsert.post
 *
 * Purpose:
 * Adds a new member or updates an existing member's role.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getWorkspaceAccessStore } from '../../../../admin/stores/registry';
import { invalidateSharedSessionCacheForIdentity } from '../../../../auth/session';
import { useRuntimeConfig } from '#imports';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';

const BodySchema = z.object({
    emailOrProviderId: z.string().min(1),
    role: z.enum(['owner', 'editor', 'viewer']),
    provider: z.string().optional(),
    workspaceId: z.string().min(1).optional(),
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
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        mutation: true,
        allowWorkspaceAdmin: true,
    });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        body.data.workspaceId
    );

    const store = getWorkspaceAccessStore(event);
    await store.upsertMember({
        workspaceId,
        emailOrProviderId: body.data.emailOrProviderId,
        role: body.data.role,
        provider: body.data.provider,
    });

    invalidateSharedSessionCacheForIdentity({
        storeId:
            (useRuntimeConfig(event).sync as { provider?: string } | undefined)?.provider ||
            (useRuntimeConfig(event).public as { sync?: { provider?: string } }).sync?.provider ||
            'convex',
    });

    return { ok: true };
});
