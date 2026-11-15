import { describe, expect, it } from 'vitest';
import { buildEscapedSnippet, stripMarkdown } from '../snippets';

describe('command palette snippets', () => {
    it('removes emphasis, headings, lists, quotes, code and link syntax', () => {
        const markdown = [
            '## Plan',
            '> **Bold** and *italic* and __strong__ and _soft_ and ~~gone~~',
            '- item with `inline code`',
            '1. see [the docs](https://example.com/x) and ![chart](a.png)',
            '```ts',
            'const total = 1;',
            '```',
        ].join('\n');
        expect(stripMarkdown(markdown)).toBe([
            'Plan',
            'Bold and italic and strong and soft and gone',
            'item with inline code',
            'see the docs and chart',
            '',
            'const total = 1;',
            '',
        ].join('\n'));
    });

    it('keeps identifiers, arithmetic and unbalanced markers intact', () => {
        expect(stripMarkdown('call my_helper_fn with 2*3*4')).toBe('call my_helper_fn with 2*3*4');
        expect(stripMarkdown('a lone * star and **open')).toBe('a lone * star and **open');
    });

    it('builds the snippet from the visible text', () => {
        expect(buildEscapedSnippet('Some **cheese** facts', 'cheese')).toBe('Some cheese facts');
    });

    it('finds a distant match without parsing an entire malformed document', () => {
        const text = '['.repeat(100_000) + ' **東京** and more';
        expect(buildEscapedSnippet(text, '東京')).toContain('東京');
        expect(buildEscapedSnippet(text, 'missing')).toHaveLength(161);
    });
});
