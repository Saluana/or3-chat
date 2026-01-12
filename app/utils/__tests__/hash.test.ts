import { describe, expect, it } from 'vitest';
import { formatHash, isValidHash, parseHash } from '../hash';

describe('hash utilities', () => {
    it('parses sha256 hashes with prefix', () => {
        const hex = 'a'.repeat(64);
        const input = `sha256:${hex}`;
        const parsed = parseHash(input);
        expect(parsed).toEqual({
            algorithm: 'sha256',
            hex,
            full: `sha256:${hex}`,
        });
    });

    it('parses md5 hashes with prefix', () => {
        const hex = 'b'.repeat(32);
        const input = `md5:${hex}`;
        const parsed = parseHash(input);
        expect(parsed).toEqual({
            algorithm: 'md5',
            hex,
            full: `md5:${hex}`,
        });
    });

    it('accepts legacy md5 hex without prefix', () => {
        const hex = 'c'.repeat(32);
        const parsed = parseHash(hex);
        expect(parsed).toEqual({
            algorithm: 'md5',
            hex,
            full: `md5:${hex}`,
        });
    });

    it('formats hashes consistently', () => {
        expect(formatHash('sha256', 'ABC')).toBe('sha256:abc');
        expect(formatHash('md5', 'ABC')).toBe('md5:abc');
    });

    it('validates hash formats', () => {
        expect(isValidHash(`sha256:${'a'.repeat(64)}`)).toBe(true);
        expect(isValidHash(`md5:${'a'.repeat(32)}`)).toBe(true);
        expect(isValidHash('not-a-hash')).toBe(false);
    });
});
