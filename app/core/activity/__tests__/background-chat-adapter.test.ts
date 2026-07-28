import { describe, expect, it, vi } from 'vitest';
import {
    BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
    backgroundChatActivityStatus,
    createBackgroundChatActivitySource,
    type BackgroundChatActivityRecord,
    type BackgroundChatActivityUpdate,
} from '../adapters/background-chat';

function record(
    overrides: Partial<BackgroundChatActivityRecord> = {}
): BackgroundChatActivityRecord {
    return {
        jobId: 'job-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        status: 'streaming',
        startedAt: 1_753_610_400,
        updatedAt: 1_753_614_000,
        model: 'model-1',
        content: 'Hello',
        ...overrides,
    };
}

describe('background chat Activity adapter', () => {
    it('normalizes all canonical statuses', () => {
        expect(backgroundChatActivityStatus('streaming')).toBe('running');
        expect(backgroundChatActivityStatus('complete')).toBe('succeeded');
        expect(backgroundChatActivityStatus('error')).toBe('failed');
        expect(backgroundChatActivityStatus('aborted')).toBe('cancelled');
    });

    it('lists recent records and advertises only real actions', async () => {
        const cancel = vi.fn(() => true);
        const source = createBackgroundChatActivitySource({
            store: {
                async list() {
                    return [record()];
                },
                async get() {
                    return record();
                },
            },
            actions: { cancel },
        });
        const result = await source.listRuns({});
        expect(result).toMatchObject({
            ok: true,
            value: [
                {
                    id: 'job-1',
                    sourceId: BACKGROUND_CHAT_ACTIVITY_SOURCE_ID,
                    status: 'running',
                    actions: ['cancel'],
                },
            ],
        });
    });

    it('normalizes content, tool and error detail events', async () => {
        const item = record({
            status: 'error',
            error: 'offline',
            toolCalls: [
                {
                    id: 'tool-1',
                    name: 'search',
                    status: 'complete',
                    result: 'done',
                },
            ],
        });
        const source = createBackgroundChatActivitySource({
            store: {
                async list() {
                    return [item];
                },
                async get() {
                    return item;
                },
            },
        });
        const result = await source.getRun?.('job-1');
        expect(result?.ok).toBe(true);
        if (!result?.ok) return;
        expect(result.value.events.map((event) => event.type)).toEqual(
            expect.arrayContaining(['status', 'message', 'tool', 'error'])
        );
        expect(result.value.error).toBe('offline');
    });

    it('streams updates and releases its canonical subscription', () => {
        let listener:
            | ((update: BackgroundChatActivityUpdate) => void)
            | undefined;
        const dispose = vi.fn();
        const onEvent = vi.fn();
        const source = createBackgroundChatActivitySource({
            store: {
                async list() {
                    return [];
                },
                async get() {
                    return undefined;
                },
            },
            updates: {
                subscribe(next) {
                    listener = next;
                    return dispose;
                },
            },
        });
        const unsubscribe = source.subscribe?.({ onEvent });
        listener?.({ record: record(), delta: 'Hi' });
        expect(onEvent).toHaveBeenCalled();
        unsubscribe?.();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('dispatches real cancellation and reports rejection', async () => {
        const cancel = vi
            .fn<() => Promise<boolean>>()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const source = createBackgroundChatActivitySource({
            store: {
                async list() {
                    return [record()];
                },
                async get() {
                    return record();
                },
            },
            actions: { cancel },
        });
        expect(
            await source.executeAction?.({
                runId: 'job-1',
                action: 'cancel',
            })
        ).toEqual({ ok: true, value: undefined });
        expect(
            await source.executeAction?.({
                runId: 'job-1',
                action: 'cancel',
            })
        ).toMatchObject({
            ok: false,
            error: { code: 'source_failure' },
        });
    });
});

