import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex, sha256CspHash } from '../digest';

afterEach(() => vi.unstubAllGlobals());

describe.each(['native', 'http'] as const)('SHA-256 in %s contexts', (context) => {
    it('preserves standard digests and byte-view boundaries', async () => {
        if (context === 'http') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
        const bytes = new TextEncoder().encode('!abc!');
        const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        expect(await sha256Hex('abc')).toBe(expected);
        expect(await sha256Hex(bytes.subarray(1, 4))).toBe(expected);
        expect(await sha256CspHash('abc')).toBe('sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    });
});
