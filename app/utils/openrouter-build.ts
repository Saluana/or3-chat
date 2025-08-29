// Utility helpers to build OpenRouter payload messages including historical images.
// Focus: hydrate file_hashes into base64 data URLs, enforce limits, dedupe, and
// produce OpenAI-compatible content arrays.

import { parseFileHashes } from '~/db/files-util';

export interface BuildImageCandidate {
    hash: string;
    role: 'user' | 'assistant';
    messageIndex: number; // chronological index in original messages array
}

export interface ORContentPartText {
    type: 'text';
    text: string;
}
export interface ORContentPartImageUrl {
    type: 'image_url';
    image_url: { url: string };
}
export type ORContentPart = ORContentPartText | ORContentPartImageUrl;

export interface ORMessage {
    role: 'user' | 'assistant' | 'system';
    content: ORContentPart[];
}

// Caches on global scope to avoid repeated blob -> base64 conversions.
const dataUrlCache: Map<string, string> = ((
    globalThis as any
).__or3ImageDataUrlCache ||= new Map());
const inflight: Map<string, Promise<string | null>> = ((
    globalThis as any
).__or3ImageHydrateInflight ||= new Map());

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
        fr.onerror = () => reject(fr.error);
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
    content: any; // string | parts[]
    file_hashes?: string | null;
}

// Build OpenRouter messages with hydrated images.
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
                const hashes = parseFileHashes(m.file_hashes) || [];
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
            } catch {}
        }
        // Also inspect inline parts if array form
        if (Array.isArray(m.content)) {
            for (const p of m.content) {
                if (p?.type === 'image' && typeof p.image === 'string') {
                    if (
                        p.image.startsWith('data:image/') ||
                        /^https?:/i.test(p.image) ||
                        /^blob:/i.test(p.image)
                    ) {
                        hashCandidates.push({
                            hash: p.image,
                            role: m.role as any,
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
        } catch {}
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
        // Extract textual content
        let text = '';
        if (Array.isArray(m.content)) {
            const textParts = m.content.filter((p: any) => p.type === 'text');
            if (textParts.length)
                text = textParts.map((p: any) => p.text || '').join('');
        } else if (typeof m.content === 'string') {
            text = m.content;
        }
        if (text.trim().length === 0) text = ''; // keep empty string part to anchor order
        parts.push({ type: 'text', text });

        // Add images associated with this message index
        const imgs = byMessageIndex.get(i) || [];
        for (const img of imgs) {
            if (img.hash.startsWith('data:image/')) {
                parts.push({ type: 'image_url', image_url: { url: img.hash } });
            } else {
                // Try: (1) treat as stored hash; (2) treat as remote/blob ref
                let dataUrl = await hydrateHashToDataUrl(img.hash);
                if (!dataUrl) dataUrl = await remoteRefToDataUrl(img.hash);
                if (dataUrl) {
                    parts.push({
                        type: 'image_url',
                        image_url: { url: dataUrl },
                    });
                } else if (debug) {
                    console.warn('[or-build] hydrate-fail', {
                        ref: img.hash,
                        role: img.role,
                        messageIndex: img.messageIndex,
                    });
                }
            }
        }

        orMessages.push({ role: m.role, content: parts });
    }

    if (debug) {
        // Debug logging suppressed (done)
    }

    return orMessages;
}

// Decide modalities based on prepared ORMessages + heuristic prompt.
export function decideModalities(
    orMessages: ORMessage[],
    requestedModel?: string
): string[] {
    const hasImageInput = orMessages.some((m) =>
        m.content.some((p) => p.type === 'image_url')
    );
    const lastUser = [...orMessages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content.find((p) => p.type === 'text')?.text || '';
    const imageIntent =
        /(generate|create|make|produce|draw)\s+(an?\s+)?(image|picture|photo|logo|scene|illustration)/i.test(
            prompt
        );
    const modalities = ['text'];
    if (hasImageInput || imageIntent) modalities.push('image');
    return modalities;
}
