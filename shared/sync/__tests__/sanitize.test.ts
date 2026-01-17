import { describe, expect, it } from 'vitest';
import { sanitizePayloadForSync } from '../sanitize';

describe('sanitizePayloadForSync', () => {
    it('returns undefined for delete operations', () => {
        const payload = { id: '123', name: 'test' };
        const result = sanitizePayloadForSync('threads', payload, 'delete');
        expect(result).toBeUndefined();
    });

    it('returns undefined for null or non-object payloads', () => {
        expect(sanitizePayloadForSync('threads', null, 'put')).toBeUndefined();
        expect(sanitizePayloadForSync('threads', undefined, 'put')).toBeUndefined();
        expect(sanitizePayloadForSync('threads', 'string', 'put')).toBeUndefined();
        expect(sanitizePayloadForSync('threads', 123, 'put')).toBeUndefined();
    });

    it('filters out dotted keys (Dexie compound index artifacts)', () => {
        const payload = {
            id: '123',
            name: 'test',
            'thread_id.index': 'compound-key',
            'data.type': 'artifact',
        };
        const result = sanitizePayloadForSync('messages', payload, 'put');
        expect(result).toEqual({
            id: '123',
            name: 'test',
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('removes hlc field', () => {
        const payload = {
            id: '123',
            name: 'test',
            hlc: '1234567890:0001:abc12345',
        };
        const result = sanitizePayloadForSync('threads', payload, 'put');
        expect(result).toEqual({
            id: '123',
            name: 'test',
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('removes ref_count for file_meta table', () => {
        const payload = {
            hash: 'sha256:abc123',
            mime_type: 'image/png',
            size: 1024,
            ref_count: 5,
        };
        const result = sanitizePayloadForSync('file_meta', payload, 'put');
        expect(result).toEqual({
            hash: 'sha256:abc123',
            mime_type: 'image/png',
            size: 1024,
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('does not remove ref_count for other tables', () => {
        const payload = {
            id: '123',
            ref_count: 5,
        };
        const result = sanitizePayloadForSync('threads', payload, 'put');
        expect(result).toEqual({
            id: '123',
            ref_count: 5,
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('converts postType to post_type for posts table', () => {
        const payload = {
            id: '123',
            title: 'Test Post',
            postType: 'markdown',
        };
        const result = sanitizePayloadForSync('posts', payload, 'put');
        expect(result).toEqual({
            id: '123',
            title: 'Test Post',
            post_type: 'markdown',
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('does not duplicate post_type if both postType and post_type exist', () => {
        const payload = {
            id: '123',
            title: 'Test Post',
            postType: 'markdown',
            post_type: 'existing',
        };
        const result = sanitizePayloadForSync('posts', payload, 'put');
        expect(result).toEqual({
            id: '123',
            title: 'Test Post',
            postType: 'markdown',
            post_type: 'existing',
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('handles posts without postType field', () => {
        const payload = {
            id: '123',
            title: 'Test Post',
        };
        const result = sanitizePayloadForSync('posts', payload, 'put');
        expect(result).toEqual({
            id: '123',
            title: 'Test Post',
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('sanitizes complex payloads correctly', () => {
        const payload = {
            id: '123',
            name: 'test',
            'compound.key': 'should-be-removed',
            hlc: 'should-be-removed',
            nested: { data: 'kept' },
        };
        const result = sanitizePayloadForSync('threads', payload, 'put');
        expect(result).toEqual({
            id: '123',
            name: 'test',
            nested: { data: 'kept' },
            deleted: false, // Added for legacy data compatibility
        });
    });

    it('adds deleted: false for synced tables that are missing it', () => {
        const tablesWithDeleted = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta'];
        for (const table of tablesWithDeleted) {
            const payload = { id: '123' };
            const result = sanitizePayloadForSync(table, payload, 'put');
            expect(result?.deleted).toBe(false);
        }
    });

    it('preserves existing deleted value', () => {
        const payload = { id: '123', deleted: true };
        const result = sanitizePayloadForSync('threads', payload, 'put');
        expect(result?.deleted).toBe(true);
    });

    it('converts messages error: null to undefined', () => {
        const payload = { id: '123', error: null };
        const result = sanitizePayloadForSync('messages', payload, 'put');
        expect(result?.error).toBeUndefined();
        expect('error' in (result || {})).toBe(false);
    });

    it('converts kv value: null to undefined', () => {
        const payload = { id: '123', value: null };
        const result = sanitizePayloadForSync('kv', payload, 'put');
        expect(result?.value).toBeUndefined();
        expect('value' in (result || {})).toBe(false);
    });

    it('strips large base64 data URLs from message data', () => {
        const largeDataUrl = 'data:image/png;base64,' + 'A'.repeat(20000);
        const payload = {
            id: '123',
            data: {
                attachments: [
                    { type: 'image/png', url: largeDataUrl }
                ]
            }
        };
        const result = sanitizePayloadForSync('messages', payload, 'put');
        expect((result?.data as any)?.attachments?.[0]?.url).toBe('[data-url-stripped]');
    });

    it('preserves small data URLs in message data', () => {
        const smallDataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
        const payload = {
            id: '123',
            data: {
                attachments: [
                    { type: 'image/png', url: smallDataUrl }
                ]
            }
        };
        const result = sanitizePayloadForSync('messages', payload, 'put');
        expect((result?.data as any)?.attachments?.[0]?.url).toBe(smallDataUrl);
    });
});
