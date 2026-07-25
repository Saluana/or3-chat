import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { PaletteAction } from '~/core/search/command-palette/types';

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => computed(() => ({})),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

const CommandPaletteActionTray = (await import('../CommandPaletteActionTray.vue'))
    .default;

function action(overrides: Partial<PaletteAction> = {}): PaletteAction {
    return {
        id: 'open',
        label: 'Open',
        kind: 'open-chat',
        payload: { threadId: 't1' },
        ...overrides,
    } as PaletteAction;
}

const UButtonStub = {
    name: 'UButton',
    props: ['disabled'],
    inheritAttrs: false,
    template:
        '<button type="button" v-bind="$attrs" :disabled="disabled"><slot /></button>',
};

function mountTray(props: {
    secondaryActions?: PaletteAction[];
    trayOpen?: boolean;
}) {
    return mount(CommandPaletteActionTray, {
        attachTo: document.body,
        props: {
            primaryAction: action(),
            secondaryActions: props.secondaryActions ?? [],
            trayOpen: props.trayOpen ?? false,
        },
        global: { stubs: { UButton: UButtonStub } },
    });
}

describe('CommandPaletteActionTray', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('focuses the first enabled secondary action', () => {
        const wrapper = mountTray({
            secondaryActions: [
                action({ id: 'disabled', label: 'Blocked', disabled: true }),
                action({ id: 'new-pane', label: 'New pane' }),
            ],
            trayOpen: true,
        });

        expect(wrapper.vm.focusFirstAction()).toBe(true);
        expect((document.activeElement as HTMLElement).textContent).toContain(
            'New pane'
        );
        wrapper.unmount();
    });

    it('falls back to the primary button when no secondary action is enabled', () => {
        const wrapper = mountTray({
            secondaryActions: [
                action({ id: 'disabled', label: 'Blocked', disabled: true }),
            ],
            trayOpen: true,
        });

        expect(wrapper.vm.focusFirstAction()).toBe(true);
        expect((document.activeElement as HTMLElement).textContent).toContain(
            'Open'
        );
        wrapper.unmount();
    });

    it('cycles focus with Tab and Shift+Tab while the tray is active', async () => {
        const wrapper = mountTray({
            secondaryActions: [
                action({ id: 'a', label: 'Action A' }),
                action({ id: 'b', label: 'Action B' }),
            ],
            trayOpen: true,
        });

        wrapper.vm.focusFirstAction();
        const root = wrapper.get('.or3-palette-actions');

        await root.trigger('keydown', { key: 'Tab' });
        expect((document.activeElement as HTMLElement).textContent).toContain(
            'Action B'
        );

        await root.trigger('keydown', { key: 'Tab' });
        expect((document.activeElement as HTMLElement).textContent).toContain(
            'Open'
        );

        await root.trigger('keydown', { key: 'Tab', shiftKey: true });
        expect((document.activeElement as HTMLElement).textContent).toContain(
            'Action B'
        );
        wrapper.unmount();
    });

    it('leaves Tab alone when the tray is not active', async () => {
        const wrapper = mountTray({
            secondaryActions: [action({ id: 'a', label: 'Action A' })],
            trayOpen: false,
        });

        const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        wrapper.get('.or3-palette-actions').element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        wrapper.unmount();
    });

    it('emits the action on click and shows the disabled reason', async () => {
        const wrapper = mountTray({
            secondaryActions: [
                action({
                    id: 'blocked',
                    label: 'New pane',
                    disabled: true,
                    disabledReason: 'Pane capacity reached',
                }),
            ],
        });

        expect(wrapper.text()).toContain('Pane capacity reached');
        await wrapper.get('button').trigger('click');
        expect(wrapper.emitted('run')?.[0]?.[0]).toMatchObject({ id: 'open' });
        wrapper.unmount();
    });

    it('explains when a result has no extra actions', () => {
        const wrapper = mountTray({ secondaryActions: [] });
        expect(wrapper.text()).toContain('No additional actions for this result.');
        wrapper.unmount();
    });
});
