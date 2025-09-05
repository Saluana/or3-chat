import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import { useAutoScroll } from '~/composables/useAutoScroll';

// Simple test harness component simulating a scroll container whose height grows.
const Harness = defineComponent({
    name: 'AutoScrollHarness',
    setup() {
        const scrollEl = ref<HTMLElement | null>(null);
        const items = ref<string[]>(['a', 'b', 'c']);
        const auto = useAutoScroll(scrollEl, {
            thresholdPx: 64,
            disengageDeltaPx: 8,
        });
        function addMany(n: number) {
            for (let i = 0; i < n; i++) items.value.push('x' + i);
            // simulate height growth; jsdom doesn't layout, so manually bump scroll metrics
            // We'll mutate scrollHeight via property override on the element in tests.
            auto.onContentIncrease();
        }
        return { scrollEl, items, addMany, auto };
    },
    template: `
    <div ref="scrollEl" style="height:200px; overflow:auto;">
      <div v-for="(i,idx) in items" :key="idx" style="height:40px;">{{i}}</div>
    </div>`,
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

describe('AutoScroll integration (Chat scroll behavior)', () => {
    it('9.1 does NOT auto-scroll when user scrolled up (R8)', async () => {
        const wrapper = mount(Harness);
        const el = wrapper.vm.scrollEl!;
        // Initial metrics: at bottom
        setScrollMetrics(el, {
            scrollTop: 0,
            scrollHeight: 400,
            clientHeight: 200,
        });
        wrapper.vm.auto.recompute();
        // Simulate user scroll up (away from bottom). scrollTop lower than max triggers release logic.
        setScrollMetrics(el, {
            scrollTop: 50,
            scrollHeight: 400,
            clientHeight: 200,
        });
        wrapper.vm.auto.recompute();
        // Add new content increasing height significantly
        setScrollMetrics(el, {
            scrollTop: 50,
            scrollHeight: 800,
            clientHeight: 200,
        });
        wrapper.vm.addMany(5);
        await nextTick();
        // Should not stick to bottom
        expect(wrapper.vm.auto.atBottom.value).toBe(false);
        expect(el.scrollTop).toBe(50); // no forced jump
    });

    it('9.2 auto-scrolls when at bottom (R8)', async () => {
        const wrapper = mount(Harness);
        const el = wrapper.vm.scrollEl!;
        // Polyfill scrollTo for jsdom
        (el as any).scrollTo = ({ top }: { top: number }) => {
            Object.defineProperty(el, 'scrollTop', {
                value: top,
                configurable: true,
                writable: true,
            });
        };
        // Start at bottom: scrollTop = scrollHeight - clientHeight
        setScrollMetrics(el, {
            scrollTop: 200,
            scrollHeight: 400,
            clientHeight: 200,
        });
        wrapper.vm.auto.recompute();
        // Add content; maintain scrollTop pre-increase to mimic natural DOM growth before snap
        setScrollMetrics(el, {
            scrollTop: 200,
            scrollHeight: 600,
            clientHeight: 200,
        });
        wrapper.vm.addMany(5);
        await nextTick();
        // Auto-scroll should have snapped: scrollTop == scrollHeight - clientHeight
        expect(wrapper.vm.auto.atBottom.value).toBe(true);
        expect(el.scrollTop).toBe(600); // our scrollToBottom sets top to full scrollHeight
    });
});
