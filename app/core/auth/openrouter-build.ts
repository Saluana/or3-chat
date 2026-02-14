/**
 * @module app/core/auth/openrouter-build
 *
 * Purpose:
 * Transforms local chat messages into the OpenRouter/OpenAI-compatible wire
 * format. The primary complexity is image handling: hydrating local file hashes
 * and remote URLs into base64 data URLs suitable for multimodal API calls.
 *
 * Responsibilities:
 * - Build `ORMessage[]` arrays from local `ChatMessageLike` records
 * - Hydrate `file_hashes` (local blobs) into base64 data URLs
 * - Hydrate remote/blob URLs into data URLs with size guards (5 MB cap)
 * - Enforce image limits, deduplication, and inclusion policies
 * - Decide output modalities based on prompt heuristics
 *
 * Non-responsibilities:
 * - Does not send the request (see streaming composables)
 * - Does not manage the model catalog or API key
 * - Does not handle response parsing
 *
 * Constraints:
 * - Global data URL cache is bounded (LRU, max 64 entries)
 * - Remote fetches have an 8-second timeout to avoid blocking sends
 * - File parts for non-image types (PDFs) are handled separately from image_url parts
 * - Modality detection is intentionally conservative (text-only output)
 *
 * @see core/auth/models-service for model catalog
 * @see db/files for local blob storage
 */

import { parseFileHashes } from '~/db/files-util';

/**
 * Purpose:
 * Lightweight reference to an image-like input discovered while scanning message history.
 * Used to apply inclusion policies (recent-only, user-only) and dedupe rules.
 */
export interface BuildImageCandidate {
    hash: string;
    role: 'user' | 'assistant';
    messageIndex: number; // chronological index in original messages array
}

/**
 * Purpose:
 * OpenRouter/OpenAI message content part for plain text.
 */
export interface ORContentPartText {
    type: 'text';
    text: string;
}
/**
 * Purpose:
 * OpenRouter/OpenAI message content part for images.
 *
 * Constraints:
 * - `image_url.url` is typically a `data:image/*` URL when hydrated from local files
 */
export interface ORContentPartImageUrl {
    type: 'image_url';
    image_url: { url: string };
}
/**
 * Purpose:
 * OpenRouter/OpenAI message content part for non-image files.
 */
export interface ORContentPartFile {
    type: 'file';
    file: { filename: string; file_data: string };
}
/**
 * Purpose:
 * Union of supported content parts produced by this module.
 */
export type ORContentPart =
    | ORContentPartText
    | ORContentPartImageUrl
    | ORContentPartFile;

/**
 * Purpose:
 * OpenRouter/OpenAI-compatible chat message.
 */
export interface ORMessage {
    role: 'user' | 'assistant' | 'system';
    content: ORContentPart[];

    tool_calls?: unknown[];
}

// Caches on global scope to avoid repeated blob -> base64 conversions.
type GlobalCaches = {
    __or3ImageDataUrlCache?: Map<string, string>;
    __or3ImageHydrateInflight?: Map<string, Promise<string | null>>;
};
const g = globalThis as GlobalCaches;
if (!g.__or3ImageDataUrlCache) g.__or3ImageDataUrlCache = new Map();
if (!g.__or3ImageHydrateInflight) g.__or3ImageHydrateInflight = new Map();
const dataUrlCache: Map<string, string> = g.__or3ImageDataUrlCache;
const inflight: Map<
    string,
    Promise<string | null>
> = g.__or3ImageHydrateInflight;
// Simple LRU pruning to prevent unbounded growth
const MAX_DATA_URL_CACHE = 64;
function pruneCache(map: Map<string, string>, limit = MAX_DATA_URL_CACHE) {
    while (map.size > limit) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
}

