import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFileHash, computeHashHex, formatHash, isValidHash, parseHash } from '../hash';

const sparkState = vi.hoisted(() => ({
    appendCalls: 0,
}));

vi.mock('spark-md5', () => ({
    default: {
        ArrayBuffer: class {
            append() {
                sparkState.appendCalls += 1;
                return this;
            }
            end() {
                return '5d41402abc4b2a76b9719d911017c592';
            }
        },
    },
}));

function makeBlobLike(input: string | Uint8Array): Blob {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    return {
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        slice: (start?: number, end?: number) => {
            const s = start ?? 0;
            const e = end ?? bytes.length;
            return makeBlobLike(bytes.slice(s, e));
        },
    } as unknown as Blob;
}

describe('hash utilities', () => {
    afterEach(() => {
        sparkState.appendCalls = 0;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

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

    it('parses md5 hashes with prefix and legacy md5 hex', () => {
        const prefixed = parseHash(`md5:${'b'.repeat(32)}`);
        const legacy = parseHash('c'.repeat(32));
        expect(prefixed?.algorithm).toBe('md5');
        expect(legacy?.algorithm).toBe('md5');
    });

    it('formats and validates hash strings', () => {
        expect(formatHash('sha256', 'ABC')).toBe('sha256:abc');
        expect(formatHash('md5', 'ABC')).toBe('md5:abc');
        expect(isValidHash(`sha256:${'a'.repeat(64)}`)).toBe(true);
        expect(isValidHash(`md5:${'a'.repeat(32)}`)).toBe(true);
        expect(isValidHash('not-a-hash')).toBe(false);
    });

    it('computes SHA-256 via WebCrypto path', async () => {
        const blob = makeBlobLike('hello');
        const hex = await computeHashHex(blob, 'sha256');

        expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('falls back to spark-md5 when subtle is unavailable', async () => {
        vi.stubGlobal('crypto', {} as Crypto);
        const blob = makeBlobLike('hello');

        const hex = await computeHashHex(blob, 'md5');

        expect(hex).toBe('5d41402abc4b2a76b9719d911017c592');
        expect(sparkState.appendCalls).toBeGreaterThan(0);
    });

    it('throws for SHA-256 when WebCrypto is unavailable', async () => {
        vi.stubGlobal('crypto', {} as Crypto);

        await expect(computeHashHex(makeBlobLike('x'), 'sha256')).rejects.toThrow(
            'WebCrypto unavailable for SHA-256 hashing'
        );
    });

    it('computeFileHash prefixes result as sha256:<hex>', async () => {
        const hash = await computeFileHash(makeBlobLike('hello'));
        expect(hash.startsWith('sha256:')).toBe(true);
        expect(hash.length).toBe(71);
    });

    it('streams large md5 blobs in chunks and yields between iterations', async () => {
        vi.stubGlobal('crypto', {} as Crypto);
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        const large = makeBlobLike(new Uint8Array(600_000));
        await computeHashHex(large, 'md5');

        expect(sparkState.appendCalls).toBeGreaterThan(2);
        expect(timeoutSpy).toHaveBeenCalled();
    });
});
