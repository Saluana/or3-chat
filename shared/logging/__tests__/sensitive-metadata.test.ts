import { describe, expect, it } from 'vitest';
import { sensitiveValueMetadata } from '../sensitive-metadata';

describe('sensitiveValueMetadata', () => {
    it('counts UTF-8 bytes and returns a stable correlation fingerprint without content', () => {
        const value = 'password=秘密🔑';
        const first = sensitiveValueMetadata(value);
        expect(first.utf8Bytes).toBe(new TextEncoder().encode(value).byteLength);
        expect(first.fingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
        expect(JSON.stringify(first)).not.toContain('秘密');
        expect(sensitiveValueMetadata(value)).toEqual(first);
    });
});
