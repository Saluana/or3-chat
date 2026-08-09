import { describe, expect, it } from 'vitest';
import { normalizeStorageHash } from '../normalize-hash';

describe('normalizeStorageHash', () => {
    it('normalizes the SHA-256 form used by upload quota checks', () => {
        expect(normalizeStorageHash('sha256: AbC ', ['sha256'])).toBe('abc');
    });

    it('does not strip an algorithm the caller has not allowed', () => {
        expect(normalizeStorageHash('md5:AbC', ['sha256'])).toBe('md5:abc');
    });

    it('normalizes legacy SHA-256 and MD5 quota records', () => {
        expect(normalizeStorageHash('MD5:AbC', ['sha256', 'md5'])).toBe('abc');
        expect(normalizeStorageHash('SHA256:MD5:AbC', ['sha256', 'md5'])).toBe('abc');
    });
});
