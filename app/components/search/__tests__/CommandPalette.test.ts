import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref, shallowRef, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import { DialogContent, DialogDescription, DialogRoot, DialogTitle } from 'reka-ui';
import type {
    PaletteAction,
    PaletteResult,
} from '~/core/search/command-palette/types';
import type { PaletteResultGroup } from '~/composables/search/useCommandPalette';

function action(overrides: Partial<PaletteAction> = {}): PaletteAction {
    return {
        id: 'open',
        label: 'Open',
        kind: 'open-chat',
        payload: { threadId: 't1' },
        ...overrides,
    } as PaletteAction;
}

function result(overrides: Partial<PaletteResult> = {}): PaletteResult {
    return {
        key: 'chat:t1',
        sourceId: 'chat',
        categoryId: 'chat',
        recordId: 't1',
        title: 'Thread one',
        snippet: 'Discussed astilbe care',
        primaryAction: action(),
        secondaryActions: [],
        metadata: {},
        ...overrides,
    } as PaletteResult;
}

const controller = {
    isOpen: ref(true),
    query: ref(''),
    loading: ref(false),
    results: shallowRef<PaletteResult[]>([]),
    activeKey: ref<string | null>('chat:t1'),
    statuses: ref([]),
    sourceLabels: ref({ chat: 'Chats' }),
    preview: ref<Record<string, unknown> | null>({
        title: 'Thread one',
        categoryId: 'chat',
        description: 'Astilbe is a shade perennial.',
    }),
    previewLoading: ref(false),
    actionTrayOpen: ref(false),
    announcement: ref('1 result available'),
    errorMessage: ref<string | null>(null),
    focusToken: ref(0),
    activeCategoryId: ref<string | undefined>(undefined),
};

const close = vi.fn();
const setActive = vi.fn();
const activateByPointer = vi.fn();
const hoverActive = vi.fn();
const releaseHoverLock = vi.fn();
const moveActive = vi.fn();
const runPrimary = vi.fn();
const runAction = vi.fn();
const openActionTray = vi.fn(() => true);
const closeActionTray = vi.fn();
const setCategoryFilter = vi.fn();
const retrySource = vi.fn();

vi.mock('~/composables/search/useCommandPalette', () => ({
    useCommandPalette: () => ({
        ...controller,
        groups: computed<PaletteResultGroup[]>(() =>
            controller.results.value.length
                ? [
                      {
                          categoryId: 'chat',
                          label: 'Chats',
                          results: controller.results.value,
                      },
                  ]
                : []
        ),
        flatResults: computed(() => controller.results.value),
        activeResult: computed(
            () =>
                controller.results.value.find(
                    (entry) => entry.key === controller.activeKey.value
                ) ?? null
        ),
        secondaryActions: computed(
            () =>
                controller.results.value.find(
                    (entry) => entry.key === controller.activeKey.value
                )?.secondaryActions ?? []
        ),
        categories: computed(() => [
            { id: 'chat', label: 'Chats', aliases: ['chat'], order: 10 },
            { id: 'command', label: 'Commands', aliases: ['cmd'], order: 20 },
        ]),
        close,
        setActive,
        activateByPointer,
        hoverActive,
        releaseHoverLock,
        moveActive,
        runPrimary,
        runAction,
        openActionTray,
        closeActionTray,
        setCategoryFilter,
        retrySource,
    }),
}));

vi.mock('~/composables/search/useCommandPaletteShortcut', () => ({
    useCommandPaletteShortcut: () => {},
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => computed(() => ({})),
}));

const CommandPalette = (await import('../CommandPalette.vue')).default;

// UModal renders through a portal in the real app; the stub keeps the content
// inline so assertions can read the palette markup directly.
const UModalStub = defineComponent({
    name: 'UModal',
    props: ['open', 'title', 'description'],
    setup(props, { slots }) {
        return () => (props.open ? h('div', slots.content?.()) : null);
    },
});

const RekaModalStub = defineComponent({
    name: 'UModal',
    props: ['open', 'content'],
    emits: ['update:open'],
    setup(props, { slots, emit }) {
        return () => h(DialogRoot, {
            open: props.open,
            'onUpdate:open': (open: boolean) => emit('update:open', open),
        }, () => h(DialogContent, props.content, () => [
            h(DialogTitle, {}, () => 'Command palette'),
            h(DialogDescription, {}, () => 'Search the workspace'),
            slots.content?.(),
        ]));
    },
});

function mountPalette(modal: Component = UModalStub) {
    return mount(CommandPalette, {
        attachTo: document.body,
        global: {
            stubs: {
                UModal: modal,
                UButton: {
                    name: 'UButton',
                    props: ['disabled'],
                    inheritAttrs: false,
                    template:
                        '<button type="button" v-bind="$attrs" :disabled="disabled"><slot /></button>',
                },
            },
        },
    });
}

