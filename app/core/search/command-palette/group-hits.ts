import { buildEscapedSnippet } from './snippets';
import type { PaletteIndexDocument, PaletteResource, PaletteResult } from './types';

export interface ScoredChunkHit {
    document: PaletteIndexDocument;
    score: number;
}

/**
 * Collapse multiple chunk/message hits into one resource-level result using
 * the highest-scoring chunk for the snippet.
 */
export function groupHitsByResource(
    hits: readonly ScoredChunkHit[],
    resourcesByKey: ReadonlyMap<string, PaletteResource>,
    term: string
): PaletteResult[] {
    const bestByResource = new Map<string, ScoredChunkHit>();

    for (const hit of hits) {
        const key = hit.document.resourceKey;
        const existing = bestByResource.get(key);
        if (!existing || hit.score > existing.score) {
            bestByResource.set(key, hit);
        } else if (
            hit.score === existing.score &&
            hit.document.chunkIndex < existing.document.chunkIndex
        ) {
            bestByResource.set(key, hit);
        }
    }

    const results: PaletteResult[] = [];
    for (const [resourceKey, hit] of bestByResource) {
        const resource = resourcesByKey.get(resourceKey);
        if (!resource) continue;
        const snippetSource =
            hit.document.body || resource.content || resource.title;
        results.push({
            key: resource.key,
            sourceId: resource.sourceId,
            categoryId: resource.categoryId,
            recordId: resource.recordId,
            title: resource.title,
            subtitle: resource.subtitle,
            snippet: term
                ? buildEscapedSnippet(snippetSource, term)
                : undefined,
            icon: resource.icon,
            updatedAt: resource.updatedAt,
            score: hit.score,
            primaryAction: resource.primaryAction,
            secondaryActions: resource.secondaryActions ?? [],
            metadata: resource.metadata ?? {},
            pluginGeneration: resource.pluginGeneration,
        });
    }

    results.sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const updatedDiff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
        if (updatedDiff !== 0) return updatedDiff;
        return a.key.localeCompare(b.key);
    });
    return results;
}

export function resourceToResult(
    resource: PaletteResource,
    options?: { score?: number; snippet?: string }
): PaletteResult {
    return {
        key: resource.key,
        sourceId: resource.sourceId,
        categoryId: resource.categoryId,
        recordId: resource.recordId,
        title: resource.title,
        subtitle: resource.subtitle,
        snippet: options?.snippet,
        icon: resource.icon,
        updatedAt: resource.updatedAt,
        score: options?.score,
        primaryAction: resource.primaryAction,
        secondaryActions: resource.secondaryActions ?? [],
        metadata: resource.metadata ?? {},
        pluginGeneration: resource.pluginGeneration,
    };
}