// Remote / blob URL hydration cache shares same map (keyed by original ref string)
// We intentionally do not distinguish hash vs URL; collisions are unlikely and harmless
// because a content hash would never start with http/blob.
async function remoteRefToDataUrl(ref: string): Promise<string | null> {
    if (ref.startsWith('data:image/')) return ref; // already data URL
    if (!/^https?:|^blob:/.test(ref)) return null;
    if (dataUrlCache.has(ref)) return dataUrlCache.get(ref)!;
    if (inflight.has(ref)) return inflight.get(ref)!;
    const p = (async () => {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000); // 8s safety timeout
            const resp = await fetch(ref, { signal: ctrl.signal });
            clearTimeout(t);
            if (!resp.ok) throw new Error('fetch-failed:' + resp.status);
            const blob = await resp.blob();
            // Basic guardrail: cap at ~5MB to avoid huge token usage
            if (blob.size > 5 * 1024 * 1024) return null;
            const dataUrl = await blobToDataUrl(blob);
            dataUrlCache.set(ref, dataUrl);
            pruneCache(dataUrlCache);
            return dataUrl;
        } catch {
            return null;
        } finally {
            inflight.delete(ref);
        }
    })();
    inflight.set(ref, p);
    return p;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(blob);
    });
}

async function hydrateHashToDataUrl(hash: string): Promise<string | null> {
    if (dataUrlCache.has(hash)) return dataUrlCache.get(hash)!;
    if (inflight.has(hash)) return inflight.get(hash)!;
    const p = (async () => {
        try {
            const { getFileBlob } = await import('~/db/files');
            const blob = await getFileBlob(hash);
            if (!blob) throw new Error('blob-missing');
            const dataUrl = await blobToDataUrl(blob);
            dataUrlCache.set(hash, dataUrl);
            pruneCache(dataUrlCache);
            return dataUrl;
        } catch {
            return null;
        } finally {
            inflight.delete(hash);
        }
    })();
    inflight.set(hash, p);
    return p;
}

/**
 * Purpose:
 * Controls how message history is transformed into OpenRouter wire messages.
 *
 * Notes:
 * - `filterIncludeImages` behaves like a filter hook and can drop or reorder candidates
 * - `imageInclusionPolicy` affects how far back message scanning goes
 */
export interface BuildOptions {
    maxImageInputs?: number; // total images across history
    dedupeImages?: boolean; // skip duplicate hashes
    imageInclusionPolicy?:
        | 'all'
        | 'recent'
        | 'recent-user'
        | 'recent-assistant';
    recentWindow?: number; // number of most recent messages to scan when policy is recent*
    // Hook like filter: (candidates) => filteredCandidates
    filterIncludeImages?: (
        candidates: BuildImageCandidate[]
    ) => Promise<BuildImageCandidate[]> | BuildImageCandidate[];
    debug?: boolean; // verbose logging
}

// Default heuristics constants
const DEFAULT_MAX_IMAGE_INPUTS = 8;

interface ChatMessageLike {
    role: 'user' | 'assistant' | 'system';
    content: string | ChatContentPart[]; // proper content typing
    file_hashes?: string | null;
}

/** Incoming message content part (from Vercel AI SDK / DB format) */
interface ChatContentPart {
    type: string;
    text?: string;
    image?: string | Uint8Array | Buffer;
    data?: string | Uint8Array | Buffer;
    mediaType?: string;
    mime?: string;
    filename?: string;
    name?: string;
}

// Build OpenRouter messages with hydrated images.
/**
 * Purpose:
 * Build OpenRouter/OpenAI-compatible message array from local chat records.
 *
 * Behavior:
 * - Converts string content to a text part
 * - Hydrates `file_hashes` and supported image refs into `data:image/*` URLs
 * - Enforces image inclusion policy, dedupe, and max image count
 *
 * Constraints:
 * - Hydration uses an in-memory global LRU cache to avoid repeated blob conversions
 * - Remote and blob URLs are fetched and converted with size and timeout guards
 */
