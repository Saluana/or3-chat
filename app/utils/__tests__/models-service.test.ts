import { describe, it, expect } from 'vitest';
import { extractReasoning } from '../models-service';

describe('extractReasoning', () => {
    it('should extract reasoning string', () => {
        const input = { reasoning: 'This is my reasoning' };
        const result = extractReasoning(input);
        expect(result).toEqual({ reasoning_content: 'This is my reasoning' });
    });

    it('should extract reasoning_details array', () => {
        const input = {
            reasoning_details: [
                { type: 'reasoning.text', text: 'First part' },
                { type: 'reasoning.summary', summary: 'Summary here' },
                { type: 'reasoning.text', text: 'Second part' },
            ],
        };
        const result = extractReasoning(input);
        expect(result).toEqual({
            reasoning_content: 'First part\n\nSummary here\n\nSecond part',
            reasoning_details: input.reasoning_details,
        });
    });

    it('should handle empty reasoning string', () => {
        const input = { reasoning: '' };
        const result = extractReasoning(input);
        expect(result).toEqual({});
    });

    it('should handle empty reasoning_details array', () => {
        const input = { reasoning_details: [] };
        const result = extractReasoning(input);
        expect(result).toEqual({});
    });

    it('should handle malformed reasoning_details', () => {
        const input = {
            reasoning_details: [
                null,
                { type: 'reasoning.text', text: 'Valid' },
            ],
        };
        const result = extractReasoning(input);
        expect(result).toEqual({
            reasoning_content: 'Valid',
            reasoning_details: input.reasoning_details,
        });
    });

    it('should return empty object for no reasoning', () => {
        const input = { content: 'Some content' };
        const result = extractReasoning(input);
        expect(result).toEqual({});
    });

    it('should return empty object for null input', () => {
        const result = extractReasoning(null);
        expect(result).toEqual({});
    });
});
