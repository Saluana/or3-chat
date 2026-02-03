/**
 * @module app/utils/chat/messages
 *
 * Purpose:
 * Shared utilities for building and extracting chat message content.
 */

import type { ContentPart } from './types';
import { isWorkflowMessageData } from './workflow-types';

/**
 * `buildParts`
 *
 * Purpose:
 * Builds content parts with text first, then extra text blocks, then files.
 */
export function buildParts(
    outgoing: string,
    files: { type: string; url: string }[] = [],
    extraTextParts: string[] = []
): ContentPart[] {
    return [
        { type: 'text', text: outgoing },
        ...extraTextParts.map<ContentPart>((t) => ({
            type: 'text',
            text: t,
        })),
        ...files.map<ContentPart>((f) =>
            (f.type || '').startsWith('image/')
                ? { type: 'image', image: f.url, mediaType: f.type }
                : { type: 'file', data: f.url, mediaType: f.type }
        ),
    ];
}

/**
 * `getTextFromContent`
 *
 * Purpose:
 * Extracts concatenated text from a content array.
 */
export function getTextFromContent(
    content: string | ContentPart[] | undefined | null
): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');
}

/**
 * `deriveMessageContent`
 *
 * Purpose:
 * Derives a string content value from a stored message shape.
 *
 * Behavior:
 * - For workflow messages, uses `finalOutput`
 * - Otherwise prefers `data.content` or `data.text`, then top-level content
 */
export function deriveMessageContent(msg: {
    content?: string | ContentPart[] | null;
    data?: unknown;
}): string {
    const data = msg.data;
    if (isWorkflowMessageData(data)) {
        return data.finalOutput || '';
    }

    if (data && typeof data === 'object') {
        const contentField = (data as { content?: unknown }).content;
        if (typeof contentField === 'string') return contentField;
        const textField = (data as { text?: unknown }).text;
        if (typeof textField === 'string') return textField;
    }

    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return getTextFromContent(content);
    return '';
}

/**
 * `mergeFileHashes`
 *
 * Purpose:
 * Merges and deduplicates file hash arrays.
 */
export function mergeFileHashes(
    existing?: string[] | null,
    fromAssistant?: string[]
) {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(fromAssistant) ? fromAssistant : [];
    return Array.from(new Set([...a, ...b]));
}

/**
 * `trimOrMessagesImages`
 *
 * Purpose:
 * Drops oldest image parts across OpenRouter messages to keep within a limit.
 */
type ORMessagePart = { type: string };
type ORMessage = { content: ORMessagePart[] };

export function trimOrMessagesImages(orMessages: ORMessage[], max: number) {
    try {
        const totalImagesPre = orMessages.reduce(
            (a: number, m: ORMessage) =>
                a +
                m.content.filter((p: ORMessagePart) => p.type === 'image_url')
                    .length,
            0
        );
        if (totalImagesPre <= max) return;

        let toDrop = totalImagesPre - max;
        for (const m of orMessages) {
            if (toDrop <= 0) break;
            const next: ORMessagePart[] = [];
            for (const part of m.content) {
                if (part.type === 'image_url' && toDrop > 0) {
                    toDrop--;
                    continue;
                }
                next.push(part);
            }
            m.content = next;
        }
    } catch {
        // ignore trimming errors
    }
}
