import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import VirtualMessageList from '../VirtualMessageList.vue';

function setScrollMetrics(
    el: HTMLElement,
    m: { scrollTop: number; scrollHeight: number; clientHeight: number }
) {
    Object.defineProperty(el, 'scrollTop', {
        value: m.scrollTop,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
        value: m.scrollHeight,
        configurable: true,
    });
    Object.defineProperty(el, 'clientHeight', {
        value: m.clientHeight,
        configurable: true,
    });
}

const Harness = defineComponent({
    components: { VirtualMessageList },
    setup() {
        const scrollEl = ref<HTMLElement | null>(null);
        const isStreaming = ref(true);
        const items = ref<any[]>(
            Array.from({ length: 20 }, (_, i) => ({
                id: 'm' + i,
                content: 'msg' + i,
            }))
        );
        function finalize() {
            isStreaming.value = false;
        }
        function addExpansion() {
            // simulate final markdown expansion adding extra item height (push one extra)
            items.value.push({
                id: 'exp' + items.value.length,
                content: 'expansion',
            });
        }
        return { scrollEl, isStreaming, items, finalize, addExpansion };
    },
    template: `
      <div>
        <div ref="scrollEl" style="height:300px; overflow:auto;"></div>
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

describe('Finalize no jump clamp', () => {
    it('clamps scrollTop delta >4px when finalizing mid-list', async () => {
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

        // Populate metrics: simulate taller content
        setScrollMetrics(el, {
            scrollTop: 400,
            scrollHeight: 1200,
            clientHeight: 300,
        });
        el.dispatchEvent(new Event('scroll'));

        // Disengage by scrolling further up
        setScrollMetrics(el, {
            scrollTop: 350,
            scrollHeight: 1200,
            clientHeight: 300,
        });
        el.dispatchEvent(new Event('scroll'));

        const prevTop = el.scrollTop;
        // Trigger finalize (streaming -> false) first; production code snapshots now.
        (wrapper.vm as any).finalize();
        // Allow component watchers (sync + post) to register before we mutate layout.
        await nextTick();
        // Now simulate a late expansion that pushes scrollTop down by 80 (synthetic jump)
        setScrollMetrics(el, {
            scrollTop: prevTop + 80,
            scrollHeight: 1280,
            clientHeight: 300,
        });
        // Give finalize clamp chances to run (microtasks + multiple macrotasks)
        await nextTick();
        await Promise.resolve();
        vi.runAllTimers();
        await nextTick();
        vi.runAllTimers();
        await Promise.resolve();
        await nextTick();

        // After clamp scrollTop should be restored close to prevTop (delta <=4)
        const delta = Math.abs(el.scrollTop - prevTop);
        expect(delta).toBeLessThanOrEqual(4);
        // Ensure we are still disengaged (stick false) -> metrics not directly accessible here; rely on lack of bottom snap
        expect(el.scrollTop).toBeLessThan(prevTop + 50);
    });
});
