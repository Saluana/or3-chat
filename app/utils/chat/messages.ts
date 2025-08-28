import type { ContentPart } from './types';

// Build UI parts: text first, then extra text blocks, then attachments
export function buildParts(
    outgoing: string,
    files?: { type: string; url: string }[],
    extraTextParts?: string[]
): ContentPart[] {
    return [
        { type: 'text', text: outgoing },
        ...(extraTextParts || []).map<ContentPart>((t) => ({
            type: 'text',
            text: t,
        })),
        ...(files ?? []).map<ContentPart>((f) =>
            (f.type ?? '').startsWith('image/')
                ? { type: 'image', image: f.url, mediaType: f.type }
                : { type: 'file', data: f.url, mediaType: f.type }
        ),
    ];
}

// Extract concatenated text from a ChatMessage.content
export function getTextFromContent(
    content: string | ContentPart[] | undefined | null
) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    return (content as ContentPart[])
        .filter((p) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join('');
}

// Merge and dedupe file-hash arrays
export function mergeFileHashes(
    existing?: string[] | null,
    fromAssistant?: string[]
) {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(fromAssistant) ? fromAssistant : [];
    return Array.from(new Set([...a, ...b]));
}

// Drop oldest images across built OR messages, keeping `max`
export function trimOrMessagesImages(orMessages: any[], max: number) {
    try {
        const totalImagesPre = orMessages.reduce(
            (a: number, m: any) =>
                a + m.content.filter((p: any) => p.type === 'image_url').length,
            0
        );
        if (totalImagesPre <= max) return;

        let toDrop = totalImagesPre - max;
        for (const m of orMessages) {
            if (toDrop <= 0) break;
            const next: any[] = [];
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
