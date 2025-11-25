import type { FileMeta } from '~/db/schema';

/**
 * Create a mock FileMeta object for testing.
 * @param hash - The hash of the file
 * @returns A mock FileMeta object with default test values
 */
export function makeMeta(hash: string): FileMeta {
    return {
        hash,
        name: `Image ${hash}`,
        mime_type: 'image/png',
        kind: 'image',
        size_bytes: 256,
        width: 32,
        height: 32,
        page_count: undefined,
        ref_count: 0,
        created_at: 1,
        updated_at: 2,
        deleted: false,
        clock: 0,
    };
}
