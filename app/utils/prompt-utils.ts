/**
 * Utility functions for system prompts
 */

/**
 * Converts TipTap JSON content to plain text string for use as system message.
 * Extracts text from paragraph nodes and joins with newlines.
 */
export function promptJsonToString(json: any): string {
    if (!json || !json.content) return '';

    return json.content
        .filter((node: any) => node.type === 'paragraph')
        .map((paragraph: any) =>
            (paragraph.content || [])
                .map((child: any) => child.text || '')
                .join('')
        )
        .join('\n');
}
