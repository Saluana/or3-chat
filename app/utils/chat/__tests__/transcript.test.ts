import { describe, expect, it } from 'vitest';
import type { Message } from '~/db/schema';
import {
    projectTranscriptForOpenRouter,
    projectTranscriptForUi,
    storedMessagesToCanonicalTranscript,
} from '../transcript';

const row = (input: Partial<Message> & Pick<Message, 'id' | 'role' | 'index'>): Message => ({
    id: input.id,
    role: input.role,
    index: input.index,
    thread_id: 'thread-1',
    data: input.data ?? null,
    pending: input.pending,
    stream_id: input.stream_id,
    file_hashes: input.file_hashes,
    error: input.error,
    deleted: false,
    clock: 1,
    created_at: input.created_at ?? input.index,
    updated_at: input.updated_at ?? input.index,
});

describe('canonical transcript projections', () => {
    it('keeps reused tool-call IDs paired with their own assistant across turns and branches', () => {
        const assistant = (id: string, index: number, result: string) => row({ id, role: 'assistant', index,
            data: { content: id, tool_calls: [{ id: 'call-0', name: 'lookup', args: '{}', status: 'complete', result }] } });
        const records = storedMessagesToCanonicalTranscript([
            assistant('a1', 1, 'First saved result'),
            row({ id: 't1', role: 'tool', index: 2, data: { parent_assistant_id: 'a1', tool_call_id: 'call-0', tool_name: 'lookup', content: 'First durable result' } }),
            assistant('a2', 3, 'Second saved result'),
            { ...row({ id: 't-other', role: 'tool', index: 4, data: { parent_assistant_id: 'a2', tool_call_id: 'call-0', tool_name: 'lookup', content: 'Foreign result' } }), thread_id: 'other-thread' },
        ]);
        expect(records[0]?.toolCalls[0]?.result).toBe('First durable result');
        expect(records[2]?.toolCalls[0]?.result).toBe('Second saved result');
        const wire = projectTranscriptForOpenRouter(records);
        expect(wire.find(message => message.id === 'a2:tool-result:call-0')?.content).toBe('Second saved result');
        expect(projectTranscriptForUi(records).find(message => message.id === 'a2')?.toolResultMessageIds).toBeUndefined();
    });
    // Background and legacy turns can retain results on the assistant only.
    // Losing those results makes the next provider request invalid; emitting
    // them twice when durable tool rows exist is invalid too.
    it('replays embedded tool results once after reload without changing stored history', async () => {
        const rows = [row({ id: 'a', role: 'assistant', index: 1, data: {
            content: 'The file code is FILE-AO-942.', tool_calls: [
                { id: 'lookup-1', name: 'workspace_search', args: '{}', status: 'complete', result: 'FILE-AO-942' },
                { id: 'lookup-2', name: 'workspace_search', args: '{}', status: 'error',
                    transcript: { transcriptVersion: 1, kind: 'tool_result', callId: 'lookup-2', toolName: 'workspace_search',
                        status: 'error', result: 'File unavailable', error: 'File unavailable' } },
            ],
        } }), row({ id: 'u', role: 'user', index: 2, data: { content: 'Recall the file code.' } })];
        const before = JSON.stringify(rows);
        const { buildOpenRouterMessages } = await import('~/core/auth/openrouter-build');
        const wire = await buildOpenRouterMessages(projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript(rows)));
        expect(wire.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
        expect(wire[1]).toMatchObject({ tool_call_id: 'lookup-1', content: [{ type: 'text', text: 'FILE-AO-942' }] });
        expect(wire[2]).toMatchObject({ tool_call_id: 'lookup-2', content: [{ type: 'text', text: 'File unavailable' }] });
        expect(JSON.stringify(rows)).toBe(before);
        const withDurableResult = storedMessagesToCanonicalTranscript([rows[0]!, row({ id: 't', role: 'tool', index: 1.5,
            data: { parent_assistant_id: 'a', tool_call_id: 'lookup-1', tool_name: 'workspace_search', content: 'durable result' } }), rows[1]!]);
        const replay = projectTranscriptForOpenRouter(withDurableResult);
        expect(replay.filter((message) => message.role === 'tool' && message.tool_call_id === 'lookup-1')).toHaveLength(1);
        expect(replay.find((message) => message.id === 't')?.content).toBe('durable result');
        expect(projectTranscriptForUi(storedMessagesToCanonicalTranscript(rows)).map((message) => message.id)).toEqual(['a', 'u']);
    });
    it('preserves validated host compaction/usage on reload while sending only summary text on the provider wire', async () => {
        const compaction = { version: 1, compaction_id: 'compact-1', source_thread_id: 'source', anchor_message_id: 'anchor',
            anchor_index: 7, generated_at: 100, model: 'model', message_count: 3, prior_message_count: 0,
            summary_markdown: 'Summary reference', landmarks: [{ message_id: 'anchor', kind: 'decision', summary: 'Chosen option',
                index: 7, role: 'assistant', thread_id: 'source' }],
            history_scope: { version: 1, segments: [{ thread_id: 'source', messages: [{ message_id: 'anchor', clock: 3 }] }] } };
        const usage = { prompt_tokens: 250, completion_tokens: 40, model: 'model', request_id: 'request', iteration: 0,
            measured_at: 100, prefix_message_count: 2, prefix_hash: 'private-prefix', configuration_hash: 'private-config', input_estimate_tokens: 240 };
        const records = storedMessagesToCanonicalTranscript([
            row({ id: 'summary', role: 'system', index: 0, data: { kind: 'compaction', content: 'Historical summary and landmarks', compaction } }),
            row({ id: 'answer', role: 'assistant', index: 1, data: { content: 'New answer', usage } }),
            row({ id: 'malformed', role: 'assistant', index: 2, data: { content: 'Still readable', usage: { ...usage, prompt_tokens: -1 } } }),
            row({ id: 'ordinary', role: 'user', index: 3, data: { kind: 'compaction', content: 'Ordinary user content', compaction } }),
        ]);
        const ui = projectTranscriptForUi(records);
        expect(ui[0]).toMatchObject({ role: 'system', compaction });
        expect(ui[1]?.compaction).toBeUndefined();
        expect(ui[3]).toMatchObject({ role: 'user', text: 'Ordinary user content' });
        expect(ui[3]?.compaction).toBeUndefined();
        const projected = projectTranscriptForOpenRouter(records);
        expect(projected[0]?.data).toMatchObject({ kind: 'compaction', compaction });
        expect(projected[1]?.data).toMatchObject({ usage });
        expect(projected[2]?.data?.usage).toBeUndefined();
        expect(projected[2]?.content).toBe('Still readable');
        const { buildOpenRouterMessages } = await import('~/core/auth/openrouter-build');
        const wire = await buildOpenRouterMessages(projected);
        expect(wire[0]).toMatchObject({ role: 'system', content: [{ type: 'text', text: 'Historical summary and landmarks' }] });
        expect(JSON.stringify(wire)).not.toMatch(/history_scope|prefix_hash|private-prefix|compaction_id/);
    });
    it('round-trips user, assistant call, result, reasoning, files and generation relationships', () => {
        const records = storedMessagesToCanonicalTranscript([
            row({
                id: 'u1', role: 'user', index: 1000,
                file_hashes: '["file-1"]',
                data: {
                    transcript_version: 1, transcript_kind: 'user',
                    turn_id: 'u1', content: 'question',
                },
            }),
            row({
                id: 'a1', role: 'assistant', index: 2000, pending: true,
                stream_id: 'generation-1',
                data: {
                    transcript_version: 1, transcript_kind: 'assistant',
                    turn_id: 'u1', parent_turn_id: 'u1', content: 'checking',
                    reasoning_text: 'plan', generation_id: 'generation-1',
                    request_id: 'request-1', generation_mode: 'foreground',
                    generation_state: 'streaming',
                    tool_calls: [{
                        id: 'call-1', name: 'lookup', args: '{"q":"x"}',
                        status: 'loading', fingerprint: 'fp-1',
                    }],
                },
            }),
            row({
                id: 't1', role: 'tool', index: 3000,
                data: {
                    transcript_version: 1, transcript_kind: 'tool_result',
                    turn_id: 'u1', parent_turn_id: 'a1', parent_assistant_id: 'a1',
                    tool_call_id: 'call-1', tool_name: 'lookup',
                    tool_status: 'complete', content: 'answer',
                },
            }),
        ]);

        expect(records[1]).toMatchObject({
            turnId: 'u1', parentTurnId: 'u1', reasoning: 'plan',
            generation: {
                generationId: 'generation-1', requestId: 'request-1',
                mode: 'foreground', state: 'streaming',
            },
            toolCalls: [{
                callId: 'call-1', parentAssistantId: 'a1',
                status: 'complete', result: 'answer', fingerprint: 'fp-1',
            }],
        });

        const provider = projectTranscriptForOpenRouter(records);
        expect(provider[1]).toMatchObject({
            role: 'assistant', reasoning_text: 'plan',
            tool_calls: [{
                id: 'call-1', type: 'function',
                function: { name: 'lookup', arguments: '{"q":"x"}' },
            }],
        });
        expect(provider[2]).toMatchObject({
            role: 'tool', tool_call_id: 'call-1', name: 'lookup', content: 'answer',
        });

        const ui = projectTranscriptForUi(records);
        expect(ui).toHaveLength(2);
        expect(ui[1]).toMatchObject({
            id: 'a1', reasoning_text: 'plan',
            toolCalls: [{ id: 'call-1', status: 'complete', result: 'answer' }],
            toolResultMessageIds: ['t1'],
        });
        for (const change of [{ threadId: 'another-thread' }, { parentAssistantId: 'another-assistant' }, { callId: 'another-call' }]) {
            expect(projectTranscriptForUi([records[0]!, records[1]!, { ...records[2]!, ...change }])[1]?.toolResultMessageIds).toBeUndefined();
        }
        expect(provider[1]).not.toHaveProperty('toolResultMessageIds');
    });

    it('reloads the same canonical assistant state from mixed and malformed fields', () => {
        const [record] = storedMessagesToCanonicalTranscript([
            row({
                id: 'a2',
                role: 'assistant',
                index: 4000,
                data: {
                    content: 'persisted answer',
                    reasoning_text: 'persisted reasoning',
                    tool_calls: [
                        null,
                        { id: '', name: 'invalid' },
                        {
                            id: 'call-2',
                            type: 'function',
                            function: {
                                name: 'search',
                                arguments: '{"q":"first"}',
                            },
                        },
                        {
                            id: 'call-2',
                            name: 'search',
                            args: '{"q":"latest"}',
                            status: 'complete',
                            result: 'found',
                        },
                    ],
                },
            }),
        ]);

        expect(record).toMatchObject({
            content: 'persisted answer',
            reasoning: 'persisted reasoning',
            toolCalls: [
                {
                    callId: 'call-2',
                    name: 'search',
                    arguments: '{"q":"latest"}',
                    status: 'complete',
                    result: 'found',
                },
            ],
        });
        expect(projectTranscriptForUi([record!])[0]).toMatchObject({
            text: 'persisted answer',
            reasoning_text: 'persisted reasoning',
            toolCalls: [
                {
                    id: 'call-2',
                    name: 'search',
                    args: '{"q":"latest"}',
                    status: 'complete',
                    result: 'found',
                },
            ],
        });
        expect(projectTranscriptForOpenRouter([record!])[0]).toMatchObject({
            role: 'assistant',
            content: 'persisted answer',
            reasoning_text: 'persisted reasoning',
            tool_calls: [
                {
                    id: 'call-2',
                    function: {
                        name: 'search',
                        arguments: '{"q":"latest"}',
                    },
                },
            ],
        });
    });
});
