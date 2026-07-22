import { describe, expect, it } from 'vitest';
import {
    DOCUMENT_AI_FORCED_TOOL_CHOICE,
    DOCUMENT_AI_WORKFLOW_INSTRUCTION,
    DOCUMENT_EDIT_TOOL,
    buildDocumentAiSystemPrompt,
    isForcedToolThinkingConflict,
    resolveDocumentAiToolStreamOptions,
} from '../useDocumentAiAgent';
import {
    validateToolArguments,
    validateToolDefinition,
} from '~~/shared/chat/tool-schema';

describe('Document AI model contract', () => {
    it('keeps the workflow prompt compact while covering hard boundaries', () => {
        const prompt = buildDocumentAiSystemPrompt('Keep the author voice.');

        expect(prompt).toContain('Editable frozen content is the only writable source');
        expect(prompt).toContain('selection uses exactly one replace_selection');
        expect(prompt).toContain('Never invent refs');
        expect(prompt).toContain('valid TipTap JSON nodes');
        expect(prompt).toContain('Call propose_document_edits exactly once');
        expect(prompt).toContain('Editing preference');
        expect(prompt).toContain('Keep the author voice.');
        expect(DOCUMENT_AI_WORKFLOW_INSTRUCTION.split(/\s+/u).length).toBeLessThan(190);
    });

    it('publishes a valid tool schema with exact operation requirements', () => {
        expect(validateToolDefinition(DOCUMENT_EDIT_TOOL)).toMatchObject({ valid: true });

        const schema = DOCUMENT_EDIT_TOOL.function.parameters;
        expect(validateToolArguments(JSON.stringify({
            operations: [{
                kind: 'replace_block',
                ref: 'b2',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }],
            }],
        }), schema)).toMatchObject({ valid: true });

        expect(validateToolArguments(JSON.stringify({
            operations: [{ kind: 'replace_block', ref: 'b2' }],
        }), schema)).toMatchObject({ valid: false });

        expect(validateToolArguments(JSON.stringify({
            operations: [{ kind: 'insert_end', ref: 'b2', content: [{ type: 'paragraph' }] }],
        }), schema)).toMatchObject({ valid: false });
    });

    it('disables thinking when forcing the edit tool on reasoning/Kimi models', () => {
        expect(resolveDocumentAiToolStreamOptions({
            id: 'moonshotai/kimi-k3',
            supported_parameters: ['tools', 'reasoning'],
        })).toEqual({
            toolChoice: DOCUMENT_AI_FORCED_TOOL_CHOICE,
            reasoning: { effort: 'none' },
        });

        expect(resolveDocumentAiToolStreamOptions({
            id: 'openai/gpt-oss-120b',
            supported_parameters: ['tools'],
        })).toEqual({
            toolChoice: DOCUMENT_AI_FORCED_TOOL_CHOICE,
        });

        expect(resolveDocumentAiToolStreamOptions({
            id: 'anthropic/claude-sonnet',
            supported_parameters: ['tools', 'reasoning'],
            reasoning: { mandatory: true, supported_efforts: ['high'] },
        })).toEqual({
            toolChoice: 'auto',
        });
    });

    it('detects Moonshot forced-tool + thinking conflicts for retry', () => {
        expect(isForcedToolThinkingConflict(
            new Error("tool_choice 'specified' is incompatible with thinking enabled"),
        )).toBe(true);
        expect(isForcedToolThinkingConflict(new Error('rate limited'))).toBe(false);
    });
});
