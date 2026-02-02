import { describe, it, expect, beforeEach } from 'vitest';
import { usePreviewCache } from '../usePreviewCache';

describe('usePreviewCache - error handling', () => {
    let cache: ReturnType<typeof usePreviewCache>;

    beforeEach(() => {
        cache = usePreviewCache({ maxUrls: 10, maxBytes: 1000000 });
    });

    it('rejects when loader throws an error', async () => {
        const loader = async () => {
            throw new Error('Loader failed');
        };

        await expect(cache.ensure('key1', loader)).rejects.toThrow('Loader failed');
    });

    it('does not increment totalBytes when loader fails', async () => {
        const loader = async () => {
            throw new Error('Load error');
        };

        const metricsBefore = cache.metrics();

        try {
            await cache.ensure('key1', loader);
        } catch {
            // Expected
        }

        const metricsAfter = cache.metrics();

        // Bytes should not have changed
        expect(metricsAfter.bytes).toBe(metricsBefore.bytes);
    });

    it('does not add cache entry when loader fails', async () => {
        const loader = async () => {
            throw new Error('Load error');
        };

        try {
            await cache.ensure('key1', loader);
        } catch {
            // Expected
        }

        const metrics = cache.metrics();

        // No entry should have been added
        expect(metrics.urls).toBe(0);
    });

    it('rejects when loader returns invalid result (not an object)', async () => {
        const loader = async () => {
            return 'not an object' as any;
        };

        await expect(cache.ensure('key1', loader)).rejects.toThrow(
            'invalid result'
        );
    });

    it('rejects when loader returns null', async () => {
        const loader = async () => {
            return null as any;
        };

        await expect(cache.ensure('key1', loader)).rejects.toThrow(
            'invalid result'
        );
    });

    it('rejects when loader returns object without url', async () => {
        const loader = async () => {
            return { bytes: 100 } as any;
        };

        await expect(cache.ensure('key1', loader)).rejects.toThrow('invalid url');
    });

    it('rejects when loader returns empty string url', async () => {
        const loader = async () => {
            return { url: '', bytes: 100 };
        };

        await expect(cache.ensure('key1', loader)).rejects.toThrow('invalid url');
    });

    it('rejects when loader returns non-string url', async () => {
        const loader = async () => {
            return { url: 123, bytes: 100 } as any;
        };

        await expect(cache.ensure('key1', loader)).rejects.toThrow('invalid url');
    });

    it('maintains consistent metrics after loader failure', async () => {
        const goodLoader = async () => ({
            url: 'https://example.com/image.png',
            bytes: 1000,
        });

        const badLoader = async () => {
            throw new Error('Failed');
        };

        // Add a successful entry
        await cache.ensure('key1', goodLoader);

        const metricsBefore = cache.metrics();

        // Try to add a failing entry
        try {
            await cache.ensure('key2', badLoader);
        } catch {
            // Expected
        }

        const metricsAfter = cache.metrics();

        // Metrics should remain consistent
        expect(metricsAfter.urls).toBe(metricsBefore.urls);
        expect(metricsAfter.bytes).toBe(metricsBefore.bytes);
        expect(metricsAfter.hits).toBe(metricsBefore.hits);
    });
});

describe('usePreviewCache - successful operations', () => {
    let cache: ReturnType<typeof usePreviewCache>;

    beforeEach(() => {
        cache = usePreviewCache({ maxUrls: 10, maxBytes: 1000000 });
    });

    it('successfully caches valid result', async () => {
        const loader = async () => ({
            url: 'https://example.com/image.png',
            bytes: 1000,
        });

        const url = await cache.ensure('key1', loader);

        expect(url).toBe('https://example.com/image.png');

        const metrics = cache.metrics();
        expect(metrics.urls).toBe(1);
        expect(metrics.bytes).toBe(1000);
    });

    it('handles missing bytes field gracefully', async () => {
        const loader = async () => ({
            url: 'https://example.com/image.png',
            // bytes intentionally omitted
        });

        const url = await cache.ensure('key1', loader);

        expect(url).toBe('https://example.com/image.png');

        const metrics = cache.metrics();
        expect(metrics.urls).toBe(1);
        expect(metrics.bytes).toBe(0); // Default to 0
    });

    it('returns cached url on second access', async () => {
        const loader = async () => ({
            url: 'https://example.com/image.png',
            bytes: 1000,
        });

        const url1 = await cache.ensure('key1', loader);
        const url2 = await cache.ensure('key1', loader);

        expect(url1).toBe(url2);

        const metrics = cache.metrics();
        expect(metrics.hits).toBe(1);
        expect(metrics.misses).toBe(1);
    });

    it('increments hits counter on cache hit', async () => {
        const loader = async () => ({
            url: 'https://example.com/image.png',
            bytes: 1000,
        });

        await cache.ensure('key1', loader);

        const metricsBefore = cache.metrics();

        await cache.ensure('key1', loader);

        const metricsAfter = cache.metrics();

        expect(metricsAfter.hits).toBe(metricsBefore.hits + 1);
    });
});
