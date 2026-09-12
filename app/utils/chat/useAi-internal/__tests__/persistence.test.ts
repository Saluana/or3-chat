import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMessage = vi.hoisted(() => vi.fn());
const patchMessage = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({ messages: { get: getMessage } }));

vi.mock('~/db/messages', () => ({
    patchMessageInDb: patchMessage,
}));
vi.mock('~/db/util', () => ({ nowSec: () => 999 }));
vi.mock('~/db/files-util', () => ({
    serializeFileHashes: (hashes: string[]) => JSON.stringify(hashes),
}));

import { makeAssistantPersister, updateMessageRecord } from '../persistence';

describe('latest-row assistant persistence', () => {
    beforeEach(() => {
        getMessage.mockReset();
        patchMessage.mockReset();
        getMessage.mockResolvedValue(undefined);
    });

    it('sends only the owned delta so the atomic merge cannot clobber concurrent writes', async () => {
        const initial = {
            id: 'a1', thread_id: 't1', role: 'assistant', index: 1000,
            clock: 1, created_at: 1, updated_at: 1, deleted: false,
            pending: true, file_hashes: '["old-file"]',
            data: { content: 'stale', plugin_initial: true },
        } as any;

        const persist = makeAssistantPersister(dbMock as any, initial, []);
        await persist({ reasoning: 'new reasoning', toolCalls: [] });

        // Must not embed stale content/file_hashes: the atomic helper merges
        // this delta against the latest row inside one write transaction.
        expect(patchMessage).toHaveBeenCalledWith(
            dbMock,
            'a1',
            expect.objectContaining({
                data: {
                    reasoning_text: 'new reasoning',
                    tool_calls: [],
                },
                updated_at: 999,
            }),
            initial,
        );
        const patch = patchMessage.mock.calls[0]![2] as Record<string, unknown>;
        expect(patch).not.toHaveProperty('content');
        expect(patch).not.toHaveProperty('file_hashes');
        expect(patch.data).not.toHaveProperty('content');
        expect(patch.data).not.toHaveProperty('plugin_concurrent');
    });

    it('explicitly clearing reasoning or tool calls is not skipped', async () => {
        const initial = {
            id: 'a1', thread_id: 't1', role: 'assistant', index: 1000,
            clock: 1, created_at: 1, updated_at: 1, deleted: false,
            pending: true, file_hashes: null,
            data: { content: 'x', reasoning_text: 'old', tool_calls: [{ id: 't1' }] },
        } as any;

        const persist = makeAssistantPersister(dbMock as any, initial, []);
        await persist({ reasoning: null });
        expect(patchMessage).toHaveBeenCalledWith(
            dbMock,
            'a1',
            expect.objectContaining({
                data: expect.objectContaining({ reasoning_text: null }),
            }),
            initial,
        );

        patchMessage.mockClear();
        await persist({ toolCalls: null });
        expect(patchMessage).toHaveBeenCalledWith(
            dbMock,
            'a1',
            expect.objectContaining({
                data: expect.objectContaining({ tool_calls: [] }),
            }),
            initial,
        );
    });

    it('forwards ordinary patches as deltas for atomic merging', async () => {
        await updateMessageRecord(dbMock as any, 'a1', {
            error: 'stopped', data: { generation_state: 'aborted' },
        } as any);

        expect(patchMessage).toHaveBeenCalledWith(
            dbMock,
            'a1',
            expect.objectContaining({
                error: 'stopped',
                data: expect.objectContaining({ generation_state: 'aborted' }),
                updated_at: 999,
            }),
            null,
        );
    });
});
