import { describe, expect, it } from 'vitest';
import { markdownToTipTapDoc } from '../markdownToTipTapDoc';

describe('markdownToTipTapDoc', () => {
    it('converts long structured Markdown without dropping its content', () => {
        const section = [
            '## Swag Is Different for Everyone',
            '',
            'Swag is personal. What looks cool on one person may look silly on someone else.',
            '',
            '- Clothes',
            '- Haircuts',
            '- Shoes',
            '',
        ].join('\n');
        const source = [
            '# Swag: The Art of Looking Cool Without Trying Too Hard',
            '',
            ...Array.from({ length: 80 }, () => section),
        ].join('\n');

        const result = markdownToTipTapDoc(source);

        expect(result.type).toBe('doc');
        expect(result.content?.[0]).toMatchObject({
            type: 'heading',
            attrs: { level: 1 },
        });
        expect(JSON.stringify(result)).toContain(
            'Swag Is Different for Everyone'
        );
        expect(JSON.stringify(result)).toContain('Haircuts');
    });

    it('returns a valid empty TipTap document for blank Markdown', () => {
        expect(markdownToTipTapDoc('   ')).toEqual({
            type: 'doc',
            content: [],
        });
    });
});
