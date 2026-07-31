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
        });
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
