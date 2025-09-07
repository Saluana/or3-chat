import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import VirtualMessageList from '../VirtualMessageList.vue';

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
    name: 'RestickHarness',
    components: { VirtualMessageList },
    emits: ['scroll-state'],
    setup(_, { emit }) {
        const scrollEl = ref<HTMLElement | null>(null);
        const items = ref<any[]>(
            Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i }))
        );
        function onScrollState(e: any) {
            emit('scroll-state', e);
        }
        return { scrollEl, items, onScrollState };
    },
    template: `
    <div>
      <div ref="scrollEl" style="height:200px; overflow:auto;"></div>
      <VirtualMessageList
        :messages="items"
        :scroll-parent="scrollEl"
        :item-size-estimation="40"
        :auto-scroll-threshold="100"
        @scroll-state="onScrollState"
        v-slot="{ item }"
      >
        <div style="height:40px">{{ item.id }}</div>
      </VirtualMessageList>
    </div>
  `,
});

let originalRAF: any;
let originalCancel: any;

describe('Delayed Re-Stick Heuristic', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        originalRAF = globalThis.requestAnimationFrame;
        originalCancel = globalThis.cancelAnimationFrame;
        // rAF -> 16ms timer so linger polling advances with fake timers
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
            return setTimeout(() => cb(Date.now()), 16) as any;
        };
        globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCancel;
    });

    it('immediate restick (delay logic removed)', async () => {
        const wrapper = mount(Harness);

        // Resolve scroll element reference (DOM mount)
        await nextTick();
        let el: HTMLElement | null = (wrapper.vm as any).scrollEl;
        for (let i = 0; i < 5 && !el; i++) {
            await nextTick();
            el = (wrapper.vm as any).scrollEl;
        }
        expect(el).toBeTruthy();
        el = el as HTMLElement;

        // Provide scrollTo polyfill
        (el as any).scrollTo = ({ top }: { top: number }) => {
            const maxTop = el!.scrollHeight - el!.clientHeight;
            const clampedTop = Math.max(0, Math.min(top, maxTop));
            Object.defineProperty(el!, 'scrollTop', {
                value: clampedTop,
                configurable: true,
                writable: true,
            });
        };

        const getEvents = () =>
            (wrapper.emitted()['scroll-state'] || []).map(
                (args: any) => args[0]
            );

        // Initial metrics: simulate at bottom
        setScrollMetrics(el, {
            scrollTop: 600,
            scrollHeight: 800,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll'));

        // User scrolls up (disengage)
        setScrollMetrics(el, {
            scrollTop: 500,
            scrollHeight: 800,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll'));

        // Enter bottom threshold zone (within 100px) but not full bottom; distance = 600 - 505 = 95
        setScrollMetrics(el, {
            scrollTop: 505,
            scrollHeight: 800,
            clientHeight: 200,
        });
        el.dispatchEvent(new Event('scroll'));

        // Advance a short duration; since delay removed, should already be stuck
        vi.advanceTimersByTime(50);
        await nextTick();
        const eventsAfter = getEvents();
        const last = eventsAfter[eventsAfter.length - 1];
        expect(last.stick).toBe(true);
    });
});
