/**
 * @module server/api/admin/plugins/workspace-settings.get
 *
 * Purpose:
 * Retrieves configuration values for a plugin in the current workspace.
 */
import { defineEventHandler, getQuery, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import {
    getPluginAccessPolicy,
    getPluginSettings,
} from '../../../admin/plugins/workspace-plugin-store';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';

const QuerySchema = z.object({
    pluginId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
});

/**
 * GET /api/admin/plugins/workspace-settings
 *
 * Purpose:
 * Fetch persisted settings for a plugin.
 *
 * Behavior:
 * - Scoped to the session workspace.
 * - Returns key-value pairs.
 */
export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, {
        ownerOnly: true,
        allowWorkspaceAdmin: true,
    });

    const query = QuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = resolveAdminWorkspaceTarget(
        context,
        query.data.workspaceId
    );

    const store = getWorkspaceSettingsStore(event);
    const settings = await getPluginSettings(
        store,
        workspaceId,
        query.data.pluginId
    );

    const effectiveAccessPolicy = await getPluginAccessPolicy(
        store,
        workspaceId,
        query.data.pluginId
    );

    return { settings, effectiveAccessPolicy };
});
