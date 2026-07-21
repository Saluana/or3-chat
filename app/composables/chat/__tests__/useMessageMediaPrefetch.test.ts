import { describe, expect, it, vi } from 'vitest';
import { createMessageMediaPrefetchController } from '../useMessageMediaPrefetch';

function createCache() {
    const states = new Map<string, { status: 'ready' | 'error' }>();
    return {
        states,
        get: vi.fn((hash: string) => states.get(hash)),
        ensure: vi.fn(async (
            hash: string,
            loader: () => Promise<Blob | null | undefined>
        ) => {
            const blob = await loader();
            if (blob) states.set(hash, { status: 'ready' });
            return states.get(hash);
        }),
        retain: vi.fn(),
        release: vi.fn(),
        setIntrinsicSize: vi.fn(),
    };
}

describe('message media prefetch controller', () => {
    it('limits image work to four concurrent loads', async () => {
        const cache = createCache();
        let active = 0;
        let maxActive = 0;
        const controller = createMessageMediaPrefetchController({
            cache,
            concurrency: 4,
            loadMeta: async () => ({ kind: 'image', width: 640, height: 480 }),
            loadBlob: async () => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 1));
                active--;
                return new Blob(['image'], { type: 'image/png' });
            },
        });
        const messages = Array.from({ length: 12 }, (_, index) => ({
            file_hashes: [`hash-${index}`],
        }));

        controller.updateRange(messages, { startIndex: 0, endIndex: 11 });
        await controller.whenIdle();

        expect(maxActive).toBe(4);
        expect(cache.ensure).toHaveBeenCalledTimes(12);
        expect(cache.setIntrinsicSize).toHaveBeenCalledWith(
            'hash-0',
            640,
            480
        );
    });

    it('deduplicates hashes and releases resources outside the range', async () => {
        const cache = createCache();
        const controller = createMessageMediaPrefetchController({
            cache,
            loadMeta: async () => ({ kind: 'image' }),
            loadBlob: async () => new Blob(['image'], { type: 'image/png' }),
        });
        const messages = [
            { file_hashes: ['shared', 'first'] },
            { file_hashes: JSON.stringify(['shared', 'second']) },
        ];

        controller.updateRange(messages, { startIndex: 0, endIndex: 1 });
        await controller.whenIdle();
        expect(cache.retain).toHaveBeenCalledTimes(3);

        controller.updateRange(messages, { startIndex: 1, endIndex: 1 });
        expect(cache.release).toHaveBeenCalledWith('first');
        expect(cache.release).not.toHaveBeenCalledWith('shared');

        controller.dispose();
        expect(cache.release).toHaveBeenCalledWith('shared');
        expect(cache.release).toHaveBeenCalledWith('second');
    });

    it('drops stale queued work and ignores non-image metadata on reset', async () => {
        const cache = createCache();
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const loadBlob = vi.fn(async (hash: string) => {
            if (hash === 'old') await firstGate;
            return new Blob(['image'], { type: 'image/png' });
        });
        const controller = createMessageMediaPrefetchController({
            cache,
            concurrency: 1,
            loadMeta: async (hash) => ({
                kind: hash === 'pdf' ? 'pdf' : 'image',
            }),
            loadBlob,
        });

        controller.updateRange(
            [{ file_hashes: ['old'] }, { file_hashes: ['never'] }],
            { startIndex: 0, endIndex: 1 }
        );
        await Promise.resolve();
        controller.reset();
        controller.updateRange(
            [{ file_hashes: ['fresh', 'pdf'] }],
            { startIndex: 0, endIndex: 0 }
        );
        releaseFirst();
        await controller.whenIdle();

        expect(loadBlob).not.toHaveBeenCalledWith('never');
        expect(loadBlob).toHaveBeenCalledWith('fresh');
        expect(loadBlob).not.toHaveBeenCalledWith('pdf');
        expect(cache.release).toHaveBeenCalledWith('old');
        expect(cache.release).toHaveBeenCalledWith('pdf');
    });

    it('cannot release a same-hash retention acquired by a newer epoch', async () => {
        const cache = createCache();
        let releaseOldMeta!: () => void;
        const oldMetaGate = new Promise<void>((resolve) => {
            releaseOldMeta = resolve;
        });
        let metaCalls = 0;
        const controller = createMessageMediaPrefetchController({
            cache,
            concurrency: 1,
            loadMeta: async () => {
                metaCalls++;
                if (metaCalls === 1) await oldMetaGate;
                return { kind: 'image' };
            },
            loadBlob: async () =>
                new Blob(['image'], { type: 'image/png' }),
        });
        const messages = [{ file_hashes: ['shared'] }];

        controller.updateRange(messages, { startIndex: 0, endIndex: 0 });
        await Promise.resolve();
        controller.reset();
        controller.updateRange(messages, { startIndex: 0, endIndex: 0 });
        releaseOldMeta();
        await controller.whenIdle();

        expect(cache.retain).toHaveBeenCalledTimes(2);
        expect(cache.release).toHaveBeenCalledTimes(1);
        expect(cache.release).toHaveBeenCalledWith('shared');
        expect(cache.ensure).toHaveBeenCalledTimes(1);
    });
});
