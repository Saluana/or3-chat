const DEFAULT_SNIPPET_RADIUS = 80;

/**
 * Build a plain-text snippet centered near the first match of `term`.
 * Consumers must render this as text (Vue interpolation/textContent), which
 * escapes markup without exposing entity strings such as `&lt;` to users.
 */
export function buildEscapedSnippet(
    text: string | null | undefined,
    term: string,
    radius = DEFAULT_SNIPPET_RADIUS
): string {
    const input = text ?? '';
    // Markdown parsing contains patterns that can backtrack on malformed input.
    // Search the raw text first and only parse a bounded window around it.
    const needle = term.trim();
    const lowerInput = input.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let rawMatch = needle ? lowerInput.indexOf(lowerNeedle) : -1;
    if (rawMatch < 0 && needle) {
        const token = lowerNeedle.split(/\s+/).find(Boolean);
        if (token) rawMatch = lowerInput.indexOf(token);
    }
    const windowSize = 2048;
    const windowStart = rawMatch < 0 ? 0 : Math.max(0, rawMatch - Math.min(radius * 2, windowSize / 2));
    const windowEnd = Math.min(input.length, windowStart + windowSize);
    const source = stripMarkdown(input.slice(windowStart, windowEnd));
    if (!source) return '';
    if (!needle) {
        const result = truncate(source, radius * 2);
        return windowEnd < input.length && !result.endsWith('…') ? `${result}…` : result;
    }

    const lowerSource = source.toLowerCase();
    let matchIndex = lowerSource.indexOf(lowerNeedle);
    if (matchIndex < 0) {
        // Fallback: first token
        const token = lowerNeedle.split(/\s+/).find(Boolean);
        if (token) matchIndex = lowerSource.indexOf(token);
    }
    if (matchIndex < 0) {
        const result = truncate(source, radius * 2);
        return windowEnd < input.length && !result.endsWith('…') ? `${result}…` : result;
    }

    const start = Math.max(0, matchIndex - radius);
    const end = Math.min(source.length, matchIndex + needle.length + radius);
    let snippet = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0 || windowStart > 0) snippet = `…${snippet}`;
    if (end < source.length || windowEnd < input.length) snippet = `${snippet}…`;
    return snippet;
}

function truncate(text: string, max: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max).trim()}…`;
}

/**
 * Reduce Markdown to the text a reader sees, so snippets do not show `**`,
 * link URLs or heading marks. Conservative: emphasis is removed only when it
 * wraps text at word boundaries, so `snake_case` and `2*3*4` survive.
 */
export function stripMarkdown(text: string): string {
    return text
        .replace(/^\s*(```|~~~).*$/gm, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
        .replace(/(^|[^\w*])(\*\*|__)(?=\S)([^\n]*?\S)\2(?![\w*])/g, '$1$3')
        .replace(/(^|[^\w*])(\*|_)(?=\S)([^\n*_]*?\S)\2(?![\w*])/g, '$1$3')
        .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1');
}
