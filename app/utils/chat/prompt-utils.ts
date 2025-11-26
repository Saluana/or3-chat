/**
 * Utility functions for system prompts
 */

/** TipTap node types */
interface TipTapTextNode {
    type: 'text';
    text?: string;
}

interface TipTapBlockNode {
    type: string;
    content?: readonly TipTapNode[];
}

type TipTapNode = TipTapTextNode | TipTapBlockNode;

interface TipTapDocument {
    type?: string;
    content?: readonly TipTapNode[];
}

/**
 * Converts TipTap JSON content to plain text string for use as system message.
 * Extracts text from paragraph nodes and joins with newlines.
 */
export function promptJsonToString(
    json: TipTapDocument | TipTapNode[] | null | undefined
): string {
    if (!json) return '';
    const lines: string[] = [];

    function walk(node: TipTapNode | readonly TipTapNode[] | undefined): void {
        if (!node) return;
        // Gather plain text from leaf text nodes
        if (Array.isArray(node)) {
            node.forEach((n: TipTapNode) => walk(n));
            return;
        }
        if ((node as TipTapNode).type === 'text') {
            currentLine += (node as TipTapTextNode).text || '';
            return;
        }
        const blockTypes = new Set([
            'paragraph',
            'heading',
            'blockquote',
            'codeBlock',
            'orderedList',
            'bulletList',
            'listItem',
        ]);
        const isBlock = blockTypes.has((node as TipTapNode).type);
        if (isBlock) {
            flushLine();
        }
        if ('content' in node && node.content) {
            node.content.forEach((c: TipTapNode) => walk(c));
        }
        if (isBlock) flushLine();
    }

    let currentLine = '';
    function flushLine() {
        if (currentLine.trim().length) lines.push(currentLine.trim());
        currentLine = '';
    }

    // Handle both array and document formats
    let content: readonly TipTapNode[] | TipTapNode | undefined;
    if (Array.isArray(json)) {
        content = json;
    } else if ('content' in json && json.content) {
        content = json.content;
    }

    if (content) {
        walk(content);
    }
    flushLine();
    return lines.join('\n');
}

/**
 * Compose final system prompt from master + per-thread system text.
 * - Trims both sides
 * - Returns null if both are empty
 * - Orders: master then thread, separated by two newlines
 */
export function composeSystemPrompt(
    master: string,
    threadSystem: string | null
): string | null {
    const m = (master || '').trim();
    const t = (threadSystem || '').trim();
    if (!m && !t) return null;
    if (!m) return t;
    if (!t) return m;
    return `${m}\n\n${t}`;
}
