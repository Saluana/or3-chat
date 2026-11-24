import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { RegisteredSidebarPage } from '../useSidebarPages';

const pages = new Map<string, RegisteredSidebarPage>();
const state = new Map<string, Ref<unknown>>();
const doAction = vi.fn(async (_name: string, _payload: unknown) => undefined);
vi.mock('#imports', () => ({ useState: <T>(key: string, init: () => T): Ref<T> => {
    if (!state.has(key)) state.set(key, ref(init()));
    return state.get(key) as Ref<T>;
} }));
vi.mock('../useSidebarPages', () => ({
    useSidebarPages: () => ({
        getSidebarPage: (id: string) => pages.get(id),
        listSidebarPages: computed(() => [...pages.values()]),
    }),
}));
vi.mock('~/core/hooks/useHooks', () => ({ useHooks: () => ({ doAction }) }));
vi.mock('~/state/global', () => ({ isMobile: ref(false) }));
vi.mock('~/core/workspace-profiles/projection', () => ({
    resolvedWorkspaceProfile: ref({ id: 'test', navigation: {
        items: ['sidebar-home', 'sidebar-chats', 'sidebar-docs'], hidden: [],
    }, mobile: { bottomNavigation: ['sidebar-home'] } }),
    workspaceProfileDefaultPage: () => 'sidebar-home',
}));

const { useActiveSidebarPage, __resetActiveSidebarPageForTests } = await import('../useActiveSidebarPage');
const { useProjectSidebar } = await import('../useProjectSidebar');
function page(id: string, hooks: Partial<RegisteredSidebarPage> = {}): RegisteredSidebarPage {
    return { id, label: id, icon: 'test', component: defineComponent(() => () => h('div')), ...hooks } as RegisteredSidebarPage;
}

describe('sidebar page transitions', () => {
    beforeEach(() => {
        vi.stubGlobal('process', { ...process, client: true });
        doAction.mockClear();
        state.clear();
        pages.clear();
        pages.set('sidebar-home', page('sidebar-home'));
        pages.set('sidebar-chats', page('sidebar-chats'));
        pages.set('sidebar-docs', page('sidebar-docs'));
        pages.set('sidebar-projects-home', page('sidebar-projects-home'));
        __resetActiveSidebarPageForTests();
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each(['admission', 'activation-failure'] as const)('keeps the latest selection when an earlier %s settles late', async phase => {
        let release!: () => void;
        const delayed = new Promise<void>(resolve => { release = resolve; });
        pages.set('sidebar-chats', page('sidebar-chats', phase === 'admission'
            ? { canActivate: async () => { await delayed; return true; } }
            : { onActivate: async () => { await delayed; throw new Error('Old activation failed'); } }));
        let sidebar!: ReturnType<typeof useActiveSidebarPage>;
        const wrapper = mount(defineComponent({ setup() { sidebar = useActiveSidebarPage(); return () => h('div'); } }));
        try {
            const older = sidebar.setActivePage('sidebar-chats');
            expect(await sidebar.setActivePage('sidebar-docs')).toBe(true);
            release();
            expect(await older).toBe(false);
            expect(sidebar.activePageId.value).toBe('sidebar-docs');
            expect(localStorage.getItem('or3-active-sidebar-page')).toBe('sidebar-docs');
            expect(doAction.mock.calls.filter(([name]) => name === 'ui.sidebar.page:action:open')
                .map(([, payload]) => payload)).toEqual([expect.objectContaining({ id: 'sidebar-docs' })]);
        } finally { wrapper.unmount(); }
    });

    it.each(['project', 'list'] as const)('keeps newer project navigation to a %s after an older request is superseded', async destination => {
        let release!: () => void;
        const delayed = new Promise<void>(resolve => { release = resolve; });
        pages.set('sidebar-home', page('sidebar-home', {
            onDeactivate: vi.fn().mockImplementationOnce(() => delayed).mockResolvedValue(undefined),
        }));
        const projects = useProjectSidebar();
        projects.projectId.value = 'initial-project';
        const older = projects.openProjectSidebar('older-project');
        if (destination === 'project') await projects.openProjectSidebar('newer-project');
        else await projects.openProjectsSidebar();
        release();
        await expect(older).resolves.toBeUndefined();
        expect(projects.projectId.value).toBe(destination === 'project' ? 'newer-project' : '');
    });
});
