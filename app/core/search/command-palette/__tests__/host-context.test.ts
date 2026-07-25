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
