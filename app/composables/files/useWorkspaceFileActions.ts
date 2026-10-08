import { computed } from 'vue';
import type { PluginFileAction } from '@or3/plugin-sdk';
import { createRegistry } from '~/composables/_registry';
import { getActiveWorkspaceId } from '~/db/client';
import { getPluginGateDecision } from '~/utils/plugins/access-gate';

export interface WorkspaceFileAction extends PluginFileAction {
    readonly pluginId: string;
    readonly workspaceId: string;
}

const registry = createRegistry<WorkspaceFileAction>('__or3WorkspaceFileActionsRegistry');
export const registerWorkspaceFileAction = registry.register;

export function useWorkspaceFileActions() {
    const items = registry.useItems();
    return computed(() => items.value.filter(action =>
        action.workspaceId === (getActiveWorkspaceId() ?? 'local') && getPluginGateDecision(action.pluginId).allowed));
}
