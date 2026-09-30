/**
 * Pure, dependency-free selected-document transform.
 *
 * This module is the first-action implementation. It runs inside the isolated
 * client worker and never touches the network, the filesystem, or host
 * internals, so every result is deterministic and reproducible from a committed
 * fixture. `client.mjs` is the only thing that talks to the OR3 host.
 */

export const PORTABLE_FEATURE_ID = 'or3-portable-client-v1';

/** Host operation the first action produces, declared in `or3.package-policy.json`. */
export const FIRST_ACTION_OPERATION_ID = 'documents.write';

/** Host operation the setup test action reads, declared in `or3.package-policy.json`. */
export const TEST_ACTION_OPERATION_ID = 'documents.read';

/** The one host-mediated command this utility registers. */
export const SELECTION_COMMAND_ID = 'or3.selected-document.summarize';

export const COMMAND_LABEL = 'Summarize selected document';

export const DEFAULT_DIGEST_OPTIONS = Object.freeze({
    summaryStyle: 'bullets',
    maxOutlineSentences: 5,
    includeStatistics: true,
});

const SUMMARY_STYLES = new Set(['bullets', 'prose']);
const MIN_OUTLINE_SENTENCES = 1;
const MAX_OUTLINE_SENTENCES = 20;
const WORDS_PER_MINUTE = 200;

function asInteger(value) {
    const number = typeof value === 'string' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return undefined;
    return Math.trunc(number);
}

/** Clamp host-provided settings into a deterministic option set. */
export function normalizeDigestOptions(input = {}) {
    const style = SUMMARY_STYLES.has(input.summaryStyle)
        ? input.summaryStyle
        : DEFAULT_DIGEST_OPTIONS.summaryStyle;
    const requested = asInteger(input.maxOutlineSentences);
    const max =
        requested === undefined
            ? DEFAULT_DIGEST_OPTIONS.maxOutlineSentences
            : Math.min(MAX_OUTLINE_SENTENCES, Math.max(MIN_OUTLINE_SENTENCES, requested));
    const includeStatistics =
        typeof input.includeStatistics === 'boolean'
            ? input.includeStatistics
            : DEFAULT_DIGEST_OPTIONS.includeStatistics;
    return Object.freeze({
        summaryStyle: style,
        maxOutlineSentences: max,
        includeStatistics,
    });
}

export function normalizeSelectionContent(content) {
    return String(content ?? '')
        .replace(/\r\n?/g, '\n')
        .trim();
}

export function splitParagraphs(content) {
    return normalizeSelectionContent(content)
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.split('\n').join(' ').replace(/[ \t]+/g, ' ').trim())
        .filter((paragraph) => paragraph.length > 0);
}

export function splitSentences(paragraph) {
    return paragraph
        .split(/(?<=[.!?…])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
}

function firstSentence(paragraph) {
    const sentences = splitSentences(paragraph);
    return sentences[0] ?? null;
}

function selectionStatistics(content, paragraphs) {
    const words = content.split(/\s+/).filter((word) => word.length > 0);
    const sentenceCount = paragraphs.reduce(
        (total, paragraph) => total + splitSentences(paragraph).length,
        0
    );
    return Object.freeze({
        characters: content.length,
        words: words.length,
        sentences: sentenceCount,
        paragraphs: paragraphs.length,
        readingMinutes: Math.max(1, Math.ceil(words.length / WORDS_PER_MINUTE)),
    });
}

function renderOutline(outline, style) {
    if (!outline.length) return '_No outline sentences found._';
    if (style === 'prose') return outline.join(' ');
    return outline.map((sentence) => `- ${sentence}`).join('\n');
}

function renderMarkdown(title, outline, statistics, style) {
    const heading = title ? `# Selection digest: ${title}` : '# Selection digest';
    const lines = [heading, ''];
    if (statistics) {
        lines.push(
            `_${statistics.paragraphs} paragraph(s) - ${statistics.words} word(s) - ~${statistics.readingMinutes} min read_`,
            ''
        );
    }
    lines.push('## Outline', '', renderOutline(outline, style), '');
    lines.push('_Generated locally by Selected Document Utility._');
    return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Build the first-action result for a host-provided selection.
 *
 * @param {{ title?: unknown, content: unknown }} selection
 * @param {Partial<typeof DEFAULT_DIGEST_OPTIONS>} [options]
 */
export function analyzeSelection(selection, options = {}) {
    if (!selection || typeof selection !== 'object') {
        throw new TypeError('Selection must be an object with a content field');
    }
    if (typeof selection.content !== 'string') {
        throw new TypeError('Selection content must be a string');
    }
    const settings = normalizeDigestOptions(options);
    const content = normalizeSelectionContent(selection.content);
    if (!content) {
        throw new TypeError('Selection content must not be empty');
    }
    const title = typeof selection.title === 'string' ? selection.title.trim() : '';
    const paragraphs = splitParagraphs(content);
    const outline = [];
    for (const paragraph of paragraphs) {
        const sentence = firstSentence(paragraph);
        if (sentence) outline.push(sentence);
        if (outline.length >= settings.maxOutlineSentences) break;
    }
    const statistics = settings.includeStatistics
        ? selectionStatistics(content, paragraphs)
        : null;
    return Object.freeze({
        title,
        style: settings.summaryStyle,
        outline: Object.freeze(outline),
        statistics,
        markdown: renderMarkdown(title, outline, statistics, settings.summaryStyle),
    });
}
