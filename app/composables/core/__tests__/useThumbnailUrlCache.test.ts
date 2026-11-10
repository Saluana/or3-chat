// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThumbnailUrlCache } from '../useThumbnailUrlCache';
import { resizePreview } from '~/utils/files/resizePreview';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';

describe('useThumbnailUrlCache image readiness', () => {
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:decoded-image');
    const decode = vi.fn(async (): Promise<void> => undefined);

    beforeEach(() => {
        delete (globalThis as typeof globalThis & {
            __or3ThumbUrlCache?: unknown;
        }).__or3ThumbUrlCache;
        setActiveWorkspaceDb('thumbnail-isolation-a');
        vi.clearAllMocks();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        vi.stubGlobal(
            'Image',
            class {
                src = '';
                decode = decode;
            }
        );
    });

    afterEach(() => {
        setActiveWorkspaceDb(null);
        const shared = (globalThis as typeof globalThis & { __or3ThumbUrlCache?: {
            stopWorkspace?: () => void;
            cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
        } }).__or3ThumbUrlCache;
        shared?.stopWorkspace?.();
        shared?.cleanupTimers.forEach(clearTimeout);
        delete (globalThis as typeof globalThis & { __or3ThumbUrlCache?: unknown }).__or3ThumbUrlCache;
        evictWorkspaceDb('thumbnail-isolation-a');
        evictWorkspaceDb('thumbnail-isolation-b');
        vi.unstubAllGlobals();
    });

    function raster() {
        return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
    }

    it('shares three decode slots between gallery resizing and thumbnail formats', async () => {
        // A GIF decode can overlap a gallery bitmap decode, or queued work can exceed the limit.
        const cache = useThumbnailUrlCache();
        const finish: Array<() => void> = [];
        let active = 0;
        let peak = 0;
        const held = () => new Promise<void>(resolve => {
            active++;
            peak = Math.max(peak, active);
            finish.push(() => { active--; resolve(); });
        });
        decode.mockImplementation(held);
        vi.stubGlobal('createImageBitmap', async () => {
            await held();
            return { width: 10, height: 10, close() {} };
        });
        const jpeg = new Blob([new Uint8Array([255, 216, 255]), 'original'], { type: 'image/jpeg' });
        const gif = new Blob(['GIF89a', 'image'], { type: 'image/gif' });
        const webp = new Blob(['RIFF', new Uint8Array([4, 0, 0, 0]), 'WEBP'], { type: 'image/webp' });
        const blobs = [gif, webp, jpeg, raster(), gif, webp, jpeg, raster()];
        const tasks = [resizePreview(jpeg, 160), ...blobs.map((blob, i) => {
            cache.retain(`image-${i}`);
            return cache.ensure(`image-${i}`, async (current, signal) => resizePreview(blob, 160, current, undefined, signal));
        })];
        try {
            await vi.waitFor(() => expect(finish.length).toBeGreaterThanOrEqual(3));
            await new Promise(resolve => setTimeout(resolve, 30));
            expect(peak).toBeLessThanOrEqual(3);
        } finally {
            for (let i = 0; i < 20; i++) {
                while (finish.length) finish.shift()!();
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            const results = await Promise.all(tasks);
            expect(peak).toBeLessThanOrEqual(3);
            expect(results.slice(1).every(result => result && 'status' in result && result.status === 'ready')).toBe(true);
            decode.mockReset();
            decode.mockResolvedValue(undefined);
            for (let i = 0; i < 8; i++) cache.release(`image-${i}`);
        }
    });

    it('keeps a shared load for a surviving owner and cancels an unowned queued resize', async () => {
        // Failures: a departing owner cancels another, or an abandoned queued job decodes.
        const cache = useThumbnailUrlCache();
        const finishes: Array<() => void> = [];
        const bitmap = vi.fn(() => new Promise<any>(resolve => finishes.push(() => resolve({ width: 200, height: 100, close() {} }))));
        vi.stubGlobal('createImageBitmap', bitmap);
        vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }); } });
        const jpeg = new Blob([new Uint8Array([255, 216, 255]), 'original'], { type: 'image/jpeg' });
        const blockers = Array.from({ length: 3 }, () => resizePreview(jpeg, 160));
        await vi.waitFor(() => expect(bitmap).toHaveBeenCalledTimes(3));
        cache.retain('shared');
        cache.retain('shared');
        const loader = (current: () => boolean, signal: AbortSignal) => resizePreview(jpeg, 160, current, undefined, signal);
        const first = cache.ensure('shared', loader);
        const second = cache.ensure('shared', loader);
        cache.release('shared');
        finishes.shift()!();
        await vi.waitFor(() => expect(bitmap).toHaveBeenCalledTimes(4));
        cache.retain('abandoned');
        const abandoned = cache.ensure('abandoned', loader);
        cache.release('abandoned');
        finishes.shift()!();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(bitmap).toHaveBeenCalledTimes(4);
        while (finishes.length) finishes.shift()!();
        await Promise.all(blockers);
        expect((await first)?.status).toBe('ready');
        expect(await second).toEqual(await first);
        expect(await abandoned).toBeUndefined();
        cache.release('shared');
    });

    it('invalidates shared thumbnail URLs and dimensions on workspace switching before reusing a hash', async () => {
        const cache = useThumbnailUrlCache();
        cache.setIntrinsicSize('shared', 1200, 800);
        await cache.ensure('shared', async () => raster());
        setActiveWorkspaceDb('thumbnail-isolation-b');
        expect(cache.get('shared')).toBeUndefined();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:decoded-image');
        const lookup = vi.fn(async () => raster());
        const next = await cache.ensure('shared', lookup);
        expect(lookup).toHaveBeenCalledOnce();
        expect(next).toEqual({ status: 'ready', url: 'blob:decoded-image' });
    });

    it('discards a held thumbnail load without waiting on it in the next workspace', async () => {
        const cache = useThumbnailUrlCache();
        let finish!: (blob: Blob) => void;
        const previous = cache.ensure('shared', () => new Promise(resolve => { finish = resolve; }));
        setActiveWorkspaceDb('thumbnail-isolation-b');
        const lookup = vi.fn(async () => raster());
        const next = cache.ensure('shared', lookup);
        expect(lookup).toHaveBeenCalledOnce();
        finish(raster());
        expect(await previous).toBeUndefined();
        expect(await next).toEqual({ status: 'ready', url: 'blob:decoded-image' });
    });

    it.each(['resolve', 'reject'] as const)('discards a held thumbnail decode that will %s after switching away and back', async outcome => {
        const cache = useThumbnailUrlCache();
        let finish!: () => void;
        let fail!: (error: Error) => void;
        decode.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }));
        const previous = cache.ensure('shared', async () => raster());
        await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
        setActiveWorkspaceDb('thumbnail-isolation-b');
        setActiveWorkspaceDb('thumbnail-isolation-a');
        if (outcome === 'resolve') finish(); else fail(new Error('old decode failed'));
        expect(await previous).toBeUndefined();
        expect(cache.get('shared')).toBeUndefined();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:decoded-image');
    });

    it.each(['resolve', 'reject'] as const)('cannot replace or expire the next workspace thumbnail when an old decode will %s', async outcome => {
        const cache = useThumbnailUrlCache({ graceMs: 1 });
        createObjectURL.mockReturnValueOnce('blob:old-decode').mockReturnValueOnce('blob:current-decode');
        let finish!: () => void;
        let fail!: (error: Error) => void;
        decode.mockImplementationOnce(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }));
        const previous = cache.ensure('shared', async () => raster());
        await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
        setActiveWorkspaceDb('thumbnail-isolation-b');
        cache.retain('shared');
        cache.setIntrinsicSize('shared', 200, 300);
        const current = await cache.ensure('shared', async () => raster());
        if (outcome === 'resolve') finish(); else fail(new Error('old decode failed'));
        expect(await previous).toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(cache.get('shared')).toEqual(current);
        expect(current).toMatchObject({ url: 'blob:current-decode', width: 200, height: 300 });
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-decode');
        expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:current-decode');
    });

    it('preserves recovered same-hash bytes when a former-workspace blob lookup fails late', async () => {
        const cache = useThumbnailUrlCache();
        let fail!: (error: Error) => void;
        const previous = cache.ensure('shared', () => new Promise((_resolve, reject) => { fail = reject; }));
        setActiveWorkspaceDb('thumbnail-isolation-b');
        const recovered = await cache.ensure('shared', async () => raster());
        expect(recovered?.status).toBe('ready');
        fail(new Error('synthetic old blob failure'));
        expect(await previous).toBeUndefined();
        expect(cache.get('shared')).toBe(recovered);
        expect(revokeObjectURL).not.toHaveBeenCalledWith(recovered?.url);
    });

    it('publishes a ready URL only after decode and includes intrinsic size', async () => {
        const cache = useThumbnailUrlCache();
        cache.setIntrinsicSize('image', 1200, 800);

        const state = await cache.ensure(
            'image',
            async () =>
                new Blob(
                    [
                        new Uint8Array([
                            0x89,
                            0x50,
                            0x4e,
                            0x47,
                            0x0d,
                            0x0a,
                            0x1a,
                            0x0a,
                        ]),
                    ],
                    { type: 'image/png' }
                )
        );

        expect(decode).toHaveBeenCalledTimes(1);
        expect(state).toEqual({
            status: 'ready',
            url: 'blob:decoded-image',
            width: 1200,
            height: 800,
        });
    });

    it('keeps decode failures as ordinary error placeholders', async () => {
        decode.mockRejectedValueOnce(new Error('decode failed'));
        const cache = useThumbnailUrlCache();

        const state = await cache.ensure(
            'broken',
            async () =>
                new Blob(
                    [
                        new Uint8Array([
                            0x89,
                            0x50,
                            0x4e,
                            0x47,
                            0x0d,
                            0x0a,
                            0x1a,
                            0x0a,
                        ]),
                    ],
                    { type: 'image/png' }
                )
        );

        expect(state).toEqual({ status: 'error' });
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:decoded-image');
    });

    it('keeps decode failure as a placeholder when URL cleanup throws', async () => {
        decode.mockRejectedValueOnce(new Error('decode failed'));
        revokeObjectURL.mockImplementationOnce(() => { throw new Error('cleanup unavailable'); });
        const cache = useThumbnailUrlCache();
        await expect(cache.ensure('broken', async () => raster())).resolves.toEqual({ status: 'error' });
    });

    it('does not invoke the image decoder for SVG or forged raster bytes', async () => {
        const cache = useThumbnailUrlCache();

        const svgState = await cache.ensure(
            'svg',
            async () =>
                new Blob(['<svg><script>alert(1)</script></svg>'], {
                    type: 'image/svg+xml',
                })
        );
        const forgedState = await cache.ensure(
            'forged-png',
            async () => new Blob(['not a PNG'], { type: 'image/png' })
        );

        expect(svgState).toEqual({ status: 'error' });
        expect(forgedState).toEqual({ status: 'error' });
        expect(decode).not.toHaveBeenCalled();
    });
});
