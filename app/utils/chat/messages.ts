/**
 * @module app/utils/chat/messages
 *
 * Purpose:
 * Shared utilities for building and extracting chat message content.
 */

import type { ContentPart } from './types';
import { isWorkflowMessageData } from './workflow-types';
import {
    DEFAULT_MAX_INPUT_TOKENS,
    MAX_CHAT_INPUT_TOKENS,
    MAX_CHAT_OUTPUT_RESERVE_TOKENS,
    MIN_CHAT_INPUT_TOKENS,
} from './constants';

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

export type NormalizedStreamingToolCall = {
    id: string;
    name: string;
    status: 'loading' | 'complete' | 'error' | 'pending';
    args?: string;
    result?: string;
    error?: string;
    fingerprint?: string;
};

export type NormalizedStreamingMessage = {
    text: string;
    reasoningText: string | null;
    toolCalls: NormalizedStreamingToolCall[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

/**
 * Canonicalizes the mutable assistant fields shared by live streaming,
 * continuation/retry hydration, and transcript reload.
 */
export function normalizeStreamingMessage(input: {
    text?: unknown;
    content?: string | ContentPart[] | null;
    reasoning_text?: unknown;
    toolCalls?: unknown;
    data?: unknown;
}): NormalizedStreamingMessage {
    const data = asRecord(input.data);
    const text =
        typeof input.text === 'string'
            ? input.text
            : deriveMessageContent({ content: input.content, data });
    const reasoningText =
        typeof data?.reasoning_text === 'string'
            ? data.reasoning_text
            : typeof input.reasoning_text === 'string'
              ? input.reasoning_text
              : null;
    const rawToolCalls = Array.isArray(input.toolCalls)
        ? input.toolCalls
        : Array.isArray(data?.tool_calls)
          ? data.tool_calls
          : [];
    const calls = new Map<string, NormalizedStreamingToolCall>();
    for (const value of rawToolCalls) {
        const call = asRecord(value);
        if (!call) continue;
        const fn = asRecord(call.function);
        const id =
            typeof call.id === 'string' && call.id.trim()
                ? call.id
                : '';
        const name =
            typeof call.name === 'string' && call.name.trim()
                ? call.name
                : typeof fn?.name === 'string' && fn.name.trim()
                  ? fn.name
                  : '';
        if (!id || !name) continue;
        const rawStatus = call.status;
        const status: NormalizedStreamingToolCall['status'] =
            rawStatus === 'complete' ||
            rawStatus === 'error' ||
            rawStatus === 'pending'
                ? rawStatus
                : 'loading';
        calls.set(id, {
            id,
            name,
            status,
            args:
                typeof call.args === 'string'
                    ? call.args
                    : typeof fn?.arguments === 'string'
                      ? fn.arguments
                      : undefined,
            result:
                typeof call.result === 'string' ? call.result : undefined,
            error: typeof call.error === 'string' ? call.error : undefined,
            fingerprint:
                typeof call.fingerprint === 'string'
                    ? call.fingerprint
                    : undefined,
        });
    }
    return { text, reasoningText, toolCalls: [...calls.values()] };
}

function needsContinuationBoundarySpace(previous: string, next: string): boolean {
    if (!previous || !next || /\s$/.test(previous) || /^\s/.test(next)) {
        return false;
    }
    const last = previous.slice(-1);
    const first = next[0];
    if ('([{<«“‘"`/\\-–—'.includes(last)) return false;
    if (',.…;:!?%)]}>»”’"\'`'.includes(first ?? '')) return false;
    const isWord = (value: string) => /[\p{L}\p{N}]/u.test(value);
    return (
        (isWord(last) && isWord(first ?? '')) ||
        (/[.!?;:…)\]}>"'»”’]/.test(last) && isWord(first ?? ''))
    );
}

export interface ContinuationDeltaNormalizer {
    push(value: unknown): string;
    finish(): string;
}

/**
 * Normalizes continuation output once at the stream boundary. It accepts a
 * fragmented `>>` marker, suppresses a replayed suffix from an interrupted
 * generation, and applies boundary spacing exactly once.
 */
export function createContinuationDeltaNormalizer(
    existingText: string,
    prefix = '>>'
): ContinuationDeltaNormalizer {
    const overlapSource = existingText.slice(-1200);
    let prefixPending = prefix.length > 0;
    let prefixBuffer = '';
    let overlapPending = overlapSource.length > 0;
    let overlapBuffer = '';
    let boundaryPending = true;

    const withBoundary = (value: string): string => {
        if (!value || !boundaryPending) return value;
        boundaryPending = false;
        return needsContinuationBoundarySpace(existingText, value)
            ? ` ${value}`
            : value;
    };

    const resolveOverlap = (atEnd: boolean): string => {
        if (!overlapPending || !overlapBuffer) return '';
        const possibleSuffixes: string[] = [];
        for (let start = 0; start < overlapSource.length; start += 1) {
            const suffix = overlapSource.slice(start);
            if (suffix.startsWith(overlapBuffer)) possibleSuffixes.push(suffix);
        }
        if (
            !atEnd &&
            possibleSuffixes.some(
                (suffix) => suffix.length > overlapBuffer.length
            )
        ) {
            return '';
        }
        let overlap = 0;
        const max = Math.min(overlapSource.length, overlapBuffer.length);
        for (let size = max; size >= 2; size -= 1) {
            if (
                overlapBuffer.startsWith(overlapSource.slice(-size))
            ) {
                overlap = size;
                break;
            }
        }
        const output = overlapBuffer.slice(overlap);
        overlapBuffer = '';
        overlapPending = false;
        return withBoundary(output);
    };

    const consumePrefix = (value: string, atEnd: boolean): string => {
        if (!prefixPending) return value;
        prefixBuffer += value;
        if (!atEnd && prefixBuffer.length < prefix.length) return '';
        if (prefixBuffer.startsWith(prefix)) {
            prefixBuffer = prefixBuffer.slice(prefix.length);
        }
        prefixPending = false;
        const output = prefixBuffer;
        prefixBuffer = '';
        return output;
    };

    return {
        push(value: unknown): string {
            if (typeof value !== 'string' || value.length === 0) return '';
            const unprefixed = consumePrefix(value, false);
            if (!unprefixed) return '';
            if (!overlapPending) return withBoundary(unprefixed);
            overlapBuffer += unprefixed;
            return resolveOverlap(false);
        },
        finish(): string {
            const unprefixed = consumePrefix('', true);
            if (unprefixed) overlapBuffer += unprefixed;
            return resolveOverlap(true);
        },
    };
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

type ModelContextMetadata = {
    context_length?: unknown;
    top_provider?: {
        context_length?: unknown;
        max_completion_tokens?: unknown;
    } | null;
} | null | undefined;

function positiveInteger(value: unknown): number | null {
    return typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
        ? Math.floor(value)
        : null;
}

/**
 * Resolves a safe input budget from model catalog metadata.
 *
 * Keeps response headroom inside the provider context window and falls back to
 * a conservative fixed budget when catalog metadata is missing or stale.
 */
export function resolveChatInputTokenBudget(
    model: ModelContextMetadata
): number {
    const contextLength =
        positiveInteger(model?.top_provider?.context_length) ??
        positiveInteger(model?.context_length);
    if (!contextLength) return DEFAULT_MAX_INPUT_TOKENS;

    const advertisedCompletion = positiveInteger(
        model?.top_provider?.max_completion_tokens
    );
    const proportionalReserve = Math.max(
        MIN_CHAT_INPUT_TOKENS,
        Math.floor(contextLength * 0.2)
    );
    const outputReserve = Math.min(
        advertisedCompletion ?? proportionalReserve,
        proportionalReserve,
        MAX_CHAT_OUTPUT_RESERVE_TOKENS
    );
    const minimumBudget = Math.min(
        MIN_CHAT_INPUT_TOKENS,
        Math.max(1, contextLength - 1)
    );

    return Math.max(
        minimumBudget,
        Math.min(
            contextLength - outputReserve,
            MAX_CHAT_INPUT_TOKENS
        )
    );
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
export async function trimOrMessagesByTokenBudget<T extends {
    role: string;
    content?: { type: string; text?: string }[] | string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: unknown;
}>(
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
            const metadata = [
                m.name ?? '',
                m.tool_call_id ?? '',
                m.tool_calls ? JSON.stringify(m.tool_calls) : '',
            ]
                .filter(Boolean)
                .join('\n');
            return countTokens(
                metadata ? `${text}\n${metadata}` : text
            );
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
