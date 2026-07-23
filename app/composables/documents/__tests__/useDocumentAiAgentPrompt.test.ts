import { describe, expect, it } from 'vitest';
import {
    DOCUMENT_AI_WORKFLOW_INSTRUCTION,
    DOCUMENT_EDIT_TOOL,
    buildDocumentAiSystemPrompt,
    isForcedToolThinkingConflict,
    resolveDocumentAiToolStreamOptions,
} from '../useDocumentAiAgent';
import {
    clampDocumentAiMaxIterations,
    DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
    sanitizeDocumentAiSettings,
} from '../useDocumentAiSettings';
import { DOCUMENT_AI_AGENT_TOOLS } from '~/utils/documents/document-ai-tools';
import {
    validateToolArguments,
    validateToolDefinition,
} from '~~/shared/chat/tool-schema';

describe('Document AI model contract', () => {
    it('keeps the workflow prompt compact while covering the agent loop', () => {
        const prompt = buildDocumentAiSystemPrompt('Keep the author voice.');

        expect(prompt).toContain('Editable frozen content is the only writable source');
        expect(prompt).toContain('selection uses exactly one replace_selection');
        expect(prompt).toContain('Never invent refs');
        expect(prompt).toContain('valid TipTap JSON nodes');
        expect(prompt).toContain('Stage edits with propose_edits');
        expect(prompt).toContain('get_document_outline');
        expect(prompt).toContain('Empty or near-empty docs');
        expect(prompt).toContain('insert_end');
        expect(prompt).toContain('Editing preference');
        expect(prompt).toContain('Keep the author voice.');
        expect(DOCUMENT_AI_WORKFLOW_INSTRUCTION.split(/\s+/u).length).toBeLessThan(320);
    });

    it('publishes a valid multi-tool surface including propose_edits', () => {
        for (const tool of DOCUMENT_AI_AGENT_TOOLS) {
            expect(validateToolDefinition(tool)).toMatchObject({ valid: true });
        }
        expect(DOCUMENT_EDIT_TOOL.function.name).toBe('propose_edits');

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
    });

    it('uses auto tool choice and disables thinking when models would think by default', () => {
        expect(resolveDocumentAiToolStreamOptions({
            id: 'moonshotai/kimi-k3',
            supported_parameters: ['tools', 'reasoning'],
        })).toEqual({
            toolChoice: 'auto',
            reasoning: { effort: 'none' },
        });

        expect(resolveDocumentAiToolStreamOptions({
            id: 'openai/gpt-oss-120b',
            supported_parameters: ['tools'],
        })).toEqual({
            toolChoice: 'auto',
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

    it('sanitizes adjustable max iterations and chunk size', () => {
        expect(DEFAULT_DOCUMENT_AI_MAX_ITERATIONS).toBe(8);
        expect(clampDocumentAiMaxIterations(1)).toBe(2);
        expect(clampDocumentAiMaxIterations(99)).toBe(20);

        const settings = sanitizeDocumentAiSettings({
            maxIterations: 12,
            chunkWordLimit: 5000,
        });
        expect(settings.maxIterations).toBe(12);
        expect(settings.chunkWordLimit).toBe(5000);
    });
});
