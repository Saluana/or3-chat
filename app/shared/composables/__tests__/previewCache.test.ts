import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePreviewCache } from '../usePreviewCache';

const nativeURL = globalThis.URL;

let revokeMock: ReturnType<typeof vi.fn>;
let createMock: ReturnType<typeof vi.fn>;

describe('usePreviewCache', () => {
    beforeEach(() => {
        revokeMock = vi.fn();
        createMock = vi.fn((value: unknown) => `mock:${String(value)}`);
        (globalThis as any).URL = {
            createObjectURL: createMock,
            revokeObjectURL: revokeMock,
        };
        vi.spyOn(console, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (nativeURL) {
            (globalThis as any).URL = nativeURL;
        } else {
            delete (globalThis as any).URL;
        }
    });

    it('caches loader results and tracks hits vs misses', async () => {
        const cache = usePreviewCache({
            maxUrls: 10,
            maxBytes: Number.POSITIVE_INFINITY,
        });

        const loader = vi.fn(async () => ({ url: 'blob:a', bytes: 4 }));

        const first = await cache.ensure('a', loader);
        expect(first).toBe('blob:a');
        expect(loader).toHaveBeenCalledTimes(1);

        const second = await cache.ensure('a', loader);
        expect(second).toBe('blob:a');
        expect(loader).toHaveBeenCalledTimes(1);

        expect(cache.metrics()).toMatchObject({
            urls: 1,
            bytes: 4,
            hits: 1,
            misses: 1,
        });
    });

    it('evicts least recently used entries when exceeding maxUrls', async () => {
        const cache = usePreviewCache({
            maxUrls: 2,
            maxBytes: Number.POSITIVE_INFINITY,
        });

        await cache.ensure('a', async () => ({ url: 'blob:a', bytes: 1 }));
        await cache.ensure('b', async () => ({ url: 'blob:b', bytes: 1 }));

        expect(cache.metrics().urls).toBe(2);

        await cache.ensure('c', async () => ({ url: 'blob:c', bytes: 1 }));

        expect(cache.peek('a')).toBeUndefined();
        expect(cache.metrics().urls).toBe(2);
        expect(cache.metrics().evictions).toBe(1);
        expect(revokeMock).toHaveBeenCalledWith('blob:a');
    });

    it('promote raises pin priority and avoids eviction', async () => {
        const cache = usePreviewCache({
            maxUrls: 2,
            maxBytes: Number.POSITIVE_INFINITY,
        });

        await cache.ensure('a', async () => ({ url: 'blob:a', bytes: 1 }));
        await cache.ensure('b', async () => ({ url: 'blob:b', bytes: 1 }));

        cache.promote('a', 2);

        await cache.ensure('c', async () => ({ url: 'blob:c', bytes: 1 }));

        expect(cache.peek('a')).toBe('blob:a');
        expect(cache.peek('b')).toBeUndefined();
        expect(cache.metrics().evictions).toBeGreaterThanOrEqual(1);
    });

    it('release lowers pin so a later eviction can remove it', async () => {
        const cache = usePreviewCache({
            maxUrls: 1,
            maxBytes: Number.POSITIVE_INFINITY,
        });

        await cache.ensure(
            'pinned',
            async () => ({
                url: 'blob:p',
                bytes: 2,
            }),
            1
        );

        expect(cache.peek('pinned')).toBe('blob:p');

        await cache.ensure('temp', async () => ({ url: 'blob:t', bytes: 2 }));
        expect(cache.peek('pinned')).toBe('blob:p');
        expect(cache.peek('temp')).toBeUndefined();

        cache.release('pinned');

        const replacement = await cache.ensure('replacement', async () => ({
            url: 'blob:r',
            bytes: 2,
        }));

        expect(replacement).toBe('blob:r');
        expect(cache.peek('pinned')).toBeUndefined();
        expect(cache.peek('replacement')).toBe('blob:r');
    });

    it('drop revokes object URLs and clears the entry', async () => {
        const cache = usePreviewCache({
            maxUrls: 5,
            maxBytes: Number.POSITIVE_INFINITY,
        });

        await cache.ensure('drop-me', async () => ({
            url: 'blob:drop',
            bytes: 3,
        }));

        const result = cache.drop('drop-me');
        expect(result).toBe(true);
        expect(revokeMock).toHaveBeenCalledWith('blob:drop');
        expect(cache.metrics()).toMatchObject({ urls: 0, bytes: 0 });
    });

    it('flushAll removes every entry and returns removed keys', async () => {
        const cache = usePreviewCache({
            maxUrls: 5,
            maxBytes: Number.POSITIVE_INFINITY,
        });

        await cache.ensure('a', async () => ({ url: 'blob:a', bytes: 1 }));
        await cache.ensure('b', async () => ({ url: 'blob:b', bytes: 2 }));

        const removed = cache.flushAll();
        expect(new Set(removed)).toEqual(new Set(['a', 'b']));
        expect(cache.metrics()).toMatchObject({ urls: 0, bytes: 0 });
    });
});
