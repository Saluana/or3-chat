import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';

const open = vi.fn();
const close = vi.fn();
const isOpen = ref(false);
const schedulePrewarm = vi.fn();
const warm = vi.fn(async () => {});

vi.mock('../useCommandPalette', () => ({
    useCommandPalette: () => ({
        open,
        close,
        isOpen,
        warm,
    }),
}));

vi.mock('~/core/search/command-palette/prewarm', () => ({
    scheduleCommandPalettePrewarm: (...args: unknown[]) =>
        schedulePrewarm(...args),
}));

const { useCommandPaletteShortcut } = await import(
    '../useCommandPaletteShortcut'
);

const Host = defineComponent({
    setup() {
        useCommandPaletteShortcut();
        return () => null;
    },
});

function press(init: KeyboardEventInit & { key: string }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
}

describe('useCommandPaletteShortcut', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isOpen.value = false;
    });

    it('opens the palette and prevents the browser default', () => {
        const wrapper = mount(Host);
        const event = press({ key: 'k', metaKey: true });

        expect(open).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
        wrapper.unmount();
    });

    it('supports Ctrl+K and uppercase K', () => {
        const wrapper = mount(Host);
        press({ key: 'K', ctrlKey: true });
        expect(open).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('ignores composing events and events already handled', () => {
        const wrapper = mount(Host);
        press({ key: 'k', metaKey: true, isComposing: true });

        const claimed = new KeyboardEvent('keydown', {
            key: 'k',
            metaKey: true,
            cancelable: true,
        });
        claimed.preventDefault();
        window.dispatchEvent(claimed);

        expect(open).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('ignores plain k and modifier combinations that are not the shortcut', () => {
        const wrapper = mount(Host);
        press({ key: 'k' });
        press({ key: 'k', metaKey: true, shiftKey: true });
        press({ key: 'j', metaKey: true });
        expect(open).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('closes on Escape only while open', () => {
        const wrapper = mount(Host);
        press({ key: 'Escape' });
        expect(close).not.toHaveBeenCalled();

        isOpen.value = true;
        press({ key: 'Escape' });
        expect(close).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('schedules the idle code preload once mounted', () => {
        const wrapper = mount(Host);
        expect(schedulePrewarm).toHaveBeenCalledTimes(1);
        expect(schedulePrewarm).toHaveBeenCalledWith();
        expect(warm).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('removes listeners on unmount', () => {
        const wrapper = mount(Host);
        wrapper.unmount();
        press({ key: 'k', metaKey: true });
        expect(open).not.toHaveBeenCalled();
    });
});
