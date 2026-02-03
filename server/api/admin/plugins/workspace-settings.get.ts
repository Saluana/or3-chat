/**
 * @module server/api/admin/plugins/workspace-settings.get
 *
 * Purpose:
 * Retrieves configuration values for a plugin in the current workspace.
 */
import { defineEventHandler, getQuery, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { getPluginSettings } from '../../../admin/plugins/workspace-plugin-store';

const QuerySchema = z.object({
    pluginId: z.string().min(1),
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
    const session = await requireAdminApi(event);

    const query = QuerySchema.safeParse(getQuery(event));
    if (!query.success) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
    }

    const workspaceId = session.workspace?.id;
    if (!workspaceId) {
        throw createError({ statusCode: 400, statusMessage: 'Workspace not resolved' });
    }

    const store = getWorkspaceSettingsStore(event);
    const settings = await getPluginSettings(
        store,
        workspaceId,
        query.data.pluginId
    );

    return { settings };
});
