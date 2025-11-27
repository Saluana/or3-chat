import { describe, it, expect } from 'vitest';
import { partsToText, ensureUiMessage } from '~/utils/chat/uiMessages';

function img(url: string) {
    return { type: 'image', image: url };
}
function txt(t: string) {
    return { type: 'text', text: t };
}

describe('uiMessages utilities', () => {
    it('partsToText concatenates text parts', () => {
        const out = partsToText([txt('Hello'), txt(' '), txt('World')]);
        expect(out).toBe('Hello World');
    });
    it('partsToText inserts markdown for images with spacing (assistant only)', () => {
        // Assistant role - images should be converted to markdown
        const outAssistant = partsToText(
            [txt('A'), img('data:image/png;base64,xxx'), txt('B')],
            'assistant'
        );
        expect(outAssistant).toContain('A');
        expect(outAssistant).toContain(
            '![generated image](data:image/png;base64,xxx)'
        );
        expect(outAssistant.endsWith('B')).toBe(true);

        // User role - images should be skipped (shown via attachments gallery)
        const outUser = partsToText(
            [txt('A'), img('data:image/png;base64,xxx'), txt('B')],
            'user'
        );
        expect(outUser).toContain('A');
        expect(outUser).not.toContain('data:image/png;base64,xxx');
        expect(outUser).toContain('B');
    });
    it('partsToText handles empty / invalid gracefully', () => {
        expect(partsToText(null)).toBe('');
        expect(partsToText({} as any)).toBe('');
    });
    it('ensureUiMessage passes through already normalized', () => {
        const normalized = { id: '1', role: 'user' as const, text: 'hi' };
        const ensured = ensureUiMessage(normalized);
        // Behavior now: returns a (possibly) cloned/augmented object; assert structural equality
        expect(ensured).toMatchObject(normalized);
        // Should not mutate original
        expect(normalized).toEqual({ id: '1', role: 'user', text: 'hi' });
    });
    it('ensureUiMessage flattens legacy content array', () => {
        const raw = {
            id: 'x',
            role: 'assistant',
            content: [txt('Hi'), img('x.png')],
        } as any;
        const u = ensureUiMessage(raw);
        expect(u.text.startsWith('Hi')).toBe(true);
        expect(u.text).toMatch(/!\[generated image]\(x.png\)/);
    });
    it('ensureUiMessage adds placeholders only for missing hashes', () => {
        const raw = {
            id: 'a1',
            role: 'assistant' as const,
            text: 'Some intro',
            file_hashes: ['h1', 'h2'],
        };
        const u = ensureUiMessage(raw);
        const matches = u.text.match(/file-hash:/g) || [];
        expect(matches.length).toBe(2);
    });
    it('ensureUiMessage does not exceed hash count when images already present', () => {
        const raw = {
            id: 'a2',
            role: 'assistant' as const,
            text: '![generated image](data:image/png;base64,abc)',
            file_hashes: ['h1'],
        };
        const u = ensureUiMessage(raw);
        // existing image count (1) >= hashes (1) -> no file-hash placeholder appended
        expect(u.text).not.toContain('file-hash:');
    });
    it('ensureUiMessage only appends up to remaining needed placeholders', () => {
        const raw = {
            id: 'a3',
            role: 'assistant' as const,
            text: '![generated image](data:image/png;base64,abc)',
            file_hashes: ['h1', 'h2', 'h3'],
        };
        const u = ensureUiMessage(raw);
        const placeholders = (u.text.match(/file-hash:/g) || []).length;
        // Already had 1 image; total hashes 3 => need only 2 placeholders
        expect(placeholders).toBe(2);
    });
});
