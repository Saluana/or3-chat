import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMessage = vi.hoisted(() => vi.fn());
const upsertMessage = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({ messages: { get: getMessage } }));

vi.mock('~/db/messages', () => ({
    upsertMessageInDb: upsertMessage,
}));
vi.mock('~/db/util', () => ({ nowSec: () => 999 }));
vi.mock('~/db/files-util', () => ({
    serializeFileHashes: (hashes: string[]) => JSON.stringify(hashes),
}));

import { makeAssistantPersister, updateMessageRecord } from '../persistence';

describe('latest-row assistant persistence', () => {
    beforeEach(() => {
        getMessage.mockReset();
        upsertMessage.mockReset();
    });

    it('preserves concurrent metadata, edits and files while patching owned fields', async () => {
        const initial = {
            id: 'a1', thread_id: 't1', role: 'assistant', index: 1000,
            clock: 1, created_at: 1, updated_at: 1, deleted: false,
            pending: true, file_hashes: '["old-file"]',
            data: { content: 'stale', plugin_initial: true },
        } as any;
        getMessage.mockResolvedValue({
            ...initial,
            file_hashes: '["concurrent-file"]',
            data: {
                content: 'concurrent edit', plugin_initial: true,
                plugin_concurrent: { keep: true }, custom_terminal: 'value',
            },
        });

        const persist = makeAssistantPersister(dbMock as any, initial, []);
        await persist({ reasoning: 'new reasoning', toolCalls: [] });

        expect(upsertMessage).toHaveBeenCalledWith(
            dbMock,
            expect.objectContaining({
                file_hashes: '["concurrent-file"]',
                data: expect.objectContaining({
                    content: 'concurrent edit', plugin_initial: true,
                    plugin_concurrent: { keep: true }, custom_terminal: 'value',
                    reasoning_text: 'new reasoning', tool_calls: [],
                }),
            }),
        );
    });

    it('deep-merges message data against the latest row for ordinary patches', async () => {
        getMessage.mockResolvedValue({
            id: 'a1', thread_id: 't1', role: 'assistant', index: 1000,
            clock: 1, created_at: 1, updated_at: 1, deleted: false,
            data: { content: 'latest', plugin: 'preserve' },
        });

        await updateMessageRecord(dbMock as any, 'a1', {
            error: 'stopped', data: { generation_state: 'aborted' },
        } as any);

        expect(upsertMessage).toHaveBeenCalledWith(
            dbMock,
            expect.objectContaining({
                data: {
                    content: 'latest', plugin: 'preserve',
                    generation_state: 'aborted', error: 'stopped',
                },
            })
        );
    });
});
