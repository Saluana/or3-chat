import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { getWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { getPortableClientSource } from './portable-client-runtime';

/** Encode every character so different publisher IDs cannot collide. */
export function portablePaneId(pluginId: string): string {
    return `portable-${Array.from(pluginId, (character) => character.charCodeAt(0).toString(16)).join('')}`;
}

/** Open a plugin pane; return false for supersession, throw for a real failure. */
export async function openPortablePane(pluginId: string): Promise<boolean> {
    if (!getPortableClientSource(pluginId)) throw new Error('This plugin is not available in the current workspace.');
    return openPaneApp(portablePaneId(pluginId), pluginId);
}

/** Open an installed plugin's pane; false means a newer navigation took over. */
export async function openInstalledPluginPane(pluginId: string): Promise<boolean> {
    if (getPortableClientSource(pluginId)) {
        return openPaneApp(portablePaneId(pluginId), pluginId);
    }
    const pane = usePaneApps().listPaneApps.value.find((app) => app.pluginId === pluginId);
    if (!pane) throw new Error('This plugin interface is not running in the current workspace.');
    return openPaneApp(pane.id, pluginId);
}

async function openPaneApp(appId: string, pluginId: string): Promise<boolean> {
    const navigation = getWorkspaceResourceNavigationApi();
    if (navigation?.canOpenInNewTab()) {
        const opened = await navigation.openResource({ kind: 'app', appId, instanceKey: pluginId }, 'new-tab', { reuseExisting: true });
        if (opened.status === 'superseded') return false;
        if (opened.status !== 'activated') throw new Error('The plugin tab could not be opened.');
        return true;
    }
    const api = getGlobalMultiPaneApi();
    if (!api) throw new Error('Open the chat workspace before opening this plugin.');
    const existing = api.panes.value.findIndex((pane) => pane.mode === appId);
    if (existing >= 0) { api.setActive(existing); return true; }
    if (!api.canAddPane.value) throw new Error('Close a workspace pane before opening this plugin.');
    await api.newPaneForApp(appId);
    return true;
}
