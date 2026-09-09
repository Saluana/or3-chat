import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFileMeta = vi.fn();
const getFileBlob = vi.fn();

vi.mock('~/db/files', () => ({ getFileMeta, getFileBlob }));

import { prepareFilesForModel } from '../files';

describe('model file attachment boundary', () => {
    beforeEach(() => {
        getFileMeta.mockReset();
        getFileBlob.mockReset();
    });

    it('does not turn an SVG data URL into an image model part', async () => {
        await expect(prepareFilesForModel([
            {
                type: 'image/svg+xml',
                url: 'data:image/svg+xml;base64,PHN2Zy8+',
            },
        ])).resolves.toEqual([]);
    });

    it('does not turn a generic image-looking file into a model image', async () => {
        getFileMeta.mockResolvedValue({ kind: 'file', mime_type: 'image/png' });
        getFileBlob.mockResolvedValue(new Blob(['bytes'], { type: 'image/png' }));

        await expect(prepareFilesForModel([
            { type: 'image/png', url: 'generic-file-hash' },
        ])).resolves.toEqual([]);
    });

    it('keeps a trusted raster image path available', async () => {
        getFileMeta.mockResolvedValue({ kind: 'image', mime_type: 'image/png' });
        getFileBlob.mockResolvedValue(new Blob(['bytes'], { type: 'image/png' }));

        await expect(prepareFilesForModel([
            { type: 'image/png', url: 'trusted-image-hash' },
        ])).resolves.toEqual([
            {
                type: 'image',
                image: expect.stringMatching(/^data:image\/png;base64,/iu),
                mediaType: 'image/png',
            },
        ]);
    });
});
