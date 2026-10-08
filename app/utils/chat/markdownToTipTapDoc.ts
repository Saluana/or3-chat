import { Editor, Extension, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from 'tiptap-markdown';

/** The markdown-it surface used by the LaTeX rule, typed structurally. */
type LatexToken = { type: string; tag: string; content: string; markup: string };
type InlineState = {
    src: string;
    pos: number;
    posMax: number;
    push(type: string, tag: string, nesting: 0): LatexToken;
};
type MarkdownItLike = {
    inline: {
        ruler: {
            before(beforeRule: string, name: string, rule: (state: InlineState, silent: boolean) => boolean): void;
        };
    };
    renderer: { rules: Record<string, (tokens: LatexToken[], index: number) => string> };
    utils: { escapeHtml(text: string): string };
};

const LATEX_SPANS = [
    { open: '\\[', close: '\\]', delimiter: '$$' },
    { open: '\\(', close: '\\)', delimiter: '$' },
] as const;

/**
 * Inline `\[…\]` and `\(…\)` math. It runs inside markdown-it's inline scanner
 * before the escape rule: code spans are consumed as whole tokens before this
 * rule can see their contents, and fenced or indented code never reaches inline
 * parsing, so literal code keeps its backslashes. A candidate containing a
 * backtick is left alone, since a code span may begin inside it.
 */
function latexSpanRule(state: InlineState, silent: boolean): boolean {
    for (const span of LATEX_SPANS) {
        if (!state.src.startsWith(span.open, state.pos)) continue;
        const start = state.pos + span.open.length;
        const close = state.src.indexOf(span.close, start);
        if (close < 0 || close + span.close.length > state.posMax) continue;
        const content = state.src.slice(start, close);
        if (!content.trim() || content.includes('`')) continue;
        if (!silent) {
            const token = state.push('or3_latex_math', '', 0);
            token.content = content;
            token.markup = span.delimiter;
        }
        state.pos = close + span.close.length;
        return true;
    }
    return false;
}

/**
 * Documents have no math node, so math is stored as its `$`-delimited source
 * rather than losing its backslashes. Registered through tiptap-markdown's
 * per-extension parse hook, so it applies to the parser that builds the doc.
 */
const LatexDelimiters = Extension.create({
    name: 'or3LatexDelimiters',
    addStorage() {
        return {
            markdown: {
                parse: {
                    setup(markdownit: MarkdownItLike) {
                        markdownit.inline.ruler.before('escape', 'or3_latex_math', latexSpanRule);
                        markdownit.renderer.rules.or3_latex_math = (tokens, index) => {
                            const token = tokens[index]!;
                            return markdownit.utils.escapeHtml(`${token.markup}${token.content}${token.markup}`);
                        };
                    },
                },
            },
        };
    },
});

/**
 * Convert message Markdown into the TipTap JSON shape stored by documents.
 * The node set mirrors the document editor's core schema (headings 1–3,
 * task lists, tables) so structure survives instead of collapsing to text.
 *
 * These imports intentionally stay static. This conversion is a core message
 * action, and deferring the editor dependencies left the action vulnerable to
 * stale or cleared Vite optimizer chunks in development.
 */
export function markdownToTipTapDoc(source: string): JSONContent {
    const markdown = source.trim();
    if (!markdown) return { type: 'doc', content: [] };

    const editor = new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
            TaskList,
            TaskItem.configure({ nested: true }),
            TableKit,
            Markdown,
            LatexDelimiters,
        ],
        content: markdown,
    });

    try {
        const document: JSONContent = editor.getJSON();
        if (document.type !== 'doc') {
            throw new Error('Markdown conversion did not produce a document');
        }
        return document;
    } finally {
        editor.destroy();
    }
}
