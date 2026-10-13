import { useIcon } from '~/composables/useIcon';
import { DEFAULT_ICONS } from '~/config/icon-tokens';
import { workspaceTabFallbackIcon } from '~/core/workspace-tabs/display';
import type { WorkspaceTab } from '~/core/workspace-tabs/types';

/** Resolve tab content icons reactively, preserving supplied plugin icons. */
export function useWorkspaceTabIcon() {
    const chatIcon = useIcon('shell.tab.chat');
    const documentIcon = useIcon('shell.tab.document');
    const appIcon = useIcon('shell.tab.app');
    const filesIcon = useIcon('sidebar.page.files');

    return (tab: WorkspaceTab, suppliedIcon?: string): string => {
        // Files registers its default concrete icon; let the active theme replace it.
        if (tab.resource.kind === 'app' && tab.resource.appId === 'or3-files'
            && (!suppliedIcon || suppliedIcon === DEFAULT_ICONS['sidebar.page.files'])) {
            return filesIcon.value;
        }
        return suppliedIcon || workspaceTabFallbackIcon(tab, {
            chat: chatIcon.value,
            document: documentIcon.value,
            app: appIcon.value,
        });
    };
}
