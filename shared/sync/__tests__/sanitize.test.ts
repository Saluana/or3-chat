import { describe, expect, it } from 'vitest';
import { sanitizePayloadForSync } from '../sanitize';

describe('sanitizePayloadForSync', () => {
    it('allows payload for delete operations (to carry deleted_at)', () => {
        const payload = { id: '123', deleted_at: (12345 as number) };
        const result = sanitizePayloadForSync('threads', payload, 'delete');
        expect(result).toEqual({ ...payload, deleted: true, forked: false });
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
            forked: false, // Added for legacy threads compatibility
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
            forked: false, // Added for legacy threads compatibility
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

    it('normalizes to snake_case if both postType and post_type exist', () => {
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
             // postType is mapped to post_type, overwriting 'existing' or keeping 'markdown' depending on logic order
             // In field-mappings.ts toServerFormat:
             // if (camel in result) { result[snake] = result[camel]; delete result[camel]; }
             // So 'postType' (markdown) will overwrite 'post_type' (existing).
            post_type: 'markdown',
            deleted: false,
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
            forked: false, // Added for legacy threads compatibility
        });
    });

    it('adds deleted: false for synced tables that are missing it', () => {
        const tablesWithDeleted = [
            'threads',
            'messages',
            'projects',
            'posts',
            'kv',
            'file_meta',
            'notifications',
        ];
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
        expect(result?.forked).toBe(false); // forked is also added for legacy threads
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

    it('allows kv payloads without value after sanitization', () => {
        const payload = { id: '123', name: 'pref', value: null };
        const result = sanitizePayloadForSync('kv', payload, 'put');
        expect(result).toEqual({ id: '123', name: 'pref', deleted: false });
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

    it('caps recursive sanitization depth for nested payloads', () => {
        const deep: Record<string, unknown> = {};
        let cursor: Record<string, unknown> = deep;
        for (let i = 0; i < 25; i++) {
            cursor.child = {};
            cursor = cursor.child as Record<string, unknown>;
        }
        cursor.dataUrl = 'data:image/png;base64,' + 'A'.repeat(20000);

        const result = sanitizePayloadForSync(
            'messages',
            {
                id: '123',
                data: deep,
            },
            'put'
        );

        // Deep branch should be truncated instead of unbounded recursion.
        expect((result?.data as any)?.child?.child?.child).toBeDefined();
        const asJson = JSON.stringify(result?.data);
        expect(asJson.includes('[max-depth-stripped]')).toBe(true);
    });

    it('compacts oversized workflow message payloads below sync budget', () => {
        const hugeOutput = 'x'.repeat(90000);
        const payload = {
            id: 'msg-workflow',
            thread_id: 'thread-1',
            role: 'assistant',
            index: 12,
            order_key: '0000000000012:0000:node',
            deleted: false,
            created_at: 100,
            updated_at: 100,
            clock: 10,
            data: {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                workflowName: 'Stress Workflow',
                prompt: 'do the thing',
                executionState: 'completed',
                finalOutput: hugeOutput,
                nodeStates: {
                    n1: {
                        status: 'completed',
                        label: 'Agent',
                        type: 'agent',
                        output: hugeOutput,
                    },
                },
                sessionMessages: [
                    { role: 'assistant', content: hugeOutput },
                ],
                resumeState: {
                    startNodeId: 'n1',
                    nodeOutputs: { n1: hugeOutput },
                    executionOrder: ['n1'],
                    sessionMessages: [{ role: 'assistant', content: hugeOutput }],
                },
            },
        };

        const result = sanitizePayloadForSync('messages', payload, 'put') as Record<string, unknown>;
        const sizeBytes = new TextEncoder().encode(JSON.stringify(result)).length;
        const compactedData = result.data as Record<string, unknown>;

        expect(sizeBytes).toBeLessThanOrEqual(60 * 1024);
        expect(compactedData.type).toBe('workflow-execution');
        expect(compactedData.workflowId).toBe('wf-1');
        expect(typeof compactedData.finalOutput).toBe('string');
        expect(compactedData.sessionMessages).toBeUndefined();
    });
});
