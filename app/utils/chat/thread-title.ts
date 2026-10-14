const TITLE_WORDS = 6;
const TITLE_MAX_CHARS = 80;

/**
 * Default title for a new chat, taken from its first message: the first few
 * words with whitespace collapsed, ending in "…" when the message goes on so
 * a cut-off sentence doesn't read like a complete title.
 */
export function deriveThreadTitle(text: string, fallback = 'New Thread'): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return fallback;
    let title = words.slice(0, TITLE_WORDS).join(' ');
    let truncated = words.length > TITLE_WORDS;
    if (title.length > TITLE_MAX_CHARS) {
        title = title.slice(0, TITLE_MAX_CHARS).trimEnd();
        truncated = true;
    }
    return truncated ? `${title}…` : title;
}
