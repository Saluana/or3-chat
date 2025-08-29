/**
 * Utility functions for system prompts
 */

/**
 * Converts TipTap JSON content to plain text string for use as system message.
 * Extracts text from paragraph nodes and joins with newlines.
 */
export function promptJsonToString(json: any): string {
    if (!json) return '';
    const lines: string[] = [];

    function walk(node: any, collectLine = false) {
        if (!node) return;
        // Gather plain text from leaf text nodes
        if (Array.isArray(node)) {
            node.forEach((n) => walk(n));
            return;
        }
        if (node.type === 'text') {
            currentLine += node.text || '';
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
        let isBlock = blockTypes.has(node.type);
        if (isBlock) {
            flushLine();
        }
        if (node.content) node.content.forEach((c: any) => walk(c));
        if (isBlock) flushLine();
    }

    let currentLine = '';
    function flushLine() {
        if (currentLine.trim().length) lines.push(currentLine.trim());
        currentLine = '';
    }

    walk(json.content || json);
    flushLine();
    return lines.join('\n');
}
