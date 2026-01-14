/**
 * Shared payload sanitization for sync operations
 *
 * This utility ensures consistent sanitization of payloads before
 * they are sent to the sync backend.
 */

/**
 * Sanitize a payload for sync by removing internal/derived fields
 *
 * @param tableName - The table the payload belongs to
 * @param payload - The raw payload to sanitize
 * @param operation - Whether this is a put or delete operation
 * @returns Sanitized payload or undefined for delete operations
 */
export function sanitizePayloadForSync(
    tableName: string,
    payload: unknown,
    operation: 'put' | 'delete'
): Record<string, unknown> | undefined {
    // Delete operations don't need payload
    if (operation === 'delete' || !payload || typeof payload !== 'object') {
        return undefined;
    }

    // Filter out dotted keys (Dexie compound index artifacts)
    const sanitized = Object.fromEntries(
        Object.entries(payload as Record<string, unknown>).filter(
            ([key]) => !key.includes('.')
        )
    );

    // Remove HLC - it's stored separately in the stamp
    delete sanitized.hlc;

    // Remove derived fields
    if (tableName === 'file_meta') {
        // ref_count is derived locally, not synced
        delete sanitized.ref_count;
    }

    // Handle snake_case/camelCase mapping for posts
    if (tableName === 'posts' && 'postType' in sanitized && !('post_type' in sanitized)) {
        sanitized.post_type = sanitized.postType;
        delete sanitized.postType;
    }

    return sanitized;
}
