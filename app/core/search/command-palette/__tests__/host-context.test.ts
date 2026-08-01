import { describe, expect, it, vi } from 'vitest';
import { createPaletteHostContext } from '../host-context';
import {
    consumePendingPaletteImageSelection,
    __resetPaletteImageSelectionForTests,
} from '../image-selection';
import {
    consumePaletteProjectReveal,
    __resetPaletteProjectRevealForTests,
} from '../project-reveal';
import { ref } from 'vue';

describe('createPaletteHostContext', () => {
    it('opens chat in active vs new pane', async () => {
        const setPaneThread = vi.fn(async () => undefined);
        const addPane = vi.fn();
        const api = {
            canAddPane: ref(true),
            panes: ref([{ id: 'p0' }]),
            activePaneIndex: ref(0),
            addPane,
            setPaneThread,
            updatePane: vi.fn(),
            newPaneForApp: vi.fn(),
            setPaneApp: vi.fn(),
        };
        const host = createPaletteHostContext({
            getMultiPaneApi: () => api as never,
            getDashboardNavigation: () => ({
                openPlugin: vi.fn(),
                openPage: vi.fn(),
            }),
        });

        await host.openChat('t1', 'active');
        expect(setPaneThread).toHaveBeenCalledWith(0, 't1');

        await host.openChat('t2', 'new-pane');
        expect(addPane).toHaveBeenCalled();
        expect(setPaneThread).toHaveBeenCalledWith(1, 't2');
    });

    it('routes resource results through the workspace tab host when supplied', async () => {
        const openWorkspaceResource = vi.fn(async () => 'tab-1');
        const host = createPaletteHostContext({
            openWorkspaceResource,
            getMultiPaneApi: () => undefined,
            getDashboardNavigation: () => ({
                openPlugin: vi.fn(),
                openPage: vi.fn(),
            }),
        });

        await expect(host.openChat('chat-1', 'active')).resolves.toEqual({ ok: true });
        await expect(host.openDocument('doc-1', 'new-pane')).resolves.toEqual({ ok: true });
        await expect(
            host.openPaneApp('example:app', 'record-1', 'active')
        ).resolves.toEqual({ ok: true });
        expect(openWorkspaceResource).toHaveBeenNthCalledWith(
            1,
            { kind: 'chat', threadId: 'chat-1' },
            { target: 'active' }
        );
        expect(openWorkspaceResource).toHaveBeenNthCalledWith(
            2,
            { kind: 'document', documentId: 'doc-1' },
            { target: 'split' }
        );
        expect(openWorkspaceResource).toHaveBeenNthCalledWith(
            3,
            {
                kind: 'app',
                appId: 'example:app',
                recordId: 'record-1',
                instanceKey: undefined,
            },
            { target: 'active' }
        );
    });

    it('gives record-less pane apps a valid tab instance identity', async () => {
        const openWorkspaceResource = vi.fn(async () => 'tab-app');
        const host = createPaletteHostContext({
            openWorkspaceResource,
            getMultiPaneApi: () => undefined,
            getDashboardNavigation: () => ({
                openPlugin: vi.fn(),
                openPage: vi.fn(),
            }),
        });

        await expect(
            host.openPaneApp('example:app', undefined, 'active')
        ).resolves.toEqual({ ok: true });
        expect(openWorkspaceResource).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'app',
                appId: 'example:app',
                instanceKey: expect.any(String),
            }),
            { target: 'active' }
        );
    });

    it('reveals projects and selects images via pending state', async () => {
        __resetPaletteProjectRevealForTests();
        __resetPaletteImageSelectionForTests();
        const expandSidebar = vi.fn();
        const activateDefaultSidebarPage = vi.fn();
        const openImageLibraryPage = vi.fn();
        const host = createPaletteHostContext({
            expandSidebar,
            activateDefaultSidebarPage,
            openImageLibraryPage,
            getMultiPaneApi: () => undefined,
            getDashboardNavigation: () => ({
                openPlugin: vi.fn(),
                openPage: vi.fn(),
            }),
        });

        await host.revealProject('proj-1');
        expect(expandSidebar).toHaveBeenCalled();
        expect(activateDefaultSidebarPage).toHaveBeenCalled();
        expect(consumePaletteProjectReveal()?.projectId).toBe('proj-1');

        await host.openImage('hash-1');
        expect(openImageLibraryPage).toHaveBeenCalled();
        expect(consumePendingPaletteImageSelection()).toBe('hash-1');
    });

    it('opens exact dashboard pages', async () => {
        const openPage = vi.fn(async () => ({ ok: true as const }));
        const openPlugin = vi.fn(async () => ({ ok: true as const }));
        const setDashboardOpen = vi.fn();
        const host = createPaletteHostContext({
            setDashboardOpen,
            getMultiPaneApi: () => undefined,
            getDashboardNavigation: () => ({ openPlugin, openPage }),
        });
        const result = await host.openDashboard('settings', 'theme');
        expect(setDashboardOpen).toHaveBeenCalledWith(true);
        expect(openPage).toHaveBeenCalledWith('settings', 'theme');
        expect(result).toEqual({ ok: true });
    });

    it('opens system prompt modal modes through the host dependency', async () => {
        const openSystemPrompts = vi.fn();
        const host = createPaletteHostContext({
            openSystemPrompts,
            getMultiPaneApi: () => undefined,
            getDashboardNavigation: () => ({
                openPlugin: vi.fn(),
                openPage: vi.fn(),
            }),
        });

        await expect(
            host.openSystemPrompts({
                mode: 'edit',
                promptId: 'prompt-1',
            })
        ).resolves.toEqual({ ok: true });
        expect(openSystemPrompts).toHaveBeenCalledWith({
            mode: 'edit',
            promptId: 'prompt-1',
        });
    });

    it('clears a queued image selection when navigation fails', async () => {
        __resetPaletteImageSelectionForTests();
        const host = createPaletteHostContext({
            openImageLibraryPage: async () => {
                throw new Error('dashboard unavailable');
            },
            getMultiPaneApi: () => undefined,
            getDashboardNavigation: () => ({
                openPlugin: vi.fn(),
                openPage: vi.fn(),
            }),
        });

        const result = await host.openImage('stale-hash');
        expect(result.ok).toBe(false);
        expect(consumePendingPaletteImageSelection()).toBeNull();
    });
});
