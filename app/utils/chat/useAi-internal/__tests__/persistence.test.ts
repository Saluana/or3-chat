import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

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

    it('requires an acknowledged assistant row before tool execution', async () => {
        const initial = { id: 'a1', pending: true, data: { generation_lease_id: 'lease' } } as any;
        const persist = makeAssistantPersister(dbMock as any, initial, [], 'lease');
        patchMessage.mockResolvedValue(undefined);
        await expect(persist({ content: '', toolCalls: [], requireCurrent: true })).rejects.toThrow(/not acknowledged/);
        patchMessage.mockResolvedValue(initial);
        await expect(persist({ content: '', toolCalls: [], requireCurrent: true })).resolves.toBeNull();
    });

    it('serializes a reactive execution receipt into cloneable database data', async () => {
        const initial = { id: 'a1', pending: true, data: {} } as any;
        const calls = reactive([{ id: 'write', name: 'write', status: 'loading' as const,
            executionReceipt: { state: 'running' as const, argumentFingerprint: 'fp', startedAt: 10 } }]);
        patchMessage.mockImplementation(async (_db, _id, patch) => {
            const copied = structuredClone(patch);
            expect(copied.data.tool_calls[0].executionReceipt).toEqual(calls[0]!.executionReceipt);
            return initial;
        });
        await expect(makeAssistantPersister(dbMock as any, initial, [])({ toolCalls: calls, requireCurrent: true })).resolves.toBeNull();
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
            undefined,
            undefined,
            expect.objectContaining({ tables: ['threads'] }),
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
            undefined,
            undefined,
            expect.objectContaining({ tables: ['threads'] }),
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
            undefined,
            undefined,
            expect.objectContaining({ tables: ['threads'] }),
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
            undefined,
            undefined,
            undefined,
        );
    });
});
