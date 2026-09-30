/**
 * Tests for PaneResizeHandle component
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PaneResizeHandle from '../PaneResizeHandle.vue';

describe('PaneResizeHandle', () => {
    it('renders on desktop with multiple panes', () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 0,
                paneCount: 2,
                isDesktop: true,
            },
        });

        expect(wrapper.find('.pane-resize-handle').exists()).toBe(true);
    });

    it('does not render on mobile', () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 0,
                paneCount: 2,
                isDesktop: false,
            },
        });

        expect(wrapper.find('.pane-resize-handle').exists()).toBe(false);
    });

    it('does not render with single pane', () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 0,
                paneCount: 1,
                isDesktop: true,
            },
        });

        expect(wrapper.find('.pane-resize-handle').exists()).toBe(false);
    });

    it('emits resizeStart on pointer down', async () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 0,
                paneCount: 2,
                isDesktop: true,
            },
        });

        const handle = wrapper.find('.pane-resize-handle');
        // Use a plain object instead of PointerEvent constructor (not available in jsdom)
        await handle.trigger('pointerdown', {
            clientX: 100,
            clientY: 200,
        });

        const resizeStartEvents = wrapper.emitted('resizeStart');
        expect(resizeStartEvents).toBeTruthy();
        expect(resizeStartEvents?.[0]?.[1]).toBe(0); // paneIndex
    });

    it('emits resizeKeydown on keyboard event', async () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 1,
                paneCount: 3,
                isDesktop: true,
            },
        });

        const handle = wrapper.find('.pane-resize-handle');
        await handle.trigger('keydown', { key: 'ArrowRight' });

        const resizeKeydownEvents = wrapper.emitted('resizeKeydown');
        expect(resizeKeydownEvents).toBeTruthy();
        expect(resizeKeydownEvents?.[0]?.[1]).toBe(1); // paneIndex
    });

    it('has correct ARIA attributes', () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 2,
                paneCount: 3,
                isDesktop: true,
            },
        });

        const handle = wrapper.find('.pane-resize-handle');
        expect(handle.attributes('role')).toBe('separator');
        expect(handle.attributes('aria-orientation')).toBe('vertical');
        expect(handle.attributes('aria-label')).toBe('Resize pane 3');
        expect(handle.attributes('tabindex')).toBe('0');
    });

    it('has correct cursor style', () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 0,
                paneCount: 2,
                isDesktop: true,
            },
        });

        const handle = wrapper.find('.pane-resize-handle');
        expect(handle.classes()).toContain('cursor-col-resize');
    });

    it('has extended hit area', () => {
        const wrapper = mount(PaneResizeHandle, {
            props: {
                paneIndex: 0,
                paneCount: 2,
                isDesktop: true,
            },
        });

        // Check for the invisible hit area div (now in BaseResizeHandle)
        const hitArea = wrapper.find('.resize-handle-base__hit-area');
        expect(hitArea.exists()).toBe(true);
        expect(hitArea.classes()).toContain('pointer-events-auto');
    });

});