function dispatchKeyboard(
    target: Element,
    type: 'keydown' | 'keyup',
    { timeStamp, ...init }: KeyboardEventInit & { timeStamp: number }
): KeyboardEvent {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    target.dispatchEvent(event);
    return event;
}

describe('CommandPalette overlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        controller.isOpen.value = true;
        controller.query.value = '';
        controller.loading.value = false;
        controller.results.value = [result()];
        controller.activeKey.value = 'chat:t1';
        controller.actionTrayOpen.value = false;
        controller.errorMessage.value = null;
        controller.activeCategoryId.value = undefined;
    });

    it('exposes combobox and listbox semantics', () => {
        const wrapper = mountPalette();
        const input = wrapper.get('input[role="combobox"]');

        expect(input.attributes('aria-controls')).toBe('or3-palette-listbox');
        expect(input.attributes('aria-expanded')).toBe('true');
        expect(input.attributes('aria-autocomplete')).toBe('list');
        expect(input.attributes('aria-activedescendant')).toBe(
            'or3-palette-option-chat%3At1'
        );

        const listbox = wrapper.get('#or3-palette-listbox');
        expect(listbox.attributes('role')).toBe('listbox');
        const option = wrapper.get('[role="option"]');
        expect(option.attributes('id')).toBe('or3-palette-option-chat%3At1');
        expect(option.attributes('aria-selected')).toBe('true');
        wrapper.unmount();
    });

    it('renders a polite live region with the current announcement', () => {
        const wrapper = mountPalette();
        const live = wrapper.get('[role="status"]');
        expect(live.attributes('aria-live')).toBe('polite');
        expect(live.text()).toBe('1 result available');
        wrapper.unmount();
    });

    it('moves the active row with arrow keys and prevents scrolling', async () => {
        const wrapper = mountPalette();
        const input = wrapper.get('input[role="combobox"]');

        await input.trigger('keydown', { key: 'ArrowDown' });
        expect(moveActive).toHaveBeenCalledWith(1);
        await input.trigger('keydown', { key: 'ArrowUp' });
        expect(moveActive).toHaveBeenCalledWith(-1);
        wrapper.unmount();
    });

    it('runs the primary action on Enter and closes on Escape', async () => {
        const wrapper = mountPalette();
        const input = wrapper.get('input[role="combobox"]');

        await input.trigger('keydown', { key: 'Enter' });
        expect(runPrimary).toHaveBeenCalledTimes(1);

        await input.trigger('keydown', { key: 'Escape' });
        expect(close).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it.each([
        { isComposing: true },
        { keyCode: 229 },
    ])('leaves candidate selection and commit keys to the input method with %j', async composition => {
        const wrapper = mountPalette(RekaModalStub);
        try {
            await nextTick();
            const input = wrapper.get('input[role="combobox"]');
            for (const [index, key] of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].entries()) {
                dispatchKeyboard(input.element, 'keydown', { key, timeStamp: 100 + index, ...composition });
            }
            expect(moveActive).not.toHaveBeenCalled();
            expect(runPrimary).not.toHaveBeenCalled();
            expect(openActionTray).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();

            // Reka listens for Escape on window independently of the input.
            dispatchKeyboard(wrapper.get('[role="dialog"]').element, 'keydown', { key: 'Escape', timeStamp: 105, ...composition });
            expect(close).not.toHaveBeenCalled();

            dispatchKeyboard(input.element, 'keydown', { key: 'Enter', timeStamp: 106 });
            expect(runPrimary).toHaveBeenCalledOnce();
            dispatchKeyboard(input.element, 'keydown', { key: 'Escape', timeStamp: 107 });
            expect(close).toHaveBeenCalled();
        } finally { wrapper.unmount(); }
    });

    it.each([
        { boundary: 'input', key: 'Escape', keyCode: 27 },
        { boundary: 'input', key: 'Enter', keyCode: 13 },
        { boundary: 'dialog', key: 'Escape', keyCode: 27 },
        { boundary: 'dialog', key: 'Enter', keyCode: 13 },
    ])('ignores Chrome replaying one physical $key at the $boundary boundary', async ({ boundary, key, keyCode }) => {
        controller.results.value = [result({ secondaryActions: [action({ id: 'new-pane', label: 'New pane' })] })];
        const wrapper = mountPalette(boundary === 'dialog' ? RekaModalStub : UModalStub);
        try {
            await nextTick();
            const input = wrapper.get('input[role="combobox"]');
            const keyboard = (type: 'keydown' | 'keyup', init: KeyboardEventInit & { timeStamp: number }) =>
                dispatchKeyboard(input.element, type, init);
            keyboard('keydown', { key: 'Dead', code: 'KeyE', keyCode: 229, timeStamp: 100 });
            await input.trigger('compositionstart');
            keyboard('keydown', { key, code: key, keyCode: 229, isComposing: true, timeStamp: 100.5 });
            await input.trigger('compositionend');
            // Native Chrome sends keyup before replaying the same hardware keydown.
            keyboard('keyup', { key, code: key, keyCode, timeStamp: 100.5 });
            keyboard('keydown', { key, code: key, keyCode, timeStamp: 100.5 });
            keyboard('keyup', { key, code: key, keyCode, timeStamp: 100.6 });
            if (boundary === 'dialog' && key === 'Escape') {
                dispatchKeyboard(wrapper.get('[role="dialog"]').element, 'keydown', { key, code: key, keyCode, timeStamp: 100.5 });
            }
            expect(close).not.toHaveBeenCalled();
            expect(runPrimary).not.toHaveBeenCalled();

            keyboard('keydown', { key: 'ArrowDown', code: 'ArrowDown', timeStamp: 100.5 });
            expect(moveActive).toHaveBeenCalledWith(1);
            keyboard('keydown', { key: 'Enter', code: 'Enter', metaKey: true, timeStamp: 100.7 });
            keyboard('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, timeStamp: 100.8 });
            expect(openActionTray).toHaveBeenCalledTimes(2);

            // A separate physical press works immediately, without a grace period.
            keyboard('keydown', { key, code: key, keyCode, timeStamp: 100.9 });
            expect(key === 'Escape' ? close : runPrimary).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); }
    });

    it('opens the action tray with Tab and Cmd+Enter', async () => {
        controller.results.value = [
            result({
                secondaryActions: [action({ id: 'new-pane', label: 'New pane' })],
            }),
        ];
        const wrapper = mountPalette();
        const input = wrapper.get('input[role="combobox"]');

        await input.trigger('keydown', { key: 'Tab' });
        await nextTick();
        expect(openActionTray).toHaveBeenCalledTimes(1);

        await input.trigger('keydown', { key: 'Enter', metaKey: true });
        await nextTick();
        expect(openActionTray).toHaveBeenCalledTimes(2);
        expect(runPrimary).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('previews on hover and unlocks hover once the pointer moves', async () => {
        const wrapper = mountPalette();
        const option = wrapper.get('[role="option"]');

        await option.trigger('mousemove');
        expect(releaseHoverLock).toHaveBeenCalled();
        expect(hoverActive).toHaveBeenCalledWith('chat:t1');

        await option.trigger('mouseenter');
        expect(hoverActive).toHaveBeenCalledTimes(2);
        expect(runPrimary).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('offers a close control for touch layouts', async () => {
        const wrapper = mountPalette();
        await wrapper.get('[data-test="command-palette-close"]').trigger('click');

        expect(close).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('renders category filter chips and reports selections', async () => {
        const wrapper = mountPalette();
        const chips = wrapper.findAll('.or3-palette-chip');
        expect(chips.map((chip) => chip.text())).toEqual([
            'All',
            'Chats',
            'Commands',
        ]);
        expect(chips[0]?.attributes('aria-pressed')).toBe('true');

        await chips[1]?.trigger('click');
        expect(setCategoryFilter).toHaveBeenCalledWith('chat');
        wrapper.unmount();
    });

    it('shows an empty state when a query returns nothing', () => {
        controller.results.value = [];
        controller.query.value = 'chat: nothing';
        const wrapper = mountPalette();

        expect(wrapper.text()).toContain('No results for “nothing”');
        wrapper.unmount();
    });

    it('renders the preview for the active result', () => {
        const wrapper = mountPalette();
        const preview = wrapper.get('.or3-palette-preview');
        expect(preview.text()).toContain('Discussed astilbe care');
        expect(preview.text()).toContain('Thread one');
        wrapper.unmount();
    });

    it('shows a recoverable error without closing', () => {
        controller.errorMessage.value = 'Pane capacity reached';
        const wrapper = mountPalette();
        expect(wrapper.text()).toContain('Could not complete this action. Please try again.');
        expect(close).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('marks disabled results as unavailable and keeps their reason', () => {
        controller.results.value = [
            result({
                primaryAction: action({
                    disabled: true,
                    disabledReason: 'Pane capacity reached',
                }),
            }),
        ];
        const wrapper = mountPalette();
        const option = wrapper.get('[role="option"]');

        expect(option.attributes('aria-disabled')).toBe('true');
        expect(option.text()).toContain('Unavailable');
        wrapper.unmount();
    });
});
