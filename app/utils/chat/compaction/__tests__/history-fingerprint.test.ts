import { describe, expect, it } from 'vitest';
import type { Message, Thread } from '~/db/schema';
import { requestHistoryFingerprint, type ThreadProjection } from '../history';

// Ways this can fail:
// - a re-materialized row with the same content but a different key order
//   reads as a changed conversation and silently drops the next send
// - nested `data` key order does the same
// - a real content edit is no longer detected
// - a message reorder is no longer detected (array order must still count)
// - deliberately ignored sync fields start counting as changes

const thread = { id: 't1', parent_thread_id: null, anchor_message_id: null, anchor_index: null, branch_mode: null,
    root_thread_id: 't1', summary_message_id: null, fork_reason: null, project_id: null, system_prompt_id: null,
    status: 'ready', deleted: false } as unknown as Thread;

function message(id: string, content: string, extra: Record<string, unknown> = {}): Message {
    return { id, thread_id: 't1', role: 'assistant', deleted: false, pending: false,
        data: { content, usage: { prompt_tokens: 9, completion_tokens: 4 }, tool_calls: [] }, ...extra } as unknown as Message;
}

function reversedKeys<T>(value: T): T {
    if (Array.isArray(value)) return value.map(reversedKeys) as T;
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reversedKeys(entry)])) as T;
}

function projection(messages: Message[]): ThreadProjection {
    return { messages, segments: [{ thread, rows: messages, visible: messages }] };
}

describe('requestHistoryFingerprint', () => {
    it('ignores key order at every depth', () => {
        const rows = [message('m1', 'hello'), message('m2', 'reply')];
        expect(requestHistoryFingerprint(projection(rows.map(reversedKeys))))
            .toBe(requestHistoryFingerprint(projection(rows)));
    });

    it('detects a content change', () => {
        expect(requestHistoryFingerprint(projection([message('m1', 'hello')])))
            .not.toBe(requestHistoryFingerprint(projection([message('m1', 'edited')])));
    });

    it('detects a reorder', () => {
        const [a, b] = [message('m1', 'hello'), message('m2', 'reply')];
        expect(requestHistoryFingerprint(projection([a, b])))
            .not.toBe(requestHistoryFingerprint(projection([b, a])));
    });

    it('still ignores sync ordering and job bookkeeping', () => {
        const base = message('m1', 'hello');
        const synced = { ...base, clock: 7, hlc: 'h', op_id: 'op', order_key: 'k',
            data: { ...(base.data as object), background_job_id: 'j', background_job_attempt: 2 } } as unknown as Message;
        expect(requestHistoryFingerprint(projection([synced]))).toBe(requestHistoryFingerprint(projection([base])));
    });
});
