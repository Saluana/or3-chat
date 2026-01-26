import { defineEventHandler, createError } from 'h3';
import { requireAdminApi } from '../../admin/api';
import {
    getWorkspaceAccessStore,
    getWorkspaceSettingsStore,
} from '../../admin/stores/registry';
import { getEnabledPlugins } from '../../admin/plugins/workspace-plugin-store';

export default defineEventHandler(async (event) => {
    const session = await requireAdminApi(event);

    if (!session.workspace?.id) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Workspace not resolved',
        });
    }

    const accessStore = getWorkspaceAccessStore(event);
    const settingsStore = getWorkspaceSettingsStore(event);

    const members = await accessStore.listMembers({
        workspaceId: session.workspace.id,
    });
    const enabledPlugins = await getEnabledPlugins(
        settingsStore,
        session.workspace.id
    );
    const guestAccessValue = await settingsStore.get(
        session.workspace.id,
        'admin.guest_access.enabled'
    );

    return {
        workspace: session.workspace,
        role: session.role,
        members,
        enabledPlugins,
        guestAccessEnabled: guestAccessValue === 'true',
    };
});
