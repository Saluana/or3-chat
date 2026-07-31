/**
 * @module server/api/admin/plugins/workspace-settings.post
 *
 * Purpose:
 * Updates configuration values for a plugin.
 */
import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { setPluginSettings } from '../../../admin/plugins/workspace-plugin-store';
import { StrictPluginGatePolicySchema } from '~~/shared/plugins/access-policy';
import { resolveAdminWorkspaceTarget } from '../../../admin/workspace-target';

const BodySchema = z.object({
    pluginId: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
    workspaceId: z.string().min(1).optional(),
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
    const maybeAccess = body.data.settings.access;
    if (maybeAccess !== undefined) {
        const parsedAccess = StrictPluginGatePolicySchema.safeParse(maybeAccess);
        if (!parsedAccess.success) {
            throw createError({ statusCode: 400, statusMessage: 'Invalid request' });
        }
    }

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
