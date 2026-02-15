import { describe, expect, it, vi } from 'vitest';
import { copyImageBlobToClipboard } from '../copy-image-to-clipboard';

class FakeClipboardItem {
    static supports = vi.fn(() => true);
    static createdItems: Array<Record<string, Blob>> = [];

    constructor(items: Record<string, Blob>) {
        FakeClipboardItem.createdItems.push(items);
    }
}

function resetFakeClipboardItem() {
    FakeClipboardItem.supports.mockReset();
    FakeClipboardItem.supports.mockReturnValue(true);
    FakeClipboardItem.createdItems = [];
}

describe('copyImageBlobToClipboard', () => {
    it('writes a binary image to clipboard without using text fallback', async () => {
        resetFakeClipboardItem();
        const write = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn().mockResolvedValue(undefined);
        const clipboard = { write, writeText };

        await copyImageBlobToClipboard(new Blob(['img'], { type: 'image/png' }), {
            clipboard,
            clipboardItemCtor: FakeClipboardItem as unknown as {
                new (items: Record<string, Blob>): unknown;
                supports?: (type: string) => boolean;
            },
        });

        expect(write).toHaveBeenCalledTimes(1);
        expect(writeText).not.toHaveBeenCalled();
        expect(Object.keys(FakeClipboardItem.createdItems[0] ?? {})).toEqual([
            'image/png',
        ]);
    });

    it('normalizes image/jpg to image/jpeg', async () => {
        resetFakeClipboardItem();
        const write = vi.fn().mockResolvedValue(undefined);
        const clipboard = { write };

        await copyImageBlobToClipboard(new Blob(['img']), {
            preferredMimeType: 'image/jpg',
            clipboard,
            clipboardItemCtor: FakeClipboardItem as unknown as {
                new (items: Record<string, Blob>): unknown;
                supports?: (type: string) => boolean;
            },
        });

        expect(write).toHaveBeenCalledTimes(1);
        expect(Object.keys(FakeClipboardItem.createdItems[0] ?? {})).toEqual([
            'image/jpeg',
        ]);
    });

    it('falls back to PNG conversion when direct write fails', async () => {
        resetFakeClipboardItem();
        const write = vi
            .fn()
            .mockRejectedValueOnce(new Error('unsupported mime'))
            .mockResolvedValueOnce(undefined);
        const writeText = vi.fn().mockResolvedValue(undefined);
        const clipboard = { write, writeText };
        const createPngBlob = vi
            .fn()
            .mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

        await copyImageBlobToClipboard(new Blob(['jpeg'], { type: 'image/jpeg' }), {
            preferredMimeType: 'image/jpeg',
            clipboard,
            clipboardItemCtor: FakeClipboardItem as unknown as {
                new (items: Record<string, Blob>): unknown;
                supports?: (type: string) => boolean;
            },
            createPngBlob,
        });

        expect(write).toHaveBeenCalledTimes(2);
        expect(createPngBlob).toHaveBeenCalledTimes(1);
        expect(writeText).not.toHaveBeenCalled();
        expect(Object.keys(FakeClipboardItem.createdItems[1] ?? {})).toEqual([
            'image/png',
        ]);
    });

    it('throws when clipboard write support is unavailable', async () => {
        resetFakeClipboardItem();
        await expect(
            copyImageBlobToClipboard(new Blob(['img'], { type: 'image/png' }), {
                clipboard: undefined,
                clipboardItemCtor: FakeClipboardItem as unknown as {
                    new (items: Record<string, Blob>): unknown;
                    supports?: (type: string) => boolean;
                },
            })
        ).rejects.toThrow('Clipboard image copy is unsupported.');
    });
});
