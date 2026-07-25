/**
 * @module server/api/admin/workspace/guest-access/set.post
 *
 * Purpose:
 * Configures the "Guest Access" feature flag for a workspace.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../../admin/stores/registry';
import { resolveAdminWorkspaceTarget } from '../../../../admin/workspace-target';

const BodySchema = z.object({
    enabled: z.boolean(),
    workspaceId: z.string().min(1).optional(),
});

/**
 * POST /api/admin/workspace/guest-access/set
 *
 * Purpose:
 * Enable or disable public/guest access to shared resources.
 *
 * Behavior:
 * - Updates `admin.guest_access.enabled` setting.
 *
 * Impact:
 * - If disabled, only authenticated members can access workspace resources.
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

    const store = getWorkspaceSettingsStore(event);
    await store.set(workspaceId, 'admin.guest_access.enabled', body.data.enabled ? 'true' : 'false');

    return { ok: true };
});
