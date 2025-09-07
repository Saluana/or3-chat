import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import VirtualMessageList from '../VirtualMessageList.vue';

// Polyfill rAF to run immediately in tests (for useRafFn)
const originalRAF = globalThis.requestAnimationFrame as any;
const originalCancelRAF = globalThis.cancelAnimationFrame as any;

beforeAll(() => {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0 as any);
        return 1 as any;
    }) as any;
    globalThis.cancelAnimationFrame = (() => {}) as any;
});

afterAll(() => {
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCancelRAF;
});

// Utility to fake scroll metrics on the container element (jsdom has no real layout)
function setScrollMetrics(
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
    name: 'VMLHarness',
    components: { VirtualMessageList },
    setup() {
        const scrollEl = ref<HTMLElement | null>(null);
        const items = ref<any[]>([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
        return { scrollEl, items };
    },
    template: `
    <div>
      <div ref="scrollEl" style="height:200px; overflow:auto;"></div>
      <VirtualMessageList
        :messages="items"
        :scroll-parent="scrollEl"
        :item-size-estimation="120"
        :overscan="2"
        v-slot="{ item }"
      >
        <div>{{ item.id }}</div>
      </VirtualMessageList>
    </div>
  `,
});

describe('AutoScroll behavior centralized in VirtualMessageList', () => {
    it('does NOT auto-scroll when user scrolled up (manual disengage)', async () => {
        const wrapper = mount(Harness);
        await nextTick();
        const resolveEl = () => {
            const raw: any = (wrapper.vm as any).scrollEl;
            if (raw && raw.nodeType === 1) return raw as HTMLElement; // already unwrapped element
            if (raw && raw.value && raw.value.nodeType === 1)
                return raw.value as HTMLElement; // underlying ref value
            return null;
        };
        let el = resolveEl();
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = resolveEl();
        }
        expect(el).toBeTruthy();
        el = el as HTMLElement;

        // Polyfill scrollTo for jsdom (clamp to max scrollable position)
        (el as any).scrollTo = ({ top }: { top: number }) => {
            const maxTop = el.scrollHeight - el.clientHeight;
            const clampedTop = Math.max(0, Math.min(top, maxTop));
            Object.defineProperty(el, 'scrollTop', {
                value: clampedTop,
                configurable: true,
                writable: true,
            });
        };

        // Get the VML instance (first component of that type)
        const vml = wrapper.findComponent(VirtualMessageList);
        expect(vml.exists()).toBe(true);

        // Initial metrics: at bottom
        setScrollMetrics(el, {
            scrollTop: 200,
            scrollHeight: 400,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll')); // establish baseline

        // Simulate user scroll up (away from bottom)
        setScrollMetrics(el, {
            scrollTop: 50,
            scrollHeight: 400,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll'));

        // Height growth due to new items being appended
        setScrollMetrics(el, {
            scrollTop: 50,
            scrollHeight: 800,
            clientHeight: 200,
        });

        // Trigger content increase handler exposed by VML
        (vml.vm as any).onContentIncrease();
        await nextTick();

        // Should not stick to bottom; position unchanged
        expect(el.scrollTop).toBe(50);
    });

    it('auto-scrolls when at bottom', async () => {
        const wrapper = mount(Harness);
        await nextTick();
        const resolveEl = () => {
            const raw: any = (wrapper.vm as any).scrollEl;
            if (raw && raw.nodeType === 1) return raw as HTMLElement;
            if (raw && raw.value && raw.value.nodeType === 1)
                return raw.value as HTMLElement;
            return null;
        };
        let el = resolveEl();
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = resolveEl();
        }
        expect(el).toBeTruthy();
        el = el as HTMLElement;

        // Polyfill scrollTo for jsdom (clamp to max scrollable position)
        (el as any).scrollTo = ({ top }: { top: number }) => {
            const maxTop = el.scrollHeight - el.clientHeight;
            const clampedTop = Math.max(0, Math.min(top, maxTop));
            Object.defineProperty(el, 'scrollTop', {
                value: clampedTop,
                configurable: true,
                writable: true,
            });
        };

        const vml = wrapper.findComponent(VirtualMessageList);
        expect(vml.exists()).toBe(true);

        // Start at bottom: scrollTop = scrollHeight - clientHeight
        setScrollMetrics(el, {
            scrollTop: 200,
            scrollHeight: 400,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll')); // baseline

        // Increase height (new content); keep scrollTop until snap
        setScrollMetrics(el, {
            scrollTop: 200,
            scrollHeight: 600,
            clientHeight: 200,
        });

        // Call onContentIncrease immediately after metric change to simulate resize before internal compute
        (vml.vm as any).onContentIncrease();
        await nextTick();

        // Auto-scroll should have snapped: scrollTop == scrollHeight - clientHeight
        expect(el.scrollTop).toBe(400);
    });
});
