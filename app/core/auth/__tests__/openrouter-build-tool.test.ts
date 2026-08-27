import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileBlob, getFileMeta } = vi.hoisted(() => ({
    getFileBlob: vi.fn(),
    getFileMeta: vi.fn(),
}));

vi.mock('~/db/files', () => ({ getFileBlob, getFileMeta }));

import {
    AttachmentHydrationError,
    buildOpenRouterMessages,
} from '../openrouter-build';

beforeEach(() => {
    getFileBlob.mockReset();
    getFileMeta.mockReset();
});

describe('buildOpenRouterMessages attachment hydration', () => {
    it('preserves valid local hash, data URL, and remote URL references', async () => {
        getFileBlob.mockResolvedValueOnce(
            new Blob(['pdf bytes'], { type: 'application/pdf' })
        );

        const result = await buildOpenRouterMessages([
            {
                role: 'user',
                content: [
                    {
                        type: 'file',
                        data: 'valid-pdf-hash',
                        mediaType: 'application/pdf',
                        filename: 'local.pdf',
                    },
                    {
                        type: 'file',
                        data: 'data:application/pdf;base64,cGRm',
                        mediaType: 'application/pdf',
                        filename: 'data.pdf',
                    },
                    {
                        type: 'file',
                        data: 'https://cdn.example.test/remote.pdf',
                        mediaType: 'application/pdf',
                        filename: 'remote.pdf',
                    },
                ],
            },
        ]);

        const fileParts = result[0]?.content.filter(
            (part): part is {
                type: 'file';
                file: { filename: string; file_data: string };
            } => part.type === 'file'
        );
        expect(fileParts).toHaveLength(3);
        expect(fileParts?.[0]?.file.file_data).toMatch(
            /^data:application\/pdf;base64,/
        );
        expect(fileParts?.[1]?.file.file_data).toBe(
            'data:application/pdf;base64,cGRm'
        );
        expect(fileParts?.[2]?.file.file_data).toBe(
            'https://cdn.example.test/remote.pdf'
        );
    });

    it('encodes binary file data instead of dropping the attachment', async () => {
        const result = await buildOpenRouterMessages([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Read this file' },
                    {
                        type: 'file',
                        data: new Uint8Array([0, 1, 2, 255]),
                        mediaType: 'application/octet-stream',
                        filename: 'sample.bin',
                    },
                ],
            },
        ]);

        expect(result[0]?.content).toContainEqual({
            type: 'file',
            file: {
                filename: 'sample.bin',
                file_data: 'data:application/octet-stream;base64,AAEC/w==',
            },
        });
        expect(getFileBlob).not.toHaveBeenCalled();
    });

    it('fails before send when a local attachment is unavailable', async () => {
        getFileBlob.mockResolvedValueOnce(null);

        await expect(
            buildOpenRouterMessages([
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Use this attachment' },
                        {
                            type: 'file',
                            data: 'missing-file-hash',
                            mediaType: 'application/pdf',
                            filename: 'missing.pdf',
                        },
                    ],
                },
            ])
        ).rejects.toMatchObject({
            name: 'AttachmentHydrationError',
            code: 'ATTACHMENT_HYDRATION_FAILED',
            filename: 'missing.pdf',
            reason: 'unavailable',
        } satisfies Partial<AttachmentHydrationError>);
        await expect(
            buildOpenRouterMessages([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'file',
                            data: 'missing-file-hash-again',
                            mediaType: 'application/pdf',
                            filename: 'missing-again.pdf',
                        },
                    ],
                },
            ])
        ).rejects.toThrow(/missing-again\.pdf.*message 1.*reattach/i);
    });

    it('rejects empty binary attachment data as invalid', async () => {
        await expect(
            buildOpenRouterMessages([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'file',
                            data: new Uint8Array(),
                            mediaType: 'application/octet-stream',
                            filename: 'empty.bin',
                        },
                    ],
                },
            ])
        ).rejects.toMatchObject({
            name: 'AttachmentHydrationError',
            reason: 'invalid',
            filename: 'empty.bin',
        });
    });

    it('fails instead of sending an unavailable blob URL as text-only input', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValueOnce(new Error('blob unavailable'));

        await expect(
            buildOpenRouterMessages([
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Inspect this image' },
                        {
                            type: 'file',
                            data: 'blob:or3-unavailable',
                            mediaType: 'image/png',
                            filename: 'image.png',
                        },
                    ],
                },
            ])
        ).rejects.toBeInstanceOf(AttachmentHydrationError);

        fetchSpy.mockRestore();
    });

    it('encodes inline binary images with their media type', async () => {
        const result = await buildOpenRouterMessages([
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        image: new Uint8Array([137, 80, 78, 71]),
                        mediaType: 'image/png',
                    },
                ],
            },
        ]);

        expect(result[0]?.content).toContainEqual({
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,iVBORw==' },
        });
    });

    it('hydrates an inline image hash instead of dropping it', async () => {
        getFileMeta.mockResolvedValueOnce({
            kind: 'image',
            mime_type: 'image/png',
        });
        getFileBlob.mockResolvedValueOnce(
            new Blob(['png bytes'], { type: 'image/png' })
        );

        const result = await buildOpenRouterMessages([
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        image: 'inline-image-hash',
                        mediaType: 'image/png',
                    },
                ],
            },
        ]);

        expect(result[0]?.content).toContainEqual({
            type: 'image_url',
            image_url: {
                url: expect.stringMatching(/^data:image\/png;base64,/),
            },
        });
    });

    it('fails when a selected image hash cannot be hydrated', async () => {
        getFileMeta.mockResolvedValueOnce({ kind: 'image', mime_type: 'image/png' });
        getFileBlob.mockResolvedValueOnce(null);

        await expect(
            buildOpenRouterMessages([
                {
                    role: 'user',
                    content: 'Inspect this image',
                    file_hashes: JSON.stringify(['missing-image-hash']),
                },
            ])
        ).rejects.toMatchObject({
            name: 'AttachmentHydrationError',
            reason: 'unavailable',
        });
    });

    it('keeps PDF file parts usable when their persisted hash is not an image', async () => {
        getFileBlob.mockResolvedValueOnce(
            new Blob(['pdf bytes'], { type: 'application/pdf' })
        );
        getFileMeta.mockResolvedValueOnce({
            kind: 'pdf',
            mime_type: 'application/pdf',
        });

        const result = await buildOpenRouterMessages([
            {
                role: 'user',
                file_hashes: JSON.stringify(['pdf-hash']),
                content: [
                    {
                        type: 'file',
                        data: 'pdf-hash',
                        mediaType: 'application/pdf',
                        filename: 'document.pdf',
                    },
                ],
            },
        ]);

        expect(result[0]?.content).toContainEqual({
            type: 'file',
            file: {
                filename: 'document.pdf',
                file_data: expect.stringMatching(/^data:application\/pdf;base64,/),
            },
        });
    });
});

describe('buildOpenRouterMessages tool history', () => {
    it('preserves assistant calls and matching tool result metadata', async () => {
        const result = await buildOpenRouterMessages([
            {
                role: 'assistant',
                content: 'calling',
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{}' },
                    },
                ],
            },
            {
                role: 'tool',
                content: 'result',
                tool_call_id: 'call-1',
                name: 'lookup',
            },
        ]);

        expect(result[0]).toMatchObject({
            role: 'assistant',
            tool_calls: [expect.objectContaining({ id: 'call-1' })],
        });
        expect(result[1]).toMatchObject({
            role: 'tool',
            tool_call_id: 'call-1',
            name: 'lookup',
            content: [{ type: 'text', text: 'result' }],
        });
    });
});
