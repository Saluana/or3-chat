import type { PalettePreview, PaletteResource, PaletteResult } from './types';

const PREVIEW_DESCRIPTION_LIMIT = 700;

/**
 * Build the preview shown before a source-specific hydrator runs (or when a
 * source has none). Uses only data already held in memory so it is synchronous.
 */
export function buildFallbackPalettePreview(
    resource: PaletteResource,
    result?: Pick<PaletteResult, 'snippet'>
): PalettePreview {
    return {
        title: resource.title,
        categoryId: resource.categoryId,
        snippet: result?.snippet,
        description: excerpt(resource.content),
        metadata: resource.metadata,
    };
}

/** Preview for a result whose resource is no longer indexed. */
export function buildUnavailablePalettePreview(
    result: PaletteResult
): PalettePreview {
    return {
        title: result.title,
        categoryId: result.categoryId,
        snippet: result.snippet,
        metadata: result.metadata,
        unavailable: true,
    };
}

function excerpt(content?: string): string | undefined {
    if (!content) return undefined;
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) return undefined;
    if (normalized.length <= PREVIEW_DESCRIPTION_LIMIT) return normalized;
    return `${normalized.slice(0, PREVIEW_DESCRIPTION_LIMIT).trim()}…`;
}
