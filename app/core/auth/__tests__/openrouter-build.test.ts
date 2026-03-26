import { describe, expect, it, vi } from 'vitest';

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
                    'Here is the image.\n\n![file-hash:abc123](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
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
        );
        expect(assistantText).toEqual({
            type: 'text',
            text: 'Here is the image.',
        });
    });
});
