/**
 * @module server/api/admin/plugins/workspace-settings.post
 *
 * Purpose:
 * Updates configuration values for a plugin.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { setPluginSettings } from '../../../admin/plugins/workspace-plugin-store';

const BodySchema = z.object({
    pluginId: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
});

/**
 * POST /api/admin/plugins/workspace-settings
 *
 * Purpose:
 * Persist plugin settings.
 *
 * Behavior:
 * - Overwrites provided keys (merge strategy depends on implementation of `setPluginSettings`, usually merge).
 * - Validates inputs via Zod.
 *
 * Security:
 * - Admin-only (Mutation).
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
    try {
        await setPluginSettings(
            store,
            workspaceId,
            body.data.pluginId,
            body.data.settings
        );
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid settings' });
    }

    return { ok: true };
});
