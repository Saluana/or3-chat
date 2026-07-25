import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import {
    useDashboardNavigation,
    type DashboardNavigationResult,
} from '~/composables/dashboard/useDashboardPlugins';
import { getPaletteCommand } from './registry';
import {
    clearPendingPaletteImageSelection,
    setPendingPaletteImageSelection,
} from './image-selection';
import { requestPaletteProjectReveal } from './project-reveal';
import type {
    PaletteActionErrorCode,
    PaletteActionResult,
    PaletteHostContext,
} from './types';

export interface PaletteHostContextDeps {
    expandSidebar?: () => void | Promise<void>;
    activateDefaultSidebarPage?: () => void | Promise<void>;
    openImageLibraryPage?: () => void | Promise<void>;
    setDashboardOpen?: (open: boolean) => void;
    canOpenNewPane?: () => boolean;
    getMultiPaneApi?: typeof getGlobalMultiPaneApi;
    getDashboardNavigation?: () => {
        openPlugin: (pluginId: string) => Promise<DashboardNavigationResult>;
        openPage: (
            pluginId: string,
            pageId: string
        ) => Promise<DashboardNavigationResult>;
    };
}

function mapDashboardResult(
    result: DashboardNavigationResult
): PaletteActionResult {
    if (result.ok) return { ok: true };
    return {
        ok: false,
        error: {
            code: 'navigation-failed',
            message: result.error.message,
            cause: result.error,
        },
    };
}

function failure(
    code: PaletteActionErrorCode,
    message: string,
    cause?: unknown
): PaletteActionResult {
    return { ok: false, error: { code, message, cause } };
}

/**
 * Create a narrow host navigation context for palette actions.
 * PageShell (UI phase) supplies expand/sidebar/dashboard wiring via deps.
 */
export function createPaletteHostContext(
    deps: PaletteHostContextDeps = {}
): PaletteHostContext {
    const getMultiPane = deps.getMultiPaneApi ?? getGlobalMultiPaneApi;
    const getDashboardNav =
        deps.getDashboardNavigation ??
        (() => {
            const nav = useDashboardNavigation();
            return {
                openPlugin: nav.openPlugin,
                openPage: nav.openPage,
            };
        });

    return {
        canOpenNewPane() {
            if (deps.canOpenNewPane) return deps.canOpenNewPane();
            return getMultiPane()?.canAddPane.value ?? false;
        },

        async openChat(threadId, destination) {
            const api = getMultiPane();
            if (!api) {
                return failure('navigation-failed', 'Multi-pane host unavailable');
            }
            try {
                if (destination === 'new-pane') {
                    if (!api.canAddPane.value) {
                        return failure('disabled', 'Pane capacity reached');
                    }
                    const index = api.panes.value.length;
                    api.addPane();
                    await api.setPaneThread(index, threadId);
                    return { ok: true };
                }
                await api.setPaneThread(api.activePaneIndex.value, threadId);
                return { ok: true };
            } catch (error) {
                return failure(
                    'navigation-failed',
                    error instanceof Error ? error.message : 'Failed to open chat',
                    error
                );
            }
        },

        async openDocument(documentId, destination) {
            const api = getMultiPane();
            if (!api) {
                return failure('navigation-failed', 'Multi-pane host unavailable');
            }
            try {
                if (destination === 'new-pane') {
                    if (!api.canAddPane.value) {
                        return failure('disabled', 'Pane capacity reached');
                    }
                    const index = api.panes.value.length;
                    api.addPane();
                    api.updatePane(index, {
                        mode: 'doc',
                        documentId,
                        threadId: '',
                        messages: [],
                    });
                    return { ok: true };
                }
                api.updatePane(api.activePaneIndex.value, {
                    mode: 'doc',
                    documentId,
                    threadId: '',
                    messages: [],
                });
                return { ok: true };
            } catch (error) {
                return failure(
                    'navigation-failed',
                    error instanceof Error
                        ? error.message
                        : 'Failed to open document',
                    error
                );
            }
        },

        async openPaneApp(appId, recordId, destination) {
            const api = getMultiPane();
            if (!api) {
                return failure('navigation-failed', 'Multi-pane host unavailable');
            }
            try {
                if (destination === 'new-pane') {
                    if (!api.canAddPane.value) {
                        return failure('disabled', 'Pane capacity reached');
                    }
                    await api.newPaneForApp(appId, { initialRecordId: recordId });
                    return { ok: true };
                }
                await api.setPaneApp(api.activePaneIndex.value, appId, {
                    recordId,
                });
                return { ok: true };
            } catch (error) {
                return failure(
                    'navigation-failed',
                    error instanceof Error
                        ? error.message
                        : 'Failed to open pane app',
                    error
                );
            }
        },

        async revealProject(projectId) {
            try {
                await deps.expandSidebar?.();
                await deps.activateDefaultSidebarPage?.();
                requestPaletteProjectReveal(projectId);
                return { ok: true };
            } catch (error) {
                return failure(
                    'navigation-failed',
                    error instanceof Error
                        ? error.message
                        : 'Failed to reveal project',
                    error
                );
            }
        },

        async openDashboard(pluginId, pageId) {
            try {
                deps.setDashboardOpen?.(true);
                const nav = getDashboardNav();
                if (pageId) {
                    return mapDashboardResult(await nav.openPage(pluginId, pageId));
                }
                return mapDashboardResult(await nav.openPlugin(pluginId));
            } catch (error) {
                return failure(
                    'navigation-failed',
                    error instanceof Error
                        ? error.message
                        : 'Failed to open dashboard',
                    error
                );
            }
        },

        async openImage(hash) {
            try {
                setPendingPaletteImageSelection(hash);
                await deps.openImageLibraryPage?.();
                return { ok: true };
            } catch (error) {
                clearPendingPaletteImageSelection(hash);
                return failure(
                    'navigation-failed',
                    error instanceof Error
                        ? error.message
                        : 'Failed to open image',
                    error
                );
            }
        },

        async executeCommand(commandId) {
            const command = getPaletteCommand(commandId, {
                includeInaccessible: true,
            });
            if (!command) {
                return failure('not-found', `Command "${commandId}" not found`);
            }
            try {
                const result = await command.handler();
                if (result.ok) {
                    return {
                        ok: true,
                        closeOnSuccess: command.closeOnSuccess !== false,
                    };
                }
                return result;
            } catch (error) {
                return failure(
                    'execution-failed',
                    error instanceof Error
                        ? error.message
                        : 'Command execution failed',
                    error
                );
            }
        },
    };
}
