import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewCache } from '../usePreviewCache';

const originalUrl = globalThis.URL;
let revokeObjectUrl: ReturnType<typeof vi.fn>;

describe('usePreviewCache', () => {
    beforeEach(() => {
        revokeObjectUrl = vi.fn();
        (globalThis as any).URL = {
            createObjectURL: vi.fn(),
            revokeObjectURL: revokeObjectUrl,
        };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        (globalThis as any).URL = originalUrl;
    });

    it('does not mutate cache state when its loader fails', async () => {
        const cache = usePreviewCache({ maxUrls: 10, maxBytes: 1000 });

        await expect(
            cache.ensure('broken', async () => {
                throw new Error('Loader failed');
            })
        ).rejects.toThrow('Loader failed');
        expect(cache.metrics()).toMatchObject({
            urls: 0,
            bytes: 0,
            hits: 0,
            misses: 0,
        });
    });

    it.each([
        ['a string', 'invalid result', 'not an object'],
        ['null', 'invalid result', null],
        ['no URL', 'invalid url', { bytes: 10 }],
        ['an empty URL', 'invalid url', { url: '', bytes: 10 }],
        ['a non-string URL', 'invalid url', { url: 123, bytes: 10 }],
    ])('rejects %s from the loader', async (_label, message, result) => {
        const cache = usePreviewCache({ maxUrls: 10, maxBytes: 1000 });

        await expect(
            cache.ensure('invalid', async () => result)
        ).rejects.toThrow(message);
        expect(cache.metrics().urls).toBe(0);
    });

    it('caches valid results and records hit and miss metrics', async () => {
        const cache = usePreviewCache({ maxUrls: 10, maxBytes: 1000 });
        const loader = vi.fn(async () => ({ url: 'blob:a', bytes: 4 }));

        await expect(cache.ensure('a', loader)).resolves.toBe('blob:a');
        await expect(cache.ensure('a', loader)).resolves.toBe('blob:a');

        expect(loader).toHaveBeenCalledTimes(1);
        expect(cache.metrics()).toMatchObject({
            urls: 1,
            bytes: 4,
            hits: 1,
            misses: 1,
        });
    });

    it('treats omitted byte counts as zero', async () => {
        const cache = usePreviewCache({ maxUrls: 10, maxBytes: 1000 });

        await cache.ensure('a', async () => ({ url: 'blob:a' }));

        expect(cache.metrics()).toMatchObject({ urls: 1, bytes: 0 });
    });

    it('evicts the least recently used unpinned entry', async () => {
        const cache = usePreviewCache({ maxUrls: 2, maxBytes: 1000 });
        await cache.ensure('a', async () => ({ url: 'blob:a', bytes: 1 }));
        await cache.ensure('b', async () => ({ url: 'blob:b', bytes: 1 }));
        cache.promote('a', 1);

        await cache.ensure('c', async () => ({ url: 'blob:c', bytes: 1 }));

        expect(cache.peek('a')).toBe('blob:a');
        expect(cache.peek('b')).toBeUndefined();
        expect(cache.peek('c')).toBe('blob:c');
        expect(cache.metrics().evictions).toBe(1);
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:b');
    });

    it('allows a released pin to be evicted', async () => {
        const cache = usePreviewCache({ maxUrls: 1, maxBytes: 1000 });
        await cache.ensure(
            'pinned',
            async () => ({ url: 'blob:pinned', bytes: 1 }),
            1
        );
        cache.release('pinned');

        await cache.ensure('replacement', async () => ({
            url: 'blob:replacement',
            bytes: 1,
        }));

        expect(cache.peek('pinned')).toBeUndefined();
        expect(cache.peek('replacement')).toBe('blob:replacement');
    });

    it('drops one entry or flushes all entries and revokes their URLs', async () => {
        const cache = usePreviewCache({ maxUrls: 5, maxBytes: 1000 });
        await cache.ensure('a', async () => ({ url: 'blob:a', bytes: 1 }));
        await cache.ensure('b', async () => ({ url: 'blob:b', bytes: 2 }));

        expect(cache.drop('a')).toBe(true);
        expect(cache.drop('missing')).toBe(false);
        expect(cache.flushAll()).toEqual(['b']);
        expect(cache.metrics()).toMatchObject({ urls: 0, bytes: 0 });
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:a');
        expect(revokeObjectUrl).toHaveBeenCalledWith('blob:b');
    });
});
