import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useScrollLock } from '~/composables/core/useScrollLock';
import { ref, nextTick } from 'vue';

describe('useScrollLock', () => {
    let el: HTMLElement;

    beforeEach(() => {
        el = document.createElement('div');
        document.body.appendChild(el);
    });

    afterEach(() => {
        document.body.removeChild(el);
    });

    it('should lock and unlock specific target', async () => {
        const { lock, unlock, isLocked } = useScrollLock({ target: () => el });
        
        expect(isLocked.value).toBe(false);
        expect(el.style.overflow).toBe('');

        lock();
        await nextTick();
        expect(isLocked.value).toBe(true);
        expect(el.style.overflow).toBe('hidden');

        unlock();
        await nextTick();
        expect(isLocked.value).toBe(false);
        expect(el.style.overflow).toBe('');
    });

    it('should default to body', async () => {
        const { lock, unlock } = useScrollLock(); // No target defaults to body
        
        lock();
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');

        unlock();
        await nextTick();
        expect(document.body.style.overflow).toBe('');
    });

    it('should sync with controlled state', async () => {
        const controlled = ref(false);
        const { isLocked } = useScrollLock({ target: () => el, controlledState: controlled });

        expect(isLocked.value).toBe(false);

        controlled.value = true;
        await nextTick();
        expect(isLocked.value).toBe(true);
        expect(el.style.overflow).toBe('hidden');

        controlled.value = false;
        await nextTick();
        expect(isLocked.value).toBe(false);
        expect(el.style.overflow).toBe('');
    });
});
