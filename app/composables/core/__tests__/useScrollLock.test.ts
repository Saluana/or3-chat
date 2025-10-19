import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick, ref } from 'vue';
import { useScrollLock } from '../useScrollLock';

describe('useScrollLock', () => {
    beforeEach(() => {
        document.body.style.overflow = '';
    });

    it('locks and unlocks scroll manually', () => {
        const { lock, unlock } = useScrollLock();

        lock();
        expect(document.body.style.overflow).toBe('hidden');

        unlock();
        expect(document.body.style.overflow).toBe('');
    });

    it('follows a controlled state ref', async () => {
        const controlled = ref(false);

        useScrollLock({ controlledState: controlled });

        controlled.value = true;
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');

        controlled.value = false;
        await nextTick();
        expect(document.body.style.overflow).toBe('');
    });
});
