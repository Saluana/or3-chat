import { describe, expectTypeOf, it } from 'vitest';
import type {
    PaletteAction,
    PaletteActionResult,
    PaletteActionTarget,
    ParsedPaletteQuery,
    PaletteResult,
} from '../types';

describe('palette domain type contracts', () => {
    it('discriminates parsed queries', () => {
        const all: ParsedPaletteQuery = {
            kind: 'all',
            raw: 'x',
            term: 'x',
        };
        const category: ParsedPaletteQuery = {
            kind: 'category',
            raw: 'chat:x',
            term: 'x',
            categoryId: 'chat',
            alias: 'chat',
        };
        expectTypeOf(all).toMatchTypeOf<ParsedPaletteQuery>();
        expectTypeOf(category).toMatchTypeOf<ParsedPaletteQuery>();
        if (category.kind === 'category') {
            expectTypeOf(category.categoryId).toEqualTypeOf<string>();
        }
    });

    it('requires action targets to be exhaustive kinds', () => {
        const target: PaletteActionTarget = {
            kind: 'chat',
            threadId: 't1',
            destination: 'active',
        };
        expectTypeOf(target).toMatchTypeOf<PaletteActionTarget>();
        expectTypeOf<PaletteActionTarget['kind']>().toEqualTypeOf<
            | 'chat'
            | 'document'
            | 'pane-app'
            | 'project'
            | 'system-prompt'
            | 'dashboard'
            | 'image'
            | 'command'
        >();
    });

    it('narrows action results', () => {
        const ok: PaletteActionResult = { ok: true };
        const err: PaletteActionResult = {
            ok: false,
            error: { code: 'not-found', message: 'missing' },
        };
        expectTypeOf(ok).toMatchTypeOf<PaletteActionResult>();
        if (!err.ok) {
            expectTypeOf(err.error.code).toEqualTypeOf<
                | 'not-found'
                | 'disabled'
                | 'forbidden'
                | 'stale-plugin'
                | 'navigation-failed'
                | 'execution-failed'
            >();
        }
    });

    it('requires secondaryActions on results', () => {
        const result: PaletteResult = {
            key: 'chat:1',
            sourceId: 'chat',
            categoryId: 'chat',
            recordId: '1',
            title: 'Thread',
            primaryAction: {
                id: 'open',
                label: 'Open',
                target: {
                    kind: 'chat',
                    threadId: '1',
                    destination: 'active',
                },
            },
            secondaryActions: [],
            metadata: {},
        };
        expectTypeOf(result.secondaryActions).toEqualTypeOf<
            readonly PaletteAction[]
        >();
    });
});
