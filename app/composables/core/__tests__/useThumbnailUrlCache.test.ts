// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThumbnailUrlCache } from '../useThumbnailUrlCache';

describe('useThumbnailUrlCache image readiness', () => {
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:decoded-image');
    const decode = vi.fn(async () => undefined);

    beforeEach(() => {
        delete (globalThis as typeof globalThis & {
            __or3ThumbUrlCache?: unknown;
        }).__or3ThumbUrlCache;
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
