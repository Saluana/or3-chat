/**
 * @module app/utils/chat/useAi-internal/files.ts
 *
 * Purpose:
 * File handling utilities for AI chat operations. Manages file URL normalization,
 * blob conversion, and ContentPart preparation for model input.
 *
 * Responsibilities:
 * - Normalize file references for UI state (hash-based with verification)
 * - Convert files to Base64 data URLs for API transmission
 * - Handle blob URLs, hash references, and data URLs uniformly
 * - Support image and PDF file types for model context
 *
 * Non-responsibilities:
 * - Does not store files (delegated to db/files.ts)
 * - Does not validate file content (trusts MIME type)
 * - Does not handle non-image/PDF file types
 *
 * Architecture:
 * - Two-phase approach: UI uses hash references, API gets Base64
 * - Just-in-time conversion before model API calls
 * - Lazy imports of db/files to avoid circular dependencies
 *
 * Invariants:
 * - SSR-safe (checks for FileReader availability)
 * - Gracefully degrades on blob fetch failures
 * - Preserves original URL if conversion fails
 */

import type { ContentPart } from '~/utils/chat/types';

/**
 * Normalized file reference for UI state.
 *
 * Purpose:
 * Represents a file that has been verified and normalized for UI display.
 * Uses hash references instead of Base64 to keep memory footprint low.
 *
 * Constraints:
 * - Hash references are verified against IndexedDB before use
 * - _verified flag indicates blob was confirmed to exist
 */
export type NormalizedFileRef = {
    type: string;
    url: string;
    _verified?: true;
};

/**
 * Internal helper. Converts a Blob to Base64 data URL for API transmission.
 */
const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(blob);
    });

/**
 * UI path. Verifies blob existence and returns hash reference without Base64.
 *
 * Purpose:
 * Keeps UI state memory-efficient by using hash references instead of
 * embedding Base64 data. Verifies blobs exist in IndexedDB before
 * marking them as verified.
 *
 * Behavior:
 * - Returns original for non-image files or data URLs
 * - Verifies hash references against IndexedDB
 * - Passes through blob: URLs (already efficient)
 * - Marks verified references with _verified flag
 *
 * Constraints:
 * - SSR-safe (returns original if FileReader unavailable)
 * - Only processes image/ MIME types
 * - Gracefully handles missing blobs
 *
 * @example
 * ```ts
 * const ref = await normalizeFileUrl({ type: 'image/png', url: 'abc123' });
 * if (ref._verified) {
 *   // Safe to use in UI, blob exists
 * }
 * ```
 */
export async function normalizeFileUrl(f: { type: string; url: string }): Promise<NormalizedFileRef> {
    if (typeof FileReader === 'undefined') return f; // SSR safeguard
    const mime = f.type || '';
    // Only process images; leave other files (e.g., PDFs) untouched for now.
    if (!mime.startsWith('image/')) return f;
    let url = f.url || '';
    // Already a data URL - pass through (for pasted images not yet stored)
    if (url.startsWith('data:image/')) return { ...f, url };

    try {
        // Local hash -> verify blob exists, return hash reference
        if (!/^https?:|^data:|^blob:/i.test(url)) {
            const { getFileBlob } = await import('~/db/files');
            const blob = await getFileBlob(url);
            if (blob) {
                // Return hash reference - verified blob exists
                // UI will use createObjectURL when needed, API will convert later
                return { ...f, url, _verified: true };
            }
        }

        // blob: object URL - pass through (already efficient)
        if (url.startsWith('blob:')) {
            return { ...f, url, _verified: true };
        }
    } catch {
        // fall through to original url
    }

    return { ...f, url };
}

