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
 * `shouldKeepAssistantMessage`
 *
 * Purpose:
 * Filters assistant messages to prevent empty placeholders in model input.
 *
 * Behavior:
 * - Keeps non-empty text messages
 * - Keeps image/file content parts
 *
 * Constraints:
 * - Only applies to assistant role messages
 */
export function shouldKeepAssistantMessage(m: {
    role: string;
    content?: string | ContentPart[] | null;
}): boolean {
    if (m.role !== 'assistant') return true;
    const c = m.content;
    if (typeof c === 'string') return c.trim().length > 0;
    if (Array.isArray(c)) {
        return c.some((p) => {
            if (p.type === 'text') return p.text.trim().length > 0;
            // image and file parts are always considered non-empty
            return true;
        });
    }
    return true;
}

/**
 * `getChatModalities`
 *
 * Purpose:
 * Returns the output modalities to request for a given model id.
 *
 * Behavior:
 * - Most models are text-only output
 * - Known image-generation model families also request image output
 *
 * Constraints:
 * - This decides OUTPUT format, not vision/input capability
 */
export function getChatModalities(modelId: string): string[] {
    const isImageGenerationModel =
        /dall-e|stable-diffusion|midjourney|imagen/i.test(modelId);
    return isImageGenerationModel ? ['image', 'text'] : ['text'];
}

/**
 * `trimOrMessagesByTokenBudget`
 *
 * Purpose:
 * Drops oldest non-system/non-user messages from an OpenRouter message array
 * until the remaining text is within the provided token budget.
 *
 * Behavior:
 * - Never removes the system message
 * - Never removes the last user message
 * - Counts only text parts; image/file parts are ignored (model-specific cost)
 *
 * Returns the trimmed array (may be unchanged if already under budget).
 */
export async function trimOrMessagesByTokenBudget<T extends { role: string; content?: { type: string; text?: string }[] | string }>(
    messages: T[],
    maxTokens: number,
    countTokens: (text: string) => Promise<number>
): Promise<T[]> {
    const lastUserIndex = messages.findLastIndex((m) => m.role === 'user');

    // Compute token counts once
    const counts = await Promise.all(
        messages.map(async (m) => {
            const text =
                typeof m.content === 'string'
                    ? m.content
                    : m.content
                          ?.filter((p): p is { type: 'text'; text: string } =>
                              p.type === 'text' && typeof p.text === 'string'
                          )
                          .map((p) => p.text)
                          .join('\n') ?? '';
            return countTokens(text);
        })
    );

    let total = counts.reduce((a, b) => a + b, 0);
    if (total <= maxTokens) return messages;

    type Group = { indices: number[]; protected: boolean };
    const groups: Group[] = [];
    let currentTurn: number[] = [];
    const flushTurn = () => {
        if (!currentTurn.length) return;
        groups.push({ indices: currentTurn, protected: false });
        currentTurn = [];
    };

    for (let i = 0; i < messages.length; i += 1) {
        const role = messages[i]?.role;
        if (role === 'system' || i === lastUserIndex) {
            flushTurn();
            groups.push({ indices: [i], protected: true });
            continue;
        }
        if (role === 'user') flushTurn();
        currentTurn.push(i);
    }
    flushTurn();

    const removed = new Set<number>();
    for (const group of groups) {
        if (total <= maxTokens) break;
        if (group.protected) continue;
        for (const index of group.indices) {
            total -= counts[index] ?? 0;
            removed.add(index);
        }
    }

    return messages.filter((_m, i) => !removed.has(i));
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
