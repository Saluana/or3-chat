import type { ParsedPaletteQuery } from './types';

/**
 * Parse an optional leading category alias from a palette query.
 *
 * Recognized prefixes filter by category; unknown prefixes are treated as
 * literal search text so they cannot accidentally empty all results.
 */
export function parsePaletteQuery(
    raw: string,
    aliasToCategoryId: ReadonlyMap<string, string>
): ParsedPaletteQuery {
    const input = typeof raw === 'string' ? raw : '';
    const trimmedStart = input.replace(/^\s+/, '');
    if (!trimmedStart) {
        return { kind: 'all', raw: input, term: '' };
    }

    const colonIndex = trimmedStart.indexOf(':');
    if (colonIndex <= 0) {
        return { kind: 'all', raw: input, term: input.trim() };
    }

    const aliasRaw = trimmedStart.slice(0, colonIndex);
    const alias = aliasRaw.trim().toLowerCase();
    if (!alias || /\s/.test(aliasRaw)) {
        return { kind: 'all', raw: input, term: input.trim() };
    }

    const categoryId = aliasToCategoryId.get(alias);
    if (!categoryId) {
        return { kind: 'all', raw: input, term: input.trim() };
    }

    const remainder = trimmedStart.slice(colonIndex + 1);
    return {
        kind: 'category',
        raw: input,
        term: remainder.trim(),
        categoryId,
        alias,
    };
}
