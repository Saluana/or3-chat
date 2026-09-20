import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
import { getPortableClientSource } from './portable-client-runtime';

/** Encode every character so different publisher IDs cannot collide. */
export function portablePaneId(pluginId: string): string {
    return `portable-${Array.from(pluginId, (character) => character.charCodeAt(0).toString(16)).join('')}`;
}

/** Focus an existing plugin pane, or open it alongside the user's work. */
export async function openPortablePane(pluginId: string): Promise<void> {
    if (!getPortableClientSource(pluginId)) throw new Error('This plugin is not available in the current workspace.');
    const navigation = getWorkspaceResourceNavigationApi();
    if (navigation?.canOpenInNewTab()) {
        const opened = await navigation.openResource({ kind: 'app', appId: portablePaneId(pluginId), instanceKey: pluginId }, 'new-tab', { reuseExisting: true });
        if (!opened) throw new Error('The plugin tab could not be opened.');
        return;
    }
    const api = getGlobalMultiPaneApi();
    if (!api) throw new Error('Open the chat workspace before opening this plugin.');
    const appId = portablePaneId(pluginId);
    const existing = api.panes.value.findIndex((pane) => pane.mode === appId);
    if (existing >= 0) { api.setActive(existing); return; }
    if (!api.canAddPane.value) throw new Error('Close a workspace pane before opening this plugin.');
    await api.newPaneForApp(appId);
}
