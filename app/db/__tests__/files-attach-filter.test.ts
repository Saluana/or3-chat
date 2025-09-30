import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHooks } from '~/composables/useHooks';
import {
    persistAttachment,
    type AttachmentLike,
} from '~/components/chat/file-upload-utils';
import type { FilesAttachInputPayload } from '~/utils/hook-keys';
import { db } from '../client';

describe('files.attach:filter:input hook', () => {
    let hooks: ReturnType<typeof useHooks>;
    let disposeHook: (() => void) | undefined;

    beforeEach(() => {
        hooks = useHooks();
        disposeHook = undefined;
    });

    afterEach(() => {
        if (disposeHook) {
            disposeHook();
            disposeHook = undefined;
        }
    });

    it('rejects file when filter returns false', async () => {
        // Register a filter that rejects all files
        disposeHook = hooks.on('files.attach:filter:input', () => false, {
            kind: 'filter',
        });

        const mockFile = new File(['test content'], 'test.png', {
            type: 'image/png',
        });

        const attachment: AttachmentLike = {
            file: mockFile,
            name: 'test.png',
            status: 'pending' as const,
            mime: 'image/png',
            kind: 'image' as const,
        };

        // persistAttachment catches errors internally and sets status to 'error'
        await persistAttachment(attachment);

        // Attachment status should be 'error'
        expect(attachment.status).toBe('error');
        expect(attachment.error).toBeDefined();
    });

    it('accepts file when filter passes', async () => {
        let filterCalled = false;
        let receivedPayload: FilesAttachInputPayload | false | null = null;

        // Register a filter that just observes and passes through
        disposeHook = hooks.on(
            'files.attach:filter:input',
            (payload: FilesAttachInputPayload) => {
                filterCalled = true;
                receivedPayload = payload;
                return payload;
            },
            { kind: 'filter' }
        );

        const mockContent = 'x'.repeat(1000);
        const mockFile = new File([mockContent], 'test.png', {
            type: 'image/png',
        });

        const attachment: AttachmentLike = {
            file: mockFile,
            name: 'test.png',
            status: 'pending' as const,
            mime: 'image/png',
            kind: 'image' as const,
        };

        await persistAttachment(attachment);

        // Verify the filter was called
        expect(filterCalled).toBe(true);
        expect(receivedPayload).toBeDefined();
        expect(receivedPayload).not.toBe(false);
        if (receivedPayload && typeof receivedPayload === 'object') {
            expect((receivedPayload as FilesAttachInputPayload).name).toBe(
                'test.png'
            );
            expect((receivedPayload as FilesAttachInputPayload).mime).toBe(
                'image/png'
            );
        }

        // Cleanup if successful
        if (attachment.hash) {
            await db.file_meta.delete(attachment.hash);
            await db.file_blobs.delete(attachment.hash);
        }
    });

    it('allows filter to transform attachment properties', async () => {
        let transformedName: string | undefined;

        // Register a filter that renames the file
        disposeHook = hooks.on(
            'files.attach:filter:input',
            (payload: FilesAttachInputPayload) => {
                const transformed = {
                    ...payload,
                    name: 'renamed-' + payload.name,
                };
                transformedName = transformed.name;
                return transformed;
            },
            { kind: 'filter' }
        );

        const mockFile = new File(['x'.repeat(1000)], 'original.png', {
            type: 'image/png',
        });

        const attachment: AttachmentLike = {
            file: mockFile,
            name: 'original.png',
            status: 'pending' as const,
            mime: 'image/png',
            kind: 'image' as const,
        };

        await persistAttachment(attachment);

        // Verify the filter transformed the name
        expect(transformedName).toBe('renamed-original.png');

        // Cleanup
        if (attachment.hash) {
            await db.file_meta.delete(attachment.hash);
            await db.file_blobs.delete(attachment.hash);
        }
    });

    it('handles filter that rejects based on file size', async () => {
        const MAX_SIZE = 1024; // 1KB limit

        disposeHook = hooks.on(
            'files.attach:filter:input',
            (payload: FilesAttachInputPayload) => {
                if (payload.size > MAX_SIZE) return false;
                return payload;
            },
            { kind: 'filter' }
        );

        // Create a file larger than the limit
        const largeContent = 'x'.repeat(2048);
        const largeFile = new File([largeContent], 'large.png', {
            type: 'image/png',
        });

        const attachment: AttachmentLike = {
            file: largeFile,
            name: 'large.png',
            status: 'pending' as const,
            mime: 'image/png',
            kind: 'image' as const,
        };

        // Should be rejected
        await persistAttachment(attachment);
        expect(attachment.status).toBe('error');
    });

    it('handles filter that rejects based on mime type', async () => {
        const ALLOWED_MIMES = ['image/png', 'image/jpeg'];

        disposeHook = hooks.on(
            'files.attach:filter:input',
            (payload: FilesAttachInputPayload) => {
                if (!ALLOWED_MIMES.includes(payload.mime)) return false;
                return payload;
            },
            { kind: 'filter' }
        );

        // Try to upload a GIF
        const gifFile = new File(['GIF89a'], 'test.gif', {
            type: 'image/gif',
        });

        const attachment: AttachmentLike = {
            file: gifFile,
            name: 'test.gif',
            status: 'pending' as const,
            mime: 'image/gif',
            kind: 'image' as const,
        };

        // Should be rejected
        await persistAttachment(attachment);
        expect(attachment.status).toBe('error');
    });
});
