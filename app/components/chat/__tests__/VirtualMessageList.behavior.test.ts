import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import VirtualMessageList from '../VirtualMessageList.vue';

// rAF immediate polyfill
const origRAF = globalThis.requestAnimationFrame as any;
const origCRAF = globalThis.cancelAnimationFrame as any;
beforeAll(() => {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0 as any);
        return 1 as any;
    }) as any;
    globalThis.cancelAnimationFrame = ((/* id */) => {}) as any;
});
afterAll(() => {
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCRAF;
});

function setScroll(
    el: HTMLElement,
    {
        scrollTop,
        scrollHeight,
        clientHeight,
    }: { scrollTop: number; scrollHeight: number; clientHeight: number }
) {
    Object.defineProperty(el, 'scrollTop', {
        value: scrollTop,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
        value: scrollHeight,
        configurable: true,
    });
    Object.defineProperty(el, 'clientHeight', {
        value: clientHeight,
        configurable: true,
    });
}

const Harness = defineComponent({
    components: { VirtualMessageList },
    props: {
        streaming: { type: Boolean, default: false },
        editing: { type: Boolean, default: false },
        threshold: { type: Number, default: 100 },
    },
    setup(props) {
        const scrollEl = ref<HTMLElement | null>(null);
        const items = ref<any[]>(
            Array.from({ length: 5 }, (_, i) => ({ id: 'm' + i }))
        );
        function push(n = 1) {
            for (let i = 0; i < n; i++)
                items.value.push({ id: 'm' + items.value.length });
        }
        return { scrollEl, items, push, props };
    },
    template: `<div><div ref=\"scrollEl\" style=\"height:300px;overflow:auto;\"></div>
    <VirtualMessageList :messages="items" :scroll-parent="scrollEl" :is-streaming="props.streaming" :editing-active="props.editing" :auto-scroll-threshold="props.threshold" />
  </div>`,
});

describe('VirtualMessageList advanced behaviors', () => {
    it('streaming: maintains bottom when at bottom and streaming toggles', async () => {
        const wrapper = mount(Harness, { props: { streaming: true } });
        await nextTick();
        const elRef: any = (wrapper.vm as any).scrollEl;
        let el: HTMLElement | null = elRef?.value || elRef;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = elRef?.value || elRef;
        }
        expect(el).toBeTruthy();
        el = el!;
        (el as any).scrollTo = ({ top }: { top: number }) => {
            Object.defineProperty(el!, 'scrollTop', {
                value: top,
                configurable: true,
                writable: true,
            });
        };
        setScroll(el, { scrollTop: 200, scrollHeight: 500, clientHeight: 300 }); // at bottom (500-300)
        el.dispatchEvent(new Event('scroll'));

        // Simulate streaming height growth without user scroll away
        setScroll(el, { scrollTop: 200, scrollHeight: 540, clientHeight: 300 });
        (
            wrapper.findComponent(VirtualMessageList).vm as any
        ).onContentIncrease();
        await nextTick();
        // Should snap to new bottom (540-300=240)
        expect(el.scrollTop).toBe(240);
    });

    it('editingActive suppresses auto-scroll on new messages', async () => {
        const wrapper = mount(Harness, { props: { editing: true } });
        await nextTick();
        const elRef: any = (wrapper.vm as any).scrollEl;
        let el: HTMLElement | null = elRef?.value || elRef;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = elRef?.value || elRef;
        }
        expect(el).toBeTruthy();
        el = el!;
        (el as any).scrollTo = ({ top }: { top: number }) => {
            Object.defineProperty(el!, 'scrollTop', {
                value: top,
                configurable: true,
                writable: true,
            });
        };
        // Start at bottom
        setScroll(el, { scrollTop: 200, scrollHeight: 500, clientHeight: 300 });
        el.dispatchEvent(new Event('scroll'));
        const prevTop = el.scrollTop;
        // Append messages (should not smooth scroll while editing)
        (wrapper.vm as any).push(2);
        await nextTick();
        await nextTick();
        expect(el.scrollTop).toBe(prevTop); // unchanged
    });

    it('re-engages auto-scroll after user scrolls back to bottom', async () => {
        const wrapper = mount(Harness, {});
        await nextTick();
        const elRef: any = (wrapper.vm as any).scrollEl;
        let el: HTMLElement | null = elRef?.value || elRef;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = elRef?.value || elRef;
        }
        expect(el).toBeTruthy();
        el = el!;
        (el as any).scrollTo = ({ top }: { top: number }) => {
            Object.defineProperty(el!, 'scrollTop', {
                value: top,
                configurable: true,
                writable: true,
            });
        };

        // At bottom initially
        setScroll(el, { scrollTop: 200, scrollHeight: 500, clientHeight: 300 });
        el.dispatchEvent(new Event('scroll'));
        // User scrolls up disengaging
        setScroll(el, { scrollTop: 50, scrollHeight: 500, clientHeight: 300 });
        el.dispatchEvent(new Event('scroll'));
        // User returns to bottom
        setScroll(el, { scrollTop: 200, scrollHeight: 500, clientHeight: 300 });
        el.dispatchEvent(new Event('scroll'));
        // Append new message should auto-scroll smoothly to new bottom
        (wrapper.vm as any).push(1);
        setScroll(el, { scrollTop: 200, scrollHeight: 540, clientHeight: 300 }); // simulate growth
        await nextTick();
        await nextTick();
        expect(el.scrollTop).toBe(240);
    });

    it('threshold influences near-bottom behavior', async () => {
        const wrapper = mount(Harness, { props: { threshold: 20 } });
        await nextTick();
        const elRef: any = (wrapper.vm as any).scrollEl;
        let el: HTMLElement | null = elRef?.value || elRef;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = elRef?.value || elRef;
        }
        expect(el).toBeTruthy();
        el = el!;
        (el as any).scrollTo = ({ top }: { top: number }) => {
            Object.defineProperty(el!, 'scrollTop', {
                value: top,
                configurable: true,
                writable: true,
            });
        };

        // Place user just outside small threshold
        setScroll(el, { scrollTop: 150, scrollHeight: 500, clientHeight: 300 }); // dist = 50 > 20
        el.dispatchEvent(new Event('scroll'));
        (wrapper.vm as any).push(1);
        setScroll(el, { scrollTop: 150, scrollHeight: 530, clientHeight: 300 });
        await nextTick();
        // Should NOT auto scroll because not within threshold
        expect(el.scrollTop).toBe(150);
    });

    it('dynamic item size adjusts average on large batch', async () => {
        const wrapper = mount(Harness, {});
        await nextTick();
        const vml = wrapper.findComponent(VirtualMessageList);
        const initialSize = (vml.vm as any).effectiveItemSize;
        const elRef: any = (wrapper.vm as any).scrollEl;
        let el: HTMLElement | null = elRef?.value || elRef;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = elRef?.value || elRef;
        }
        expect(el).toBeTruthy();
        el = el!;
        setScroll(el, { scrollTop: 200, scrollHeight: 500, clientHeight: 300 });
        el.dispatchEvent(new Event('scroll'));
        // Simulate big growth with many messages
        (wrapper.vm as any).push(30); // large batch
        // capture pre-growth height already set; now emulate DOM growth
        setScroll(el, {
            scrollTop: 200,
            scrollHeight: 4000,
            clientHeight: 300,
        });
        (vml.vm as any).onContentIncrease();
        await nextTick();
        await nextTick();
        const newSize = (vml.vm as any).effectiveItemSize;
        expect(newSize).toBeGreaterThan(initialSize - 1);
    });
});
