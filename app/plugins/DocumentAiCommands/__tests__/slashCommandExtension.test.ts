import { describe, expect, it, vi } from 'vitest';
import { createDocumentAiActionSuggestion } from '../suggestions';
import { searchDocumentAiPromptActions } from '../slashCommandExtension';

vi.mock('../DocumentAiActionPopover.vue', () => ({ default: {} }));

const saved = [
    { id: 'improve', label: 'Improve writing', prompt: 'Improve clarity and flow.', defaultScope: 'section' as const },
    { id: 'shorten', label: 'Make concise', prompt: 'Remove unnecessary words.', defaultScope: 'selection' as const },
];
const plugin = [
    { id: 'legal', label: 'Legal review', prompt: 'Find unsupported legal claims.' },
];

describe('Document AI slash commands', () => {
    it('groups matching saved and plugin actions without losing their source', () => {
        expect(searchDocumentAiPromptActions('', saved, plugin).map((item) => item.source)).toEqual([
            'saved',
            'saved',
            'plugin',
        ]);
        expect(searchDocumentAiPromptActions('legal', saved, plugin)).toEqual([
            expect.objectContaining({ id: 'legal', source: 'plugin' }),
        ]);
        expect(searchDocumentAiPromptActions('unnecessary', saved, plugin)).toEqual([
            expect.objectContaining({ id: 'shorten', source: 'saved' }),
        ]);
    });

    it('only allows the slash trigger at the start of the composer', () => {
        const suggestion = createDocumentAiActionSuggestion(async () => [], vi.fn());
        const allow = suggestion.allow as (payload: { range: { from: number } }) => boolean;
        expect(allow({ range: { from: 1 } })).toBe(true);
        expect(allow({ range: { from: 4 } })).toBe(false);
    });

    it('replaces the slash query with prompt text and does not submit', () => {
        const select = vi.fn();
        const suggestion = createDocumentAiActionSuggestion(async () => [], select);
        const calls: string[] = [];
        const chain = {
            focus: () => { calls.push('focus'); return chain; },
            deleteRange: () => { calls.push('deleteRange'); return chain; },
            insertContent: () => { calls.push('insertContent'); return chain; },
            run: () => { calls.push('run'); return true; },
        };
        const action = { ...saved[0]!, source: 'saved' as const };
        suggestion.command?.({
            editor: { chain: () => chain },
            range: { from: 1, to: 4 },
            props: action,
        } as never);
        expect(calls).toEqual(['focus', 'deleteRange', 'insertContent', 'run']);
        expect(select).toHaveBeenCalledWith(action);
    });
});
