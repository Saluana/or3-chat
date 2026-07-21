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
            async () => new Blob(['image'], { type: 'image/png' })
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
            async () => new Blob(['broken'], { type: 'image/png' })
        );

        expect(state).toEqual({ status: 'error' });
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:decoded-image');
    });
});
