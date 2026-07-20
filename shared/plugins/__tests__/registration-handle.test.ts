import { describe, expect, it, vi } from 'vitest';
import { createRegistrationHandle } from '../registration-handle';

describe('createRegistrationHandle', () => {
    it('disposes exactly once while current', () => {
        const remove = vi.fn();
        const owner = Symbol('owner');
        const handle = createRegistrationHandle({
            id: 'x',
            owner,
            isCurrent: () => true,
            remove,
        });

        expect(handle.dispose()).toBe(true);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(handle.disposed).toBe(true);
        expect(handle.dispose()).toBe(false);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('marks disposed without remove when ownership was replaced', () => {
        const remove = vi.fn();
        const handle = createRegistrationHandle({
            id: 'x',
            owner: Symbol('stale'),
            isCurrent: () => false,
            remove,
        });

        expect(handle.dispose()).toBe(false);
        expect(remove).not.toHaveBeenCalled();
        expect(handle.disposed).toBe(true);
    });
});
