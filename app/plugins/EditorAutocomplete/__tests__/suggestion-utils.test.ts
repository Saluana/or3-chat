import { describe, expect, it } from 'vitest';
import { normalizeAutocompleteSuggestion } from '../suggestion-utils';

describe('normalizeAutocompleteSuggestion', () => {
    it('preserves a normal continuation and its leading space', () => {
        expect(normalizeAutocompleteSuggestion(' next thought', 'A complete sentence.')).toBe(' next thought');
    });

    it('removes a repeated phrase immediately before the cursor', () => {
        expect(normalizeAutocompleteSuggestion(
            'with all the meetings today, haha',
            "What's up with all ",
        )).toBe('the meetings today, haha');
    });

    it('removes a repeated full line returned by the model', () => {
        expect(normalizeAutocompleteSuggestion(
            'Just wanted to check if you got my last update.',
            'Just wanted to check ',
        )).toBe('if you got my last update.');
    });

    it('does not strip short overlaps that may be intentional', () => {
        expect(normalizeAutocompleteSuggestion('haha', 'ha')).toBe('haha');
    });

    it('drops whitespace-only suggestions', () => {
        expect(normalizeAutocompleteSuggestion('  \n', 'Some text')).toBe('');
    });
});