/**
 * API path. Converts hash references and blob URLs to Base64 for model input.
 *
 * Purpose:
 * Just-in-time conversion of file references to ContentParts suitable for
 * AI model APIs. Handles all file types: hash references, blob URLs, and data URLs.
 *
 * Behavior:
 * - Loads blobs from IndexedDB for hash references
 * - Fetches and converts blob: URLs
 * - Passes through existing data URLs
 * - Creates image or file ContentParts based on MIME type
 * - Skips files that fail conversion
 *
 * Constraints:
 * - Only supports images and PDFs
 * - Gracefully handles missing blobs
 * - Uses dynamic imports to avoid circular deps
 *
 * Non-Goals:
 * - Does not validate file content (trusts MIME)
 * - Does not handle non-image/PDF files
 *
 * @example
 * ```ts
 * const parts = await prepareFilesForModel([
 *   { type: 'image/png', url: 'abc123' },
 *   { type: 'image/jpeg', url: 'blob:...' }
 * ]);
 * // Returns [ContentPart, ContentPart]
 * ```
 */
export async function prepareFilesForModel(
    files: Array<{ type: string; url: string }>
): Promise<ContentPart[]> {
    const parts: ContentPart[] = [];

    for (const f of files) {
        if (!f.url) continue;
        const mime = f.type || '';

        try {
            // Hash reference -> load from IndexedDB and convert to Base64
            if (!/^https?:|^data:|^blob:/i.test(f.url)) {
                const { getFileMeta, getFileBlob } = await import('~/db/files');
                const blob = await getFileBlob(f.url);
                if (!blob) continue;

                const dataUrl = await blobToDataUrl(blob);

                if (mime.startsWith('image/')) {
                    parts.push({ type: 'image', image: dataUrl, mediaType: mime });
                } else if (mime === 'application/pdf') {
                    const meta = await getFileMeta(f.url).catch(() => null);
                    parts.push({
                        type: 'file',
                        data: dataUrl,
                        mediaType: mime,
                        name: meta?.name || 'document.pdf',
                    });
                }

                continue;
            }

            // blob: URL -> fetch and convert to Base64
            if (f.url.startsWith('blob:')) {
                try {
                    const blob = await $fetch<Blob>(f.url, { responseType: 'blob' });
                    const dataUrl = await blobToDataUrl(blob);
                    if (mime.startsWith('image/')) {
                        parts.push({ type: 'image', image: dataUrl, mediaType: mime });
                    }
                } catch {
                    // ignore fetch error
                }
                continue;
            }

            // Already Base64 data URL -> use directly
            if (f.url.startsWith('data:')) {
                if (mime.startsWith('image/')) {
                    parts.push({ type: 'image', image: f.url, mediaType: mime });
                }
            }
        } catch {
            // Skip files that fail to convert
        }
    }

    return parts;
}

/**
 * Converts a file hash to ContentPart for context injection.
 *
 * Purpose:
 * Just-in-time conversion of a stored file hash to a ContentPart suitable
 * for model context. Used when injecting file references into message history.
 *
 * Behavior:
 * - Loads file metadata and blob from IndexedDB
 * - Returns null if blob not found
 * - Only converts images and PDFs (ignores other types)
 * - Provides default name for PDFs if metadata missing
 *
 * Constraints:
 * - Returns null for non-image/PDF files
 * - Returns null on any error (graceful degradation)
 * - Uses dynamic imports to avoid circular deps
 *
 * @example
 * ```ts
 * const part = await hashToContentPart('abc123');
 * if (part) {
 *   // Inject into context
 * }
 * ```
 */
export async function hashToContentPart(hash: string): Promise<ContentPart | null> {
    try {
        const { getFileMeta, getFileBlob } = await import('~/db/files');
        const meta = await getFileMeta(hash).catch(() => null);
        const blob = await getFileBlob(hash);
        if (!blob) return null;

        // Only include images/PDFs to avoid bloating text-only contexts
        const mime = meta?.mime_type || blob.type || '';
        if (mime === 'application/pdf') {
            const dataUrl = await blobToDataUrl(blob);
            return {
                type: 'file',
                data: dataUrl,
                mediaType: mime,
                name: meta?.name || 'document.pdf',
            };
        }
        if (!mime.startsWith('image/')) return null;

        const dataUrl = await blobToDataUrl(blob);
        return { type: 'image', image: dataUrl, mediaType: mime };
    } catch {
        return null;
    }
}
