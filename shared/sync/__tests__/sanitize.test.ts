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
        });
    });
});
