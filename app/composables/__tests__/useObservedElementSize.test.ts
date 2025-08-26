import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useObservedElementSize } from '../useObservedElementSize';

// JSDOM lacks real ResizeObserver layout; this is a smoke test only.

describe.skip('useObservedElementSize (environment limited)', () => {
    it('initializes refs', () => {
        const el = ref<HTMLElement | null>(document.createElement('div'));
        const { width, height } = useObservedElementSize(el);
        expect(width.value).toBeDefined();
        expect(height.value).toBeDefined();
    });
});
