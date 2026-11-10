import { afterEach, expect, it, vi } from 'vitest';
import { resizePreview } from '../resizePreview';

afterEach(() => vi.unstubAllGlobals());

it('resizes a large JPEG and closes the bitmap', async () => {
    const close = vi.fn();
    const bitmap = { width: 400, height: 200, close };
    const drawImage = vi.fn();
    const result = new Blob(['small'], { type: 'image/webp' });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage }; } async convertToBlob() { return result; } });
    expect(await resizePreview(new Blob([new Uint8Array([255, 216, 255]), 'original'], { type: 'image/jpeg' }), 100)).toBe(result);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 100, 50);
    expect(close).toHaveBeenCalledOnce();
});

it('returns the original when decoding is unavailable or fails, or the format may animate', async () => {
    const jpeg = new Blob(['original'], { type: 'image/jpeg' });
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await resizePreview(jpeg, 100)).toBe(jpeg);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    expect(await resizePreview(jpeg, 100)).toBe(jpeg);
    const gif = new Blob(['animated'], { type: 'image/gif' });
    expect(await resizePreview(gif, 100)).toBe(gif);
});

it('uses a regular canvas when OffscreenCanvas is unavailable', async () => {
    const close = vi.fn();
    const bitmap = { width: 300, height: 600, close };
    const drawImage = vi.fn();
    const result = new Blob(['x'], { type: 'image/jpeg' });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage }), toBlob: (cb: (b: Blob) => void) => cb(result) }) });
    const original = new Blob([new Uint8Array([255, 216, 255]), 'original'], { type: 'image/jpeg' });
    expect(await resizePreview(original, 100)).toBe(result);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 100, 200);
    expect(close).toHaveBeenCalledOnce();
});

it('preserves animated PNG', async () => {
    const png = new Blob([new Uint8Array([137,80,78,71,13,10,26,10, 0,0,0,0, 97,99,84,76, 0,0,0,0])], { type: 'image/png' });
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    expect(await resizePreview(png, 100)).toBe(png);
    expect(decode).not.toHaveBeenCalled();
});

it('resizes a static PNG', async () => {
    const png = new Blob([new Uint8Array([137,80,78,71,13,10,26,10, 0,0,0,0, 73,68,65,84, 0,0,0,0])], { type: 'image/png' });
    const result = new Blob(['x'], { type: 'image/webp' });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 200, height: 100, close: vi.fn() }));
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn() }; } async convertToBlob() { return result; } });
    expect(await resizePreview(png, 100)).toBe(result);
});

it('shares three decode slots across preview sizes and skips invalidated waiting work', async () => {
    // Failures: independent consumer caps, leaked slots, and stale queued work.
    let active = 0;
    let maxActive = 0;
    const finish: Array<() => void> = [];
    const decode = vi.fn(() => new Promise<any>(resolve => {
        active++;
        maxActive = Math.max(maxActive, active);
        finish.push(() => { active--; resolve({ width: 2000, height: 1000, close: vi.fn() }); });
    }));
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob(['x'], { type: 'image/webp' }); } });
    const blob = new Blob([new Uint8Array([255, 216, 255]), 'original'], { type: 'image/jpeg' });
    let valid = true;
    const jobs = [960, 160, 960, 160, 160].map((size, i) => resizePreview(blob, size, () => i !== 3 || valid));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
    valid = false;
    while (finish.length || decode.mock.calls.length < 4) {
        finish.shift()?.();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    await Promise.all(jobs);
    expect(maxActive).toBe(3);
    expect(decode).toHaveBeenCalledTimes(4);
});
