import { describe, expect, it } from 'vitest';
import { parsePaletteQuery } from '../parse-query';

const aliases = new Map([
    ['chat', 'chat'],
    ['doc', 'document'],
    ['document', 'document'],
    ['command', 'command'],
]);

describe('parsePaletteQuery', () => {
    it('treats empty / whitespace as all with empty term', () => {
        expect(parsePaletteQuery('', aliases)).toEqual({
            kind: 'all',
            raw: '',
            term: '',
        });
        expect(parsePaletteQuery('   ', aliases)).toEqual({
            kind: 'all',
            raw: '   ',
            term: '',
        });
    });

    it('parses recognized case-insensitive prefixes', () => {
        expect(parsePaletteQuery('Chat: hello', aliases)).toEqual({
            kind: 'category',
            raw: 'Chat: hello',
            term: 'hello',
            categoryId: 'chat',
            alias: 'chat',
        });
        expect(parsePaletteQuery('DOC:notes', aliases)).toEqual({
            kind: 'category',
            raw: 'DOC:notes',
            term: 'notes',
            categoryId: 'document',
            alias: 'doc',
        });
    });

    it('returns empty term for recognized prefix with no remainder', () => {
        expect(parsePaletteQuery('chat:', aliases)).toEqual({
            kind: 'category',
            raw: 'chat:',
            term: '',
            categoryId: 'chat',
            alias: 'chat',
        });
    });

    it('treats unknown prefixes as literal search text', () => {
        expect(parsePaletteQuery('todo: buy milk', aliases)).toEqual({
            kind: 'all',
            raw: 'todo: buy milk',
            term: 'todo: buy milk',
        });
    });

    it('does not treat mid-string or spaced aliases as prefixes', () => {
        expect(parsePaletteQuery('hello chat: world', aliases)).toEqual({
            kind: 'all',
            raw: 'hello chat: world',
            term: 'hello chat: world',
        });
        expect(parsePaletteQuery('cha t: x', aliases)).toEqual({
            kind: 'all',
            raw: 'cha t: x',
            term: 'cha t: x',
        });
    });
});
