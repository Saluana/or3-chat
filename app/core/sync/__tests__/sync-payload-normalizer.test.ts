/**
 * Tests for sync-payload-normalizer.ts
 */
import { describe, it, expect } from 'vitest';
import { normalizeSyncPayload, normalizeSyncPayloadForStaging } from '../sync-payload-normalizer';

describe('normalizeSyncPayload', () => {
    const stamp = { clock: 1, hlc: '2024-01-01T00:00:00.000Z-0001-abc123' };

    describe('field mapping', () => {
        it('should map post_type to postType for posts table', () => {
            const rawPayload = {
                id: 'post-1',
                title: 'Test Post',
                content: 'Test content',
                post_type: 'article',
                deleted: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('posts', 'post-1', rawPayload, stamp);

            expect(result.isValid).toBe(true);
            expect(result.payload.postType).toBe('article');
            expect(result.payload.post_type).toBeUndefined();
        });

        it('should not overwrite existing postType with post_type', () => {
            const rawPayload = {
                id: 'post-1',
                title: 'Test Post',
                content: 'Test content',
                post_type: 'old_value',
                postType: 'correct_value',
                deleted: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('posts', 'post-1', rawPayload, stamp);

            expect(result.isValid).toBe(true);
            expect(result.payload.postType).toBe('correct_value');
        });

        it('should not apply post mapping to other tables', () => {
            const rawPayload = {
                id: 'thread-1',
                title: 'Test Thread',
                status: 'active',
                post_type: 'should_remain', // Not mapped for threads
                deleted: false,
                pinned: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('threads', 'thread-1', rawPayload, stamp);

            expect(result.isValid).toBe(true);
            expect(result.payload.post_type).toBe('should_remain');
        });
    });

    describe('primary key handling', () => {
        it('should set id field for threads table', () => {
            const rawPayload = {
                title: 'Test Thread',
                status: 'active',
                deleted: false,
                pinned: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('threads', 'thread-123', rawPayload, stamp);

            expect(result.payload.id).toBe('thread-123');
        });

        it('should set hash field for file_meta table', () => {
            const rawPayload = {
                kind: 'image',
                mime_type: 'image/png',
                size: 1024,
                deleted: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('file_meta', 'abc123hash', rawPayload, stamp);

            expect(result.payload.hash).toBe('abc123hash');
        });
    });

    describe('clock and hlc metadata', () => {
        it('should set clock and hlc from stamp', () => {
            const rawPayload = {
                id: 'thread-1',
                title: 'Test',
                status: 'active',
                deleted: false,
                pinned: false,
                created_at: 1000,
                updated_at: 1000,
            };

            const result = normalizeSyncPayload('threads', 'thread-1', rawPayload, stamp);

            expect(result.payload.clock).toBe(1);
            expect(result.payload.hlc).toBe('2024-01-01T00:00:00.000Z-0001-abc123');
        });
    });

    describe('order_key for messages', () => {
        it('should add order_key for messages if missing', () => {
            const rawPayload = {
                id: 'msg-1',
                thread_id: 'thread-1',
                role: 'user',
                index: 0,
                deleted: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('messages', 'msg-1', rawPayload, stamp);

            expect(result.payload.order_key).toBeDefined();
            expect(typeof result.payload.order_key).toBe('string');
        });

        it('should not overwrite existing order_key', () => {
            const rawPayload = {
                id: 'msg-1',
                thread_id: 'thread-1',
                role: 'user',
                index: 0,
                order_key: 'existing-key',
                deleted: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('messages', 'msg-1', rawPayload, stamp);

            expect(result.payload.order_key).toBe('existing-key');
        });
    });

    describe('validation', () => {
        it('should return isValid: true for valid payloads', () => {
            const rawPayload = {
                id: 'thread-1',
                title: 'Test Thread',
                status: 'active',
                deleted: false,
                pinned: false,
                created_at: 1000,
                updated_at: 1000,
                clock: 1,
            };

            const result = normalizeSyncPayload('threads', 'thread-1', rawPayload, stamp);

            expect(result.isValid).toBe(true);
            expect(result.errors).toBeUndefined();
        });

        it('should return isValid: false for invalid payloads', () => {
            const rawPayload = {
                // Missing required fields
                id: 'thread-1',
            };

            const result = normalizeSyncPayload('threads', 'thread-1', rawPayload, stamp);

            expect(result.isValid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors!.length).toBeGreaterThan(0);
        });

        it('should handle unknown tables gracefully (no schema)', () => {
            const rawPayload = { foo: 'bar' };

            const result = normalizeSyncPayload('unknown_table', 'pk-1', rawPayload, stamp);

            // No schema means isValid: true (passthrough)
            expect(result.isValid).toBe(true);
        });
    });
});

describe('normalizeSyncPayloadForStaging', () => {
    const stamp = { clock: 1, hlc: '2024-01-01T00:00:00.000Z-0001-abc123' };

    it('should return payload even if validation fails', () => {
        const rawPayload = {
            id: 'thread-1',
            // Missing required fields - would fail validation
        };

        const result = normalizeSyncPayloadForStaging('threads', 'thread-1', rawPayload, stamp);

        // Should still return the payload object
        expect(result.id).toBe('thread-1');
        expect(result.clock).toBe(1);
        expect(result.hlc).toBe('2024-01-01T00:00:00.000Z-0001-abc123');
    });

    it('should apply all normalization logic', () => {
        const rawPayload = {
            id: 'post-1',
            title: 'Test',
            content: 'Content',
            post_type: 'article',
            deleted: false,
            created_at: 1000,
            updated_at: 1000,
            clock: 1,
        };

        const result = normalizeSyncPayloadForStaging('posts', 'post-1', rawPayload, stamp);

        expect(result.postType).toBe('article');
        expect(result.post_type).toBeUndefined();
    });
});
