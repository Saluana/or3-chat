/**
 * Shared payload sanitization for sync operations
 *
 * This utility ensures consistent sanitization of payloads before
 * they are sent to the sync backend.
 */
import { toServerFormat } from './field-mappings';

/** Tables that require a `deleted` field */
const TABLES_WITH_DELETED = ['threads', 'messages', 'projects', 'posts', 'kv', 'file_meta', 'notifications'];

/** Max inline data URL size in bytes (anything larger will be stripped) */
const MAX_INLINE_DATA_URL_SIZE = 10000; // 10KB - small icons/thumbnails OK, large images stripped

/**
 * Sanitize a payload for sync by removing internal/derived fields
 *
 * @param tableName - The table the payload belongs to
 * @param payload - The raw payload to sanitize
 * @param operation - Whether this is a put or delete operation
 * @returns Sanitized payload or undefined for delete operations with no payload
 */
export function sanitizePayloadForSync(
    tableName: string,
    payload: unknown,
    operation: 'put' | 'delete'
): Record<string, unknown> | undefined {
    // If no payload provided or invalid type, return undefined
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    // Filter out dotted keys (Dexie compound index artifacts)
    const sanitized = { ...(payload as Record<string, unknown>) };
    for (const key in sanitized) {
        if (key.includes('.')) {
            delete sanitized[key];
        }
    }

    // Remove HLC - it's stored separately in the stamp
    delete sanitized.hlc;

    // Remove derived fields
    if (tableName === 'file_meta') {
        // ref_count is derived locally, not synced
        delete sanitized.ref_count;
    }

    // Ensure required `deleted` field exists for synced tables
    // Legacy local data may not have this field
    if (TABLES_WITH_DELETED.includes(tableName) && sanitized.deleted === undefined) {
        sanitized.deleted = operation === 'delete' ? true : false;
    }

    // Ensure required `forked` field exists for threads
    // Legacy local threads may not have this field
    if (tableName === 'threads' && sanitized.forked === undefined) {
        sanitized.forked = false;
    }

    // Convert error: null to undefined for Convex schema compatibility
    // (Convex expects v.optional(v.string()), so null is invalid but undefined is fine)
    if (tableName === 'messages' && sanitized.error === null) {
        delete sanitized.error;
    }

    // Convert value: null to undefined for KV Convex schema compatibility
    // (Convex expects v.optional(v.string()), so null is invalid but undefined is fine)
    if (tableName === 'kv' && sanitized.value === null) {
        delete sanitized.value;
    }

    // Strip large base64 data URLs from message attachments
    // File content should be synced via file_meta/file_blobs, not embedded in messages
    if (tableName === 'messages' && sanitized.data) {
        sanitized.data = stripLargeDataUrls(sanitized.data as Record<string, unknown>);
    }

    // Handle snake_case/camelCase mapping for posts
    return toServerFormat(tableName, sanitized);
}

/**
 * Recursively strip large base64 data URLs from an object.
 * Preserves small data URLs (icons, thumbnails) but removes large embedded images.
 */
function stripLargeDataUrls(data: unknown): unknown {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === 'string') {
        // Check if it's a data URL that's too large
        if (data.startsWith('data:') && data.length > MAX_INLINE_DATA_URL_SIZE) {
            // Return placeholder indicating the data was stripped
            return '[data-url-stripped]';
        }
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(item => stripLargeDataUrls(item));
    }

    if (typeof data === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            result[key] = stripLargeDataUrls(value);
        }
        return result;
    }

    return data;
}
