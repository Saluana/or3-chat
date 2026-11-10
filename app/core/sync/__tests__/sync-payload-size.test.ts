import { describe, expect, it, vi } from 'vitest';
import { isSyncPayloadTooLarge } from '../sync-payload-size';

describe('sync payload byte limit', () => {
    it.each([
        ['', 0, false],
        ['abc', 3, false],
        ['abc', 2, true],
        ['éé', 4, false],
        ['éé', 3, true],
        ['漢', 3, false],
        ['漢', 2, true],
        ['😀', 4, false],
        ['😀', 3, true],
        ['\ud800', 3, false],
        ['\udc00', 2, true],
        [undefined, 0, false],
        [JSON.stringify({ text: '\ud800' }), 17, false],
        [JSON.stringify({ text: '\ud800' }), 16, true],
    ])('checks known UTF-8 sizes for %s at limit %i', (value, limit, expected) => {
        expect(isSyncPayloadTooLarge(value, limit)).toBe(expected);
    });

    it('encodes only when UTF-16 length cannot decide the result', () => {
        const encode = vi.spyOn(TextEncoder.prototype, 'encode');
        try {
            expect(isSyncPayloadTooLarge('abcd', 3)).toBe(true);
            expect(isSyncPayloadTooLarge('abc', 9)).toBe(false);
            expect(encode).not.toHaveBeenCalled();
            expect(isSyncPayloadTooLarge('éé', 3)).toBe(true);
            expect(encode).toHaveBeenCalledTimes(1);
        } finally {
            encode.mockRestore();
        }
    });
});
