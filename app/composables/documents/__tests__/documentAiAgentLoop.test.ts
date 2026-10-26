import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { freezeDocumentForAi } from '~/utils/documents/document-ai-operations';
import {
    buildAssistantToolCallMessage,
    buildToolResultMessage,
    runDocumentAiAgentLoop,
} from '../documentAiAgentLoop';

const controls = vi.hoisted(() => ({ stream: vi.fn(), execute: vi.fn() }));
vi.mock('~/utils/chat/openrouterStream', () => ({ openRouterStreamWithRetry: controls.stream }));
vi.mock('~/utils/documents/document-ai-registry-tools', () => ({ executeDocumentAiRegistryTool: controls.execute }));

it.each(['after response', 'during tool'] as const)('stops scheduling tools and turns when disconnected %s', async phase => {
    const controller = new AbortController();
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Original</p>' });
    const names = ['external_a', 'external_b'];
    controls.stream.mockReset().mockImplementation(async function* () {
        for (const name of names) yield { type: 'tool_call', tool_call: { id: name, type: 'function', function: { name, arguments: '{}' } } };
        if (phase === 'after response') controller.abort();
    });
    controls.execute.mockReset().mockImplementation(async () => {
        controller.abort();
        return '{"ok":true}';
    });
    try {
        await expect(runDocumentAiAgentLoop({
            apiKey: null, modelId: 'audit-model', orMessages: [], signal: controller.signal, maxIterations: 2,
            tools: names.map(name => ({ type: 'function', function: { name, description: 'Synthetic tool', parameters: { type: 'object', properties: {} } } })),
            enabledTools: { external_a: true, external_b: true },
            toolContext: { editor, snapshot: freezeDocumentForAi(editor), scope: 'document', allowedRefs: new Set(['b1']), chunkWordLimit: 2000 },
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(controls.stream).toHaveBeenCalledOnce();
        expect(controls.execute).toHaveBeenCalledTimes(phase === 'after response' ? 0 : 1);
    } finally { editor.destroy(); }
});

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
