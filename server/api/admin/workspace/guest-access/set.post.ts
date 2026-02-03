/**
 * @module server/api/admin/workspace/guest-access/set.post
 *
 * Purpose:
 * Configures the "Guest Access" feature flag for a workspace.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../../admin/stores/registry';

const BodySchema = z.object({
    enabled: z.boolean(),
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
    const session = await requireAdminApi(event, { ownerOnly: true, mutation: true });

    const body = BodySchema.safeParse(await readBody(event));
    if (!body.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace not resolved' });
    }

    const store = getWorkspaceSettingsStore(event);
    await store.set(workspaceId, 'admin.guest_access.enabled', body.data.enabled ? 'true' : 'false');

    return { ok: true };
});
