/**
 * @module server/api/admin/plugins/workspace-enable.post
 *
 * Purpose:
 * Toggles a plugin's active state for a specific workspace.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { setPluginEnabled } from '../../../admin/plugins/workspace-plugin-store';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';

const BodySchema = z.object({
    pluginId: z.string().min(1),
    enabled: z.boolean(),
    workspaceId: z.string().min(1).optional(),
});

/**
 * POST /api/admin/plugins/workspace-enable
 *
 * Purpose:
 * Enable/Disable a plugin.
 *
 * Behavior:
 * - Updates the workspace-specific implementation of plugin state (e.g. `enabled_plugins` setting).
 * - Emits `admin.plugin:action:enabled` or `disabled`.
 * - Returns the updated list of enabled plugins.
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
    const enabledList = await setPluginEnabled(
        store,
        workspaceId,
        body.data.pluginId,
        body.data.enabled
    );

    await event.context.adminHooks?.doAction(
        body.data.enabled
            ? 'admin.plugin:action:enabled'
            : 'admin.plugin:action:disabled',
        {
            id: body.data.pluginId,
            workspaceId,
        }
    );

    return { ok: true, enabled: enabledList };
});