export async function buildOpenRouterMessages(
    messages: ChatMessageLike[],
    opts: BuildOptions = {}
): Promise<ORMessage[]> {
    const {
        maxImageInputs = DEFAULT_MAX_IMAGE_INPUTS,
        dedupeImages = true,
        imageInclusionPolicy = 'all',
        recentWindow = 12,
        filterIncludeImages,
        debug = false,
    } = opts;

    if (debug) {
        // Debug logging suppressed (begin)
    }

    // Determine candidate messages for image inclusion under policy.
    let candidateMessages: number[] = [];
    if (imageInclusionPolicy === 'all') {
        candidateMessages = messages.map((_, i) => i);
    } else if (imageInclusionPolicy.startsWith('recent')) {
        const start = Math.max(0, messages.length - recentWindow);
        candidateMessages = [];
        for (let i = start; i < messages.length; i++) candidateMessages.push(i);
    }

    // Collect hash candidates
    const hashCandidates: BuildImageCandidate[] = [];
    for (const idx of candidateMessages) {
        const m = messages[idx];
        if (!m) continue;
        if (m.file_hashes) {
            try {
                const hashes = parseFileHashes(m.file_hashes);
                for (const h of hashes) {
                    if (!h) continue;
                    if (
                        imageInclusionPolicy === 'recent-user' &&
                        m.role !== 'user'
                    )
                        continue;
                    if (
                        imageInclusionPolicy === 'recent-assistant' &&
                        m.role !== 'assistant'
                    )
                        continue;
                    if (m.role === 'user' || m.role === 'assistant') {
                        hashCandidates.push({
                            hash: h,
                            role: m.role,
                            messageIndex: idx,
                        });
                    }
                }
            } catch {
                // Parse error - skip this message
            }
        }
        // Also inspect inline parts if array form
        if (Array.isArray(m.content)) {
            for (const p of m.content) {
                if (p.type === 'image' && typeof p.image === 'string') {
                    if (
                        p.image.startsWith('data:image/') ||
                        /^https?:/i.test(p.image) ||
                        /^blob:/i.test(p.image)
                    ) {
                        hashCandidates.push({
                            hash: p.image,
                            role: m.role as BuildImageCandidate['role'],
                            messageIndex: idx,
                        });
                    }
                }
            }
        }
    }

    if (debug) {
        // Debug logging suppressed (candidates)
    }

    // Optional external filter
    let filtered = hashCandidates;
    if (filterIncludeImages) {
        try {
            const res = await filterIncludeImages(hashCandidates);
            if (Array.isArray(res)) filtered = res;
        } catch {
            // Filter error - use unfiltered
        }
    }

    // Enforce max & dedupe
    const seen = new Set<string>();
    const selected: BuildImageCandidate[] = [];
    for (const c of filtered) {
        if (selected.length >= maxImageInputs) break;
        if (dedupeImages && seen.has(c.hash)) continue;
        seen.add(c.hash);
        selected.push(c);
    }

    if (debug) {
        // Debug logging suppressed (selected)
    }

    // Group selected hashes by message index for convenient inclusion
    const byMessageIndex = new Map<number, BuildImageCandidate[]>();
    for (const s of selected) {
        const list = byMessageIndex.get(s.messageIndex) || [];
        list.push(s);
        byMessageIndex.set(s.messageIndex, list);
    }

    // Build ORMessage array preserving original order
    const orMessages: ORMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m) continue;
        const parts: ORContentPart[] = [];
        let hasTextPart = false;
        if (Array.isArray(m.content)) {
            for (const part of m.content) {
                if (part.type === 'text') {
                    parts.push({ type: 'text', text: part.text || '' });
                    hasTextPart = true;
                    continue;
                }
                if (part.type === 'file') {
                    if (!part.data) continue;
                    const mediaType =
                        part.mediaType ||
                        part.mime ||
                        'application/octet-stream';
                    const isPdf = mediaType === 'application/pdf';
                    const filename =
                        part.filename ||
                        part.name ||
                        (isPdf ? 'document.pdf' : 'file');
                    // Convert Uint8Array/Buffer to string if needed
                    let fileData: string | null | undefined =
                        typeof part.data === 'string' ? part.data : null; // Binary data needs special handling below

                    // Local hash or opaque ref -> hydrate via blob to data URL preserving mime
                    if (!/^data:|^https?:|^blob:/i.test(String(fileData))) {
                        try {
                            const { getFileBlob } = await import('~/db/files');
                            const blob = await getFileBlob(String(fileData));
                            if (blob) {
                                const mime = blob.type || mediaType;
                                const dataUrl = await blobToDataUrl(blob);
                                fileData = dataUrl.replace(
                                    /^data:[^;]+;/,
                                    `data:${mime};`
                                );
                            } else {
                                const hydrated = await hydrateHashToDataUrl(
                                    String(fileData)
                                );
                                if (hydrated) fileData = hydrated;
                            }
                            if (!fileData) {
                                const remote = await remoteRefToDataUrl(
                                    String(fileData)
                                );
                                if (remote) fileData = remote;
                            }
                        } catch {
                            fileData = null;
                        }
                    }

                    // If still not a usable scheme and it's a blob: URL, we can't send blob: (server can't fetch) -> skip
                    if (fileData && /^blob:/i.test(String(fileData))) {
                        if (debug)
                            console.warn(
                                '[or-build] skipping blob: URL (inaccessible server-side)',
                                { filename }
                            );
                        fileData = null;
                    }
                    if (
                        fileData &&
                        isPdf &&
                        !fileData.startsWith('data:application/pdf')
                    ) {
                        // Normalize pdf data URL mime prefix if possible
                        if (fileData.startsWith('data:')) {
                            fileData = fileData.replace(
                                /^data:[^;]+/,
                                'data:application/pdf'
                            );
                        }
                    }
                    if (fileData && /^data:|^https?:/i.test(String(fileData))) {
                        parts.push({
                            type: 'file',
                            file: { filename, file_data: String(fileData) },
                        });
                    } else if (debug) {
                        console.warn(
                            '[or-build] skipping file part, could not hydrate',
                            { ref: part.data, filename, messageIndex: i }
                        );
                    }
                }
            }
        } else if (typeof m.content === 'string') {
            parts.push({ type: 'text', text: m.content });
            hasTextPart = true;
        }
        if (!hasTextPart) {
            parts.push({ type: 'text', text: '' });
        }

        // Add images associated with this message index (only if truly images)
        const imgs = byMessageIndex.get(i) || [];
        for (const img of imgs) {
            // Quick allow path: already a data image URL
            if (img.hash.startsWith('data:image/')) {
                parts.push({ type: 'image_url', image_url: { url: img.hash } });
                continue;
            }
            // Remote URL that looks like an image (basic heuristic)
            if (
                /^https?:/i.test(img.hash) &&
                /(\.png|\.jpe?g|\.gif|\.webp|\.avif|\?)/i.test(img.hash)
            ) {
                parts.push({ type: 'image_url', image_url: { url: img.hash } });
                continue;
            }
            // If it's a local hash (not http/data/blob) inspect metadata to confirm mime starts with image/
            const looksLocal = !/^https?:|^data:|^blob:/i.test(img.hash);
            let isImage = false;
            if (looksLocal) {
                try {
                    const { getFileMeta } = await import('~/db/files');
                    const meta = await getFileMeta(img.hash).catch(() => null);
                    const metaMime =
                        typeof meta?.mime_type === 'string'
                            ? meta.mime_type
                            : typeof (meta as { mime?: string } | null)?.mime ===
                              'string'
                            ? (meta as { mime?: string }).mime
                            : typeof (meta as { mimeType?: string } | null)
                                  ?.mimeType === 'string'
                            ? (meta as { mimeType?: string }).mimeType
                            : null;
                    if (
                        meta?.kind === 'image' ||
                        (metaMime && metaMime.startsWith('image/'))
                    ) {
                        isImage = true;
                    }
                } catch {
                    // File meta lookup failed - assume image
                }
            }
            if (!isImage && looksLocal) {
                // Not an image (likely a PDF or other file) -> skip to avoid triggering image-capable endpoint routing
                continue;
            }
            // At this point either it's declared an image or remote unknown -> attempt hydration
            let dataUrl = await hydrateHashToDataUrl(img.hash);
            if (!dataUrl) dataUrl = await remoteRefToDataUrl(img.hash);
            if (dataUrl && dataUrl.startsWith('data:image/')) {
                parts.push({ type: 'image_url', image_url: { url: dataUrl } });
            } else if (debug) {
                console.warn('[or-build] hydrate-fail-or-non-image', {
                    ref: img.hash,
                    role: img.role,
                    messageIndex: img.messageIndex,
                });
            }
        }

        orMessages.push({ role: m.role, content: parts });
    }

    if (debug) {
        // Debug logging suppressed (done)
    }

    return orMessages;
}

// Decide modalities based on heuristic prompt intent.
// Note: modalities controls OUTPUT format, not input capability.
// Image input (vision) does NOT require image output modality.
export function decideModalities(orMessages: ORMessage[]): string[] {
    const lastUser = [...orMessages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content.find((p) => p.type === 'text')?.text || '';
    // Only request image output when user explicitly wants image generation
    const imageGenerationIntent =
        /(generate|create|make|produce|draw)\s+(an?\s+)?(image|picture|photo|logo|scene|illustration)/i.test(
            prompt
        );
    // Even with intent, most models don't support image output - let OpenRouter handle it
    // For now, always return text-only to avoid 404 errors on non-image-gen models
    return ['text'];
}
