import { describe, expect, it, vi } from 'vitest';

const MOCK_TRANSPARENT_GIF_DATA_URL =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

vi.mock('~/db/files', () => ({
    getFileMeta: vi.fn(async () => ({ mime_type: 'image/png', kind: 'image' })),
    getFileBlob: vi.fn(
        async () => new Blob(['fake-image'], { type: 'image/png' })
    ),
}));

import { buildOpenRouterMessages } from '../openrouter-build';

describe('buildOpenRouterMessages', () => {
    it('strips internal assistant file-hash placeholders from text while keeping hydrated image inputs', async () => {
        const messages = await buildOpenRouterMessages([
            {
                role: 'assistant' as const,
                content:
                    `Here is the image.\n\n![file-hash:abc123](${MOCK_TRANSPARENT_GIF_DATA_URL})`,
                file_hashes: JSON.stringify(['abc123']),
            },
            {
                role: 'user' as const,
                content: 'Please generate another variation.',
            },
        ]);

        expect(messages).toHaveLength(2);
        expect(messages[0]?.content).toEqual(
            expect.arrayContaining([
                { type: 'text', text: 'Here is the image.' },
                expect.objectContaining({
                    type: 'image_url',
                }),
            ])
        );

        const assistantText = messages[0]?.content.find(
            (part) => part.type === 'text'
        ) as { type: 'text'; text: string } | undefined;
        expect(assistantText?.text).toBe('Here is the image.');
        expect(assistantText?.text).not.toContain('file-hash:');
    });

    it('strips legacy assistant file-hash placeholder URLs from text', async () => {
        const messages = await buildOpenRouterMessages([
            {
                role: 'assistant' as const,
                content:
                    'Legacy one  \n\n![saved image](file-hash:abc123)\n\n\n![saved image](blob:file-hash:def456)\n\nLegacy two\n',
                file_hashes: JSON.stringify(['abc123', 'def456']),
            },
        ]);

        expect(messages[0]?.content).toEqual(
            expect.arrayContaining([
                { type: 'text', text: 'Legacy one\n\nLegacy two' },
                expect.objectContaining({ type: 'image_url' }),
                expect.objectContaining({ type: 'image_url' }),
            ])
        );

        const assistantText = messages[0]?.content.find(
            (part) => part.type === 'text'
        ) as { type: 'text'; text: string } | undefined;

        expect(assistantText?.text).toBe('Legacy one\n\nLegacy two');
        expect(assistantText?.text).not.toContain('file-hash:');
    });
});
