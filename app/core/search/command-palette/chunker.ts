import {
    PALETTE_CHUNK_OVERLAP,
    PALETTE_CHUNK_SIZE,
    type PaletteIndexDocument,
    type PaletteResource,
} from './types';

export interface ChunkPlan {
    id: string;
    chunkIndex: number;
    body: string;
}

/**
 * Split content into overlapping chunks, preferring whitespace near the target length.
 */
export function chunkText(
    content: string,
    options?: { size?: number; overlap?: number }
): string[] {
    const size = options?.size ?? PALETTE_CHUNK_SIZE;
    const overlap = options?.overlap ?? PALETTE_CHUNK_OVERLAP;
    if (!Number.isFinite(size) || size <= 0) {
        throw new RangeError('chunk size must be a finite number greater than zero');
    }
    if (!Number.isFinite(overlap) || overlap < 0 || overlap >= size) {
        throw new RangeError(
            'chunk overlap must be finite, non-negative, and smaller than size'
        );
    }
    const text = content ?? '';
    if (!text) return [''];
    if (text.length <= size) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + size, text.length);
        if (end < text.length) {
            const window = text.slice(start, end);
            const breakAt = Math.max(
                window.lastIndexOf('\n'),
                window.lastIndexOf(' ')
            );
            if (breakAt > size * 0.5) {
                end = start + breakAt;
            }
        }
        chunks.push(text.slice(start, end));
        if (end >= text.length) break;
        const nextStart = Math.max(0, end - overlap);
        if (nextStart <= start) {
            throw new RangeError('chunk options must advance the cursor');
        }
        start = nextStart;
    }
    return chunks;
}

export function stableChunkId(
    sourceId: string,
    recordId: string,
    revision: string,
    chunkIndex: number
): string {
    return `${sourceId}:${recordId}:${revision}:${chunkIndex}`;
}

export function buildChunkPlan(
    resource: PaletteResource,
    options?: { size?: number; overlap?: number }
): ChunkPlan[] {
    const revision = resource.revision ?? String(resource.updatedAt ?? 0);
    const body = resource.content ?? '';
    const parts = chunkText(body, options);
    return parts.map((part, chunkIndex) => ({
        id: stableChunkId(
            resource.sourceId,
            resource.recordId,
            revision,
            chunkIndex
        ),
        chunkIndex,
        body: part,
    }));
}

export function resourceToIndexDocuments(
    resource: PaletteResource
): PaletteIndexDocument[] {
    const plans = buildChunkPlan(resource);
    const keywords = (resource.keywords ?? []).join(' ');
    return plans.map((plan) => ({
        id: plan.id,
        resourceKey: resource.key,
        recordId: resource.recordId,
        title: resource.title,
        subtitle: resource.subtitle ?? '',
        keywords,
        body: plan.body,
        updatedAt: resource.updatedAt ?? 0,
        chunkIndex: plan.chunkIndex,
    }));
}

/**
 * Tracks chunk ids per resource for incremental replace/remove.
 */
export class ResourceChunkTracker {
    private readonly resourceToChunks = new Map<string, string[]>();

    get(resourceKey: string): readonly string[] {
        return this.resourceToChunks.get(resourceKey) ?? [];
    }

    set(resourceKey: string, chunkIds: readonly string[]): void {
        this.resourceToChunks.set(resourceKey, [...chunkIds]);
    }

    remove(resourceKey: string): string[] {
        const existing = this.resourceToChunks.get(resourceKey) ?? [];
        this.resourceToChunks.delete(resourceKey);
        return existing;
    }

    clear(): void {
        this.resourceToChunks.clear();
    }

    keys(): string[] {
        return [...this.resourceToChunks.keys()];
    }
}
