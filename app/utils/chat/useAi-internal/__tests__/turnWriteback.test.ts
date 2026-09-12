import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('dexie', () => ({
    default: { minKey: -Infinity, maxKey: Infinity },
}));

vi.mock('~/db/messages', () => ({
    compareMessageOrder: (
        a: { index?: number; order_key?: string; id: string },
        b: { index?: number; order_key?: string; id: string }
    ) =>
        (a.index ?? 0) - (b.index ?? 0) ||
        (a.order_key ?? '').localeCompare(b.order_key ?? '') ||
        a.id.localeCompare(b.id),
}));

import { reloadTurnIntoRawMessages } from '../turnWriteback';

function makeDb(rows: any[]) {
    return {
        messages: {
            where: () => ({
                between: () => ({
                    filter: (fn: (row: any) => boolean) => ({
                        toArray: async () => rows.filter(fn),
                    }),
                }),
            }),
        },
    } as any;
}

const assistantRow = {
    id: 'a1',
    thread_id: 't1',
    role: 'assistant',
    index: 2,
    clock: 2,
    created_at: 2,
    updated_at: 2,
    deleted: false,
    pending: false,
    stream_id: 's1',
    file_hashes: null,
    error: null,
    data: {
        transcript_version: 1,
        transcript_kind: 'assistant',
        turn_id: 'u1',
        parent_turn_id: 'u1',
        content: 'finished answer',
        reasoning_text: null,
        tool_calls: [{ id: 'c1', name: 'lookup', args: '{}', status: 'loading' }],
    },
};

const toolRow = {
    id: 'tool-1',
    thread_id: 't1',
    role: 'tool',
    index: 3,
    clock: 3,
    created_at: 3,
    updated_at: 3,
    deleted: false,
    data: {
        transcript_version: 1,
        transcript_kind: 'tool_result',
        turn_id: 'u1',
        parent_turn_id: 'a1',
        parent_assistant_id: 'a1',
        tool_call_id: 'c1',
        tool_name: 'lookup',
        content: 'tool output',
    },
};

describe('reloadTurnIntoRawMessages', () => {
    it('replaces the empty placeholder and inserts missing tool rows', async () => {
        const db = makeDb([assistantRow, toolRow]);
        const rawMessages = ref([
            { id: 'u1', role: 'user', content: 'question' },
            { id: 'a1', role: 'assistant', content: '' },
        ]) as any;

        await reloadTurnIntoRawMessages(db, 't1', 'a1', rawMessages);

        const assistant = rawMessages.value.find((m: any) => m.id === 'a1');
        expect(assistant).toMatchObject({ content: 'finished answer' });
        const tool = rawMessages.value.find((m: any) => m.id === 'tool-1');
        expect(tool).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
        expect(rawMessages.value.map((m: any) => m.id)).toEqual([
            'u1',
            'a1',
            'tool-1',
        ]);
        // Parent tool-call state reconciles against the durable tool row.
        expect(assistant.data.tool_calls?.[0]).toMatchObject({
            id: 'c1',
            status: 'complete',
            result: 'tool output',
        });
    });

    it('does nothing when the view moved to another thread', async () => {
        const db = makeDb([assistantRow, toolRow]);
        const rawMessages = ref([
            { id: 'a1', role: 'assistant', content: '' },
        ]) as any;
        const threadIdRef = { value: 't2' };

        await reloadTurnIntoRawMessages(db, 't1', 'a1', rawMessages, threadIdRef as any);

        expect(rawMessages.value).toEqual([
            { id: 'a1', role: 'assistant', content: '' },
        ]);
    });

    it('does nothing when the assistant row is absent', async () => {
        const db = makeDb([toolRow]);
        const rawMessages = ref([
            { id: 'a1', role: 'assistant', content: '' },
        ]) as any;

        await reloadTurnIntoRawMessages(db, 't1', 'a1', rawMessages);

        expect(rawMessages.value).toEqual([
            { id: 'a1', role: 'assistant', content: '' },
        ]);
    });
});
