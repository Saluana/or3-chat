const MAX_AUTOCOMPLETE_CHARS = 500;
const MAX_OVERLAP_SCAN = 240;

/**
 * Removes text the model repeated from immediately before the cursor while
 * preserving intentional leading whitespace used by inline completions.
 */
export function normalizeAutocompleteSuggestion(raw: string, beforeCursor: string): string {
    let suggestion = raw.replace(/\r\n?/gu, '\n').replace(/^\u200B/gu, '');
    if (!suggestion.trim()) return '';

    const before = beforeCursor.slice(-MAX_OVERLAP_SCAN);
    const comparableBefore = before.toLocaleLowerCase();
    const comparableSuggestion = suggestion.toLocaleLowerCase();
    const maximum = Math.min(comparableBefore.length, comparableSuggestion.length);

    for (let length = maximum; length >= 4; length -= 1) {
        const repeated = comparableBefore.slice(-length);
        if (repeated !== comparableSuggestion.slice(0, length)) continue;

        // Four-character overlaps are useful only when they include a word
        // boundary. Longer overlaps are strong enough to safely deduplicate.
        if (length < 8 && !/\s/u.test(repeated)) continue;
        suggestion = suggestion.slice(length);
        break;
    }

    if (!suggestion.trim()) return '';
    return Array.from(suggestion).slice(0, MAX_AUTOCOMPLETE_CHARS).join('');
}

