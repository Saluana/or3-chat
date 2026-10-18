import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkspaceTabBar from '../WorkspaceTabBar.vue';
import { nextTick, ref } from 'vue';
import WorkspaceChrome from '../WorkspaceChrome.vue';
import WorkspaceTabSwitcher from '../WorkspaceTabSwitcher.vue';
import { IconRegistry } from '~/theme/_shared/icon-registry';
import retroTheme from '~/theme/retro/theme';
import blankIcons from '~/theme/blank/icons.config';

const iconTheme = ref('blank');
const iconRegistry = new IconRegistry();
iconRegistry.registerTheme('blank', blankIcons);
iconRegistry.registerTheme('retro', retroTheme.icons ?? {});

vi.mock('#app', () => ({
    useNuxtApp: () => ({ $iconRegistry: iconRegistry }),
}));
vi.mock('~/composables/useThemeResolver', () => ({
    useThemeResolver: () => ({ activeTheme: iconTheme }),
    useThemeOverrides: () => ({ value: {} }),
}));

const tabs = [
    {
        id: 'tab-chat',
        resource: { kind: 'chat' as const, threadId: 'chat-1' },
        cachedTitle: 'First chat',
        createdAt: 1,
        lastActivatedAt: 1,
        ephemeral: false,
    },
    {
        id: 'tab-doc',
        resource: { kind: 'document' as const, documentId: 'doc-1' },
        cachedTitle: 'Release notes',
        createdAt: 2,
        lastActivatedAt: 2,
        ephemeral: false,
    },
];

function mountBar() {
    return mount(WorkspaceTabBar, {
        props: {
            tabs,
            activeTabId: 'tab-chat',
            visibleTabIds: new Set(['tab-chat']),
        },
        attachTo: document.body,
        global: {
            stubs: {
                UIcon: { template: '<span />' },
            },
        },
    });
}

function contextMenu(): HTMLElement | null {
    return document.body.querySelector('.workspace-tab-context');
}

describe('WorkspaceTabBar', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('uses a roving tablist and activates adjacent tabs from the keyboard', async () => {
        const scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoView,
        });
        const wrapper = mountBar();
        const tabButtons = wrapper.findAll('[role="tab"]');
        expect(tabButtons[0]?.attributes('tabindex')).toBe('0');
        expect(tabButtons[1]?.attributes('tabindex')).toBe('-1');
        expect(tabButtons[0]?.attributes('aria-controls')).toBe(
            'workspace-pane-tab-chat'
        );
        expect(tabButtons[1]?.attributes('aria-controls')).toBeUndefined();

        await wrapper.get('[role="tablist"]').trigger('keydown', {
            key: 'ArrowRight',
        });
        expect(wrapper.emitted('activate')).toEqual([
            ['tab-doc', 'keyboard'],
        ]);
        wrapper.unmount();
    });

    it('focuses a context-menu action and restores tab focus on Escape', async () => {
        const wrapper = mountBar();
        const tab = wrapper.findAll('[role="tab"]')[1]!;
        await tab.trigger('contextmenu', { clientX: 20, clientY: 30 });
        await wrapper.vm.$nextTick();

        const firstItem = contextMenu()?.querySelector<HTMLButtonElement>(
            '[role="menuitem"]'
        );
        expect(document.activeElement).toBe(firstItem);

        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        await wrapper.vm.$nextTick();

        expect(contextMenu()).toBeNull();
        expect(document.activeElement).toBe(tab.element);
        wrapper.unmount();
    });

    it('keeps the new-tab action outside the horizontally scrolling tablist', () => {
        const wrapper = mountBar();
        expect(wrapper.find('[role="tablist"] .workspace-tab-new').exists()).toBe(false);
        expect(wrapper.get('.workspace-tab-new').attributes('aria-label')).toBe('New chat');
        wrapper.unmount();
    });

    it('provides accessible close and split actions without closing a tab on normal click', async () => {
        const wrapper = mountBar();
        await wrapper.get('.workspace-tab-close').trigger('click');
        expect(wrapper.emitted('close')).toEqual([['tab-chat']]);

        await wrapper
            .findAll('[role="tab"]')[1]!
            .trigger('contextmenu', { clientX: 20, clientY: 30 });
        const firstItem = contextMenu()?.querySelector('[role="menuitem"]');
        expect(firstItem).toBeTruthy();
        (firstItem as HTMLButtonElement).click();
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('close')).toEqual([
            ['tab-chat'],
            ['tab-doc'],
        ]);
        wrapper.unmount();
    });

    it('dismisses the context menu when the user clicks outside it', async () => {
        const wrapper = mountBar();
        await wrapper
            .findAll('[role="tab"]')[0]!
            .trigger('contextmenu', { clientX: 20, clientY: 30 });
        expect(contextMenu()).toBeTruthy();

        window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        await wrapper.vm.$nextTick();

        expect(contextMenu()).toBeNull();
        wrapper.unmount();
    });

    it('reorders after a real pointer drag without activating the source tab', async () => {
        const wrapper = mountBar();
        const wrappers = wrapper.findAll('.workspace-tab-wrap');
        vi.spyOn(wrappers[1]!.element, 'getBoundingClientRect').mockReturnValue(
            {
                left: 100,
                width: 100,
                right: 200,
                top: 0,
                bottom: 32,
                height: 32,
                x: 100,
                y: 0,
                toJSON: () => ({}),
            }
        );

        await wrappers[0]!.trigger('pointerdown', {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 10,
        });
        await wrappers[0]!.trigger('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 250,
        });
        await wrappers[0]!.trigger('pointerup', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 250,
        });

        expect(wrapper.emitted('reorder')).toEqual([['tab-chat', 1]]);
        expect(wrapper.emitted('activate')).toBeUndefined();
        wrapper.unmount();
    });
});

