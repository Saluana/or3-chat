import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import VirtualMessageList from '../VirtualMessageList.vue';

function setScrollMetrics(
    el: HTMLElement,
    { scrollTop, scrollHeight, clientHeight }: any
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
    setup() {
        const scrollEl = ref<HTMLElement | null>(null);
        const items = ref<any[]>(
            Array.from({ length: 5 }, (_, i) => ({
                id: 'i' + i,
                content: 'msg ' + i,
            }))
        );
        const isStreaming = ref(true);
        function appendToken() {
            // simulate token appended to last message by pushing a new message (simplified)
            items.value.push({ id: 'i' + items.value.length, content: 'tok' });
        }
        return { scrollEl, items, isStreaming, appendToken };
    },
    template: `
      <div>
        <div ref="scrollEl" style="height:200px; overflow:auto;"></div>
        <VirtualMessageList
          :messages="items"
          :scroll-parent="scrollEl"
          :is-streaming="isStreaming"
          :item-size-estimation="40"
          :auto-scroll-threshold="100"
          v-slot="{ item }"
        >
          <div style="height:40px">{{ item.content }}</div>
        </VirtualMessageList>
      </div>
    `,
});

// rAF immediate
beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb: any) => {
        cb(0);
        return 1 as any;
    });
    vi.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    (global.requestAnimationFrame as any).mockRestore?.();
    (global.cancelAnimationFrame as any).mockRestore?.();
});

describe('Streaming suction prevention', () => {
    it('does not auto-scroll after disengage while streaming tokens continue', async () => {
        const wrapper = mount(Harness);
        await nextTick();
        // resolve el
        let el: HTMLElement | null = (wrapper.vm as any).scrollEl;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = (wrapper.vm as any).scrollEl;
        }
        expect(el).toBeTruthy();
        el = el!;
        (el as any).scrollTo = ({ top }: { top: number }) => {
            const maxTop = el.scrollHeight - el.clientHeight;
            const clampedTop = Math.max(0, Math.min(top, maxTop));
            Object.defineProperty(el, 'scrollTop', {
                value: clampedTop,
                configurable: true,
                writable: true,
            });
        };

        // Start at bottom
        setScrollMetrics(el, {
            scrollTop: 200,
            scrollHeight: 400,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll'));

        // User scrolls up to disengage
        setScrollMetrics(el, {
            scrollTop: 40,
            scrollHeight: 400,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll'));

        // Append many streaming tokens while streaming stays true
        const vml = wrapper.findComponent(VirtualMessageList);
        expect(vml.exists()).toBe(true);
        const api: any = vml.vm;
        const beforeMetrics = api._devMetrics ? api._devMetrics() : null;
        for (let i = 0; i < 10; i++) {
            (wrapper.vm as any).appendToken();
            await nextTick();
        }
        const afterMetrics = api._devMetrics ? api._devMetrics() : null;
        if (beforeMetrics && afterMetrics) {
            expect(afterMetrics.scrollCallsCount).toBe(
                beforeMetrics.scrollCallsCount
            );
            expect(afterMetrics.preventedAutoScroll).toBeGreaterThan(
                beforeMetrics.preventedAutoScroll
            );
        }
        // Scroll position unchanged (still user position ~40)
        expect(el.scrollTop).toBe(40);
    });
});
