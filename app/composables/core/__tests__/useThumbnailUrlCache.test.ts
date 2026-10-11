// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThumbnailUrlCache } from '../useThumbnailUrlCache';
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
