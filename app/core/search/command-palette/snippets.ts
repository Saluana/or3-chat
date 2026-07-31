const DEFAULT_SNIPPET_RADIUS = 80;

/**
 * Build a plain-text snippet centered near the first match of `term`.
 * Consumers must render this as text (Vue interpolation/textContent), which
 * escapes markup without exposing entity strings such as `&lt;` to users.
 */
export function buildEscapedSnippet(
    text: string,
    term: string,
    radius = DEFAULT_SNIPPET_RADIUS
): string {
    const source = text ?? '';
    if (!source) return '';
    const needle = term.trim();
    if (!needle) {
        return truncate(source, radius * 2);
    }

    const lowerSource = source.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let matchIndex = lowerSource.indexOf(lowerNeedle);
    if (matchIndex < 0) {
        // Fallback: first token
        const token = lowerNeedle.split(/\s+/).find(Boolean);
        if (token) matchIndex = lowerSource.indexOf(token);
    }
    if (matchIndex < 0) {
        return truncate(source, radius * 2);
    }

    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(source.length, matchIndex + needle.length + radius);
    let snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = `…${snippet}`;
    if (end < source.length) snippet = `${snippet}…`;
    return snippet;
}

function truncate(text: string, max: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max).trim()}…`;
}
