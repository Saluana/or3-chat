import { promptJsonToString } from '~/utils/chat/prompt-utils';
import { deriveMessageContent } from '~/utils/chat/messages';
import { PALETTE_EXCLUDED_POST_TYPES } from './validation';

/**
 * Convert TipTap JSON (object or string) into plain text.
 * Invalid JSON falls back to the raw string.
 */
export function tiptapToPlainText(content: unknown): string {
    if (content == null) return '';
    if (typeof content === 'string') {
        const trimmed = content.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed) as unknown;
                const text = promptJsonToString(
                    parsed as Parameters<typeof promptJsonToString>[0]
                );
                return text || trimmed;
            } catch {
                return content;
            }
        }
        return content;
    }
    if (typeof content === 'object') {
        try {
            return (
                promptJsonToString(
                    content as Parameters<typeof promptJsonToString>[0]
                ) || ''
            );
        } catch {
            return '';
        }
    }
    return String(content);
}

/**
 * Normalize chat message content for indexing.
 */
export function normalizeMessageContent(msg: {
    content?: unknown;
    data?: unknown;
}): string {
    return deriveMessageContent(
        msg as Parameters<typeof deriveMessageContent>[0]
    );
}

/**
 * Convert whitelisted scalar metadata into short keyword strings.
 */
export function normalizeScalarMetadata(
    meta: unknown,
    metaKeys: readonly string[] | undefined
): string[] {
    return Object.entries(pickScalarMetadata(meta, metaKeys)).map(
        ([key, value]) => `${key}:${String(value)}`
    );
}

/** Preserve the original scalar types for preview metadata. */
export function pickScalarMetadata(
    meta: unknown,
    metaKeys: readonly string[] | undefined
): Record<string, string | number | boolean | null> {
    if (!metaKeys?.length || meta == null) return {};
    const obj =
        typeof meta === 'string'
            ? safeParseObject(meta)
            : typeof meta === 'object'
              ? (meta as Record<string, unknown>)
              : null;
    if (!obj) return {};

    const values: Record<string, string | number | boolean | null> = {};
    for (const key of metaKeys) {
        const value = getPath(obj, key);
        if (value === null) {
            values[key] = null;
            continue;
        }
        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            values[key] = value;
        }
    }
    return values;
}

export function isIndexablePostType(postType: string): boolean {
    return Boolean(postType) && !PALETTE_EXCLUDED_POST_TYPES.has(postType);
}

function safeParseObject(raw: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
    if (!path.includes('.')) return obj[path];
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
