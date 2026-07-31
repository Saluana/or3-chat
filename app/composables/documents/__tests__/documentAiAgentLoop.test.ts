import { describe, expect, it } from 'vitest';
import {
    buildAssistantToolCallMessage,
    buildToolResultMessage,
} from '../documentAiAgentLoop';

describe('documentAiAgentLoop message builders', () => {
    it('omits empty assistant text so Moonshot does not reject the follow-up turn', () => {
        const message = buildAssistantToolCallMessage({
            assistantText: '   ',
            toolCalls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'get_document_outline', arguments: '{}' },
            }],
        });

        expect(message.content).toBeUndefined();
        expect(message.tool_calls).toHaveLength(1);
        expect(JSON.stringify(message)).not.toContain('"text":""');
    });

    it('keeps non-empty assistant prose when present', () => {
        const message = buildAssistantToolCallMessage({
            assistantText: 'Reading the outline next.',
            toolCalls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'propose_edits', arguments: '{}' },
            }],
        });

        expect(message.content).toEqual([{
            type: 'text',
            text: 'Reading the outline next.',
        }]);
    });

    it('never sends empty tool result text', () => {
        expect(buildToolResultMessage({
            toolCallId: 'call_1',
            name: 'get_document_outline',
            resultText: '  ',
        }).content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
    });
});
