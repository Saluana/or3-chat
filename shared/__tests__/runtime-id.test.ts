import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeUuid } from '../runtime-id';

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createRuntimeUuid', () => {
    const originalCrypto = globalThis.crypto;

    afterEach(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: originalCrypto,
        });
        vi.restoreAllMocks();
    });

    it('uses randomUUID when the runtime exposes it', () => {
        const expected = '11111111-1111-4111-8111-111111111111';
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: { randomUUID: () => expected },
        });

        expect(createRuntimeUuid()).toBe(expected);
    });

    it('uses random bytes when randomUUID is unavailable', () => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                getRandomValues: (bytes: Uint8Array) => {
                    bytes.fill(0xab);
                    return bytes;
                },
            },
        });

        const id = createRuntimeUuid();
        expect(id).toMatch(UUID_PATTERN);
        expect(id).toBe('abababab-abab-4bab-abab-abababababab');
    });

    it('preserves UUID shape when Web Crypto is unavailable', () => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: undefined,
        });
        vi.spyOn(Math, 'random').mockReturnValue(0);

        expect(createRuntimeUuid()).toBe(
            '00000000-0000-4000-8000-000000000000'
        );
    });
});
