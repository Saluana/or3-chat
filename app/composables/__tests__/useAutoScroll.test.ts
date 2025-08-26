import { describe, it, expect } from 'vitest';
import { ref, defineComponent, h } from 'vue';
import { useAutoScroll } from '../useAutoScroll';

function mockContainer(): HTMLElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, writable: true });
    el.scrollTop = 500; // bottom
    el.scrollTo = ({ top }: any) => {
        el.scrollTop = top;
    };
    return el;
}

describe('useAutoScroll', () => {
    it('detects bottom then un-sticks when scrolled up', () => {
        let api: ReturnType<typeof useAutoScroll> | null = null;
        const c = ref<HTMLElement | null>(mockContainer());
        defineComponent({
            setup() {
                api = useAutoScroll(c, { thresholdPx: 10, throttleMs: 0 });
                return () => h('div');
            },
        });
        // initial compute
        api = useAutoScroll(c, { thresholdPx: 10, throttleMs: 0 });
        api.onContentIncrease();
        expect(api.atBottom.value).toBe(true);
        if (c.value) {
            c.value.scrollTop = 200; // distance 300 > threshold 10
            api.recompute();
        }
        expect(api.atBottom.value).toBe(false); // should have un-stuck now
        api.stickBottom();
        expect(api.atBottom.value).toBe(true);
    });
});