describe.each(['bar', 'switcher', 'mobile'] as const)('workspace tab icons in the %s view', (view) => {
    it('updates open tabs on theme switches while preserving blank and custom app icons', async () => {
        iconTheme.value = 'blank';
        const iconTabs = [
            ...tabs,
            { ...tabs[0]!, id: 'tab-files', resource: { kind: 'app' as const, appId: 'or3-files' }, cachedTitle: 'Files' },
            { ...tabs[0]!, id: 'tab-plugin', resource: { kind: 'app' as const, appId: 'plugin-app' }, cachedTitle: 'Plugin app' },
            { ...tabs[0]!, id: 'tab-generic', resource: { kind: 'app' as const, appId: 'generic-app' }, cachedTitle: 'Generic app' },
        ];
        const component = view === 'bar' ? WorkspaceTabBar : view === 'switcher' ? WorkspaceTabSwitcher : WorkspaceChrome;
        const wrapper = mount(component, {
            props: {
                tabs: iconTabs, activeTabId: 'tab-chat', visibleTabIds: new Set(['tab-chat']),
                iconByTabId: new Map([['tab-files', 'i-lucide-files'], ['tab-plugin', 'custom:planet']]),
                ...(view === 'mobile' ? { mobile: true } : view === 'switcher' ? { open: true } : {}),
            },
            global: {
                stubs: {
                    UIcon: { props: ['name'], template: '<span :data-icon="name" />' },
                    UButton: { template: '<button><slot /></button>' },
                    UTooltip: { template: '<div><slot /></div>' },
                    UModal: { props: ['open'], template: '<div v-if="open"><slot name="header" /><slot name="body" /><slot name="footer" /></div>' },
                    UInput: true, USelectMenu: true,
                },
            },
        });
        for (const theme of ['blank', 'retro', 'blank'] as const) {
            iconTheme.value = theme;
            await nextTick();
            const expected = theme === 'retro'
                ? ['pixelarticons:chat', 'pixelarticons:note', 'pixelarticons:files', 'custom:planet', 'pixelarticons:grid']
                : ['blank-solar:chat-round-linear', 'blank-solar:document-text-linear', 'blank-solar:documents-linear', 'custom:planet', 'blank-solar:panels-top-left-linear'];
            for (const [index, tab] of iconTabs.entries()) {
                if (view === 'mobile') await wrapper.setProps({ activeTabId: tab.id });
                const row = view === 'bar'
                    ? wrapper.get(`[data-tab-id="${tab.id}"]`)
                    : view === 'switcher'
                        ? wrapper.findAll('.workspace-tab-switcher-option').find(option => option.text().includes(tab.cachedTitle))!
                        : wrapper.get('.workspace-chrome-active-title');
                expect(row.get('.app-icon [data-icon]').attributes('data-icon')).toBe(expected[index]);
            }
            if (view === 'bar') {
                expect(wrapper.get('.workspace-tab-close [data-icon]').attributes('data-icon')).toBe(
                    theme === 'retro' ? 'pixelarticons:close' : 'blank-solar:close-linear'
                );
            }
        }
        wrapper.unmount();
    });
});
