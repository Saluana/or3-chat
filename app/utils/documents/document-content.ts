import type { TipTapDocument, TipTapNode } from '~/types/database';

const IMAGE_NODE_NAMES = new Set(['image', 'or3Image']);

export function collectDocumentFileHashes(
    document: TipTapDocument | null | undefined
): string[] {
    if (!document?.content) return [];
    const hashes = new Set<string>();

    const visit = (node: TipTapNode): void => {
        if (IMAGE_NODE_NAMES.has(node.type)) {
            const hash = node.attrs?.hash;
            if (typeof hash === 'string' && hash.length > 0) hashes.add(hash);
        }
        node.content?.forEach(visit);
    };

    document.content.forEach(visit);
    return [...hashes].sort();
}

export function serializeDocumentFileHashes(
    document: TipTapDocument | null | undefined
): string | null {
    const hashes = collectDocumentFileHashes(document);
    return hashes.length ? JSON.stringify(hashes) : null;
}

export function parseDocumentFileHashes(
    value: string | null | undefined
): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((entry): entry is string => typeof entry === 'string')
            : [];
    } catch {
        return [];
    }
}
