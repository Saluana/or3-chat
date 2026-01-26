import { defineEventHandler, readBody, createError } from 'h3';
import { z } from 'zod';
import { requireAdminApi } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { setPluginEnabled } from '../../../admin/plugins/workspace-plugin-store';

const BodySchema = z.object({
    pluginId: z.string().min(1),
    enabled: z.boolean(),
});

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
