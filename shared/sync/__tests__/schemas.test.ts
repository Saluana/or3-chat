import { describe, expect, it } from 'vitest';
import {
    NotificationPayloadSchema,
    PostPayloadSchema,
    PushResultSchema,
    TABLE_PAYLOAD_SCHEMAS,
} from '../schemas';

describe('sync schemas', () => {
    it('includes notifications in TABLE_PAYLOAD_SCHEMAS', () => {
        expect(TABLE_PAYLOAD_SCHEMAS.notifications).toBe(NotificationPayloadSchema);
    });

    it('validates notification payloads', () => {
        const payload = {
            id: 'notif-1',
            user_id: 'user-1',
            type: 'sync-error',
            title: 'Sync failed',
            deleted: false,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        };
        expect(NotificationPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts post payloads in snake_case and keeps snake_case', () => {
        const parsed = PostPayloadSchema.safeParse({
            id: 'post-1',
            title: 'Post',
            content: 'Body',
            post_type: 'markdown',
            deleted: false,
            created_at: 1,
            updated_at: 2,
            clock: 3,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.post_type).toBe('markdown');
            expect(parsed.data).not.toHaveProperty('postType');
        }
    });

    it('accepts post payloads in camelCase and normalizes to snake_case', () => {
        const parsed = PostPayloadSchema.safeParse({
            id: 'post-2',
            title: 'Post',
            content: 'Body',
            postType: 'markdown',
            deleted: false,
            createdAt: 1,
            updatedAt: 2,
            clock: 3,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.post_type).toBe('markdown');
            expect(parsed.data.created_at).toBe(1);
            expect(parsed.data.updated_at).toBe(2);
            expect(parsed.data).not.toHaveProperty('postType');
            expect(parsed.data).not.toHaveProperty('createdAt');
            expect(parsed.data).not.toHaveProperty('updatedAt');
        }
    });

    it('normalizes notification camelCase keys to snake_case', () => {
        const parsed = NotificationPayloadSchema.safeParse({
            id: 'notif-2',
            userId: 'user-2',
            threadId: 'thread-1',
            documentId: 'doc-1',
            type: 'ai.message.received',
            title: 'Done',
            deleted: false,
            createdAt: 5,
            updatedAt: 6,
            clock: 7,
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.user_id).toBe('user-2');
            expect(parsed.data.thread_id).toBe('thread-1');
            expect(parsed.data.document_id).toBe('doc-1');
            expect(parsed.data.created_at).toBe(5);
            expect(parsed.data.updated_at).toBe(6);
            expect(parsed.data).not.toHaveProperty('userId');
            expect(parsed.data).not.toHaveProperty('threadId');
            expect(parsed.data).not.toHaveProperty('documentId');
            expect(parsed.data).not.toHaveProperty('createdAt');
            expect(parsed.data).not.toHaveProperty('updatedAt');
        }
    });

    it('accepts PushResult errorCode values', () => {
        const parsed = PushResultSchema.safeParse({
            results: [
                {
                    opId: 'op-1',
                    success: false,
                    error: 'Validation failed',
                    errorCode: 'VALIDATION_ERROR',
                },
            ],
            serverVersion: 42,
        });

        expect(parsed.success).toBe(true);
    });
});
