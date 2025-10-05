// Canonical UI message utilities (content part type no longer needed directly)
import { parseHashes } from '~/utils/files/attachments';

export interface UiChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    text: string; // flattened text + markdown image placeholders
    file_hashes?: string[];
    reasoning_text?: string | null;
    stream_id?: string;
    pending?: boolean;
}

export function partsToText(parts: any): string {
    if (!parts) return '';
    if (typeof parts === 'string') return parts;
    if (!Array.isArray(parts)) return '';
    let out = '';
    for (const p of parts) {
        if (!p) continue;
        if (typeof p === 'string') {
            out += p;
            continue;
        }
        if (typeof p === 'object') {
            if (p.type === 'text' && typeof p.text === 'string') out += p.text;
            else if (p.type === 'image') {
                // Don't include base64 data URLs in text - they'll be shown via attachments gallery
                // Skip image parts entirely for user messages (attachments display separately)
                // Assistant images should already have file-hash placeholders injected below
            }
        }
    }
    return out;
}

export function ensureUiMessage(raw: any): UiChatMessage {
    const id = raw.id || raw.stream_id || crypto.randomUUID();
    const role = raw.role || 'user';
    let file_hashes: string[] | undefined;
    if (Array.isArray(raw.file_hashes)) file_hashes = raw.file_hashes.slice();
    else if (typeof raw.file_hashes === 'string') {
        try {
            file_hashes = parseHashes(raw.file_hashes);
        } catch {
            // ignore
        }
    }
    const reasoning_text =
        typeof raw.reasoning_text === 'string' ? raw.reasoning_text : null;
    let text: string;
    if (typeof raw.text === 'string' && !Array.isArray(raw.text)) {
        text = raw.text;
    } else if (typeof raw.content === 'string') {
        text = raw.content;
    } else {
        text = partsToText(raw.content);
    }
    // Inject markdown placeholders for assistant file_hashes with de-duplication logic.
    // Goal: avoid showing the same logical image twice when the model already emitted
    // a markdown image (e.g. data: URL) for a hash we also have stored.
    if (role === 'assistant' && file_hashes && file_hashes.length) {
        const IMG_RE = /!\[[^\]]*]\(([^)]+)\)/g; // basic markdown image matcher
        const existingImages = [...text.matchAll(IMG_RE)];
        const existingCount = existingImages.length;
        if (existingCount < file_hashes.length) {
            // Determine how many placeholders we still need to represent each hash once.
            const needed = file_hashes.length - existingCount;
            // Candidate hashes: those not already present via a file-hash placeholder.
            const candidate = file_hashes.filter(
                (h) => h && !text.includes(`file-hash:${h}`)
            );
            // Only take up to the number we still need to avoid duplication.
            const missing = candidate.slice(0, needed);
            if (missing.length) {
                const placeholders = missing.map(
                    (h) => `![generated image](file-hash:${h})`
                );
                text += (text ? '\n\n' : '') + placeholders.join('\n\n');
                if (import.meta.dev) {
                    console.debug(
                        '[uiMessages.ensureUiMessage] appended placeholders',
                        {
                            id,
                            added: missing.length,
                            totalHashes: file_hashes.length,
                            existingCount,
                        }
                    );
                }
            } else if (import.meta.dev) {
                console.debug(
                    '[uiMessages.ensureUiMessage] no additional placeholders needed',
                    { id, totalHashes: file_hashes.length, existingCount }
                );
            }
        } else if (import.meta.dev) {
            if (import.meta.dev)
                console.debug(
                    '[uiMessages.ensureUiMessage] existing images >= hashes; skipping placeholder injection',
                    { id, totalHashes: file_hashes.length, existingCount }
                );
        }
    }
    return {
        id,
        role,
        text,
        file_hashes,
        reasoning_text,
        stream_id: raw.stream_id,
        pending: raw.pending,
    };
}

// Legacy raw storage (non reactive). We expose accessor for plugins.
const _rawMessages: any[] = [];
export function recordRawMessage(m: any) {
    _rawMessages.push(m);
}
export function getRawMessages(): readonly any[] {
    return _rawMessages.slice();
}
