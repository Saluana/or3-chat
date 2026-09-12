import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendMessageToDbMock = vi.hoisted(() => vi.fn(async () => ({ id: 'tool-1' })));

vi.mock('~/db/messages', () => ({
    appendMessageToDb: appendMessageToDbMock,
}));

vi.mock('~/db/client', () => ({
    getDb: () => {
        throw new Error('getDb should not be called when db is captured');
    },
}));

import { appendForegroundToolResult } from '../transcript-repository';

const call = {
    id: 'call-1',
    function: { name: 'echo', arguments: '{}' },
} as any;

function makeDb(opts: { thread?: boolean; parentThreadId?: string }) {
    return {
        name: 'or3-db-a',
        threads: { get: vi.fn(async () => (opts.thread ? { id: 'thread-a' } : undefined)) },
        messages: {
            get: vi.fn(async () =>
                opts.parentThreadId
                    ? { id: 'assistant-1', thread_id: opts.parentThreadId }
                    : undefined
            ),
        },
    } as any;
}

describe('appendForegroundToolResult workspace ownership', () => {
    beforeEach(() => {
        appendMessageToDbMock.mockClear();
    });

    it('writes to the captured database when ownership validates', async () => {
        const db = makeDb({ thread: true, parentThreadId: 'thread-a' });
        await appendForegroundToolResult({
            threadId: 'thread-a',
            turnId: 'user-1',
            parentAssistantId: 'assistant-1',
            call,
            status: 'complete',
            durableResult: 'ok',
            db,
        });

        expect(appendMessageToDbMock).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ thread_id: 'thread-a', role: 'tool' })
        );
    });

    it('refuses to write when the thread is missing from the captured database', async () => {
        const db = makeDb({ thread: false, parentThreadId: 'thread-a' });
        await expect(
            appendForegroundToolResult({
                threadId: 'thread-a',
                turnId: 'user-1',
                parentAssistantId: 'assistant-1',
                call,
                status: 'complete',
                durableResult: 'ok',
                db,
            })
        ).rejects.toThrow('thread thread-a not found');
        expect(appendMessageToDbMock).not.toHaveBeenCalled();
    });

    it('refuses to write when the parent belongs to another thread', async () => {
        const db = makeDb({ thread: true, parentThreadId: 'thread-other' });
        await expect(
            appendForegroundToolResult({
                threadId: 'thread-a',
                turnId: 'user-1',
                parentAssistantId: 'assistant-1',
                call,
                status: 'error',
                durableResult: 'err',
                error: 'boom',
                db,
            })
        ).rejects.toThrow('does not belong to thread');
        expect(appendMessageToDbMock).not.toHaveBeenCalled();
    });
});
