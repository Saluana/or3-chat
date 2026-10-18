import type { FileMeta } from '~/db/schema';
import type { ImageSummary } from '~/db/files-select';

export type ImageLibraryView =
    | 'all'
    | 'uploads'
    | 'generated'
    | 'used-in-docs'
    | 'trash';

export type ImageLibrarySort =
    | 'newest'
    | 'oldest'
    | 'name-asc'
    | 'name-desc'
    | 'largest'
    | 'smallest';

export function isGeneratedImageName(name: string): boolean {
    return /^gen(?:erated)?[-_ ]?image(?:[-_. ]|$)/i.test(name.trim());
}

export function isGeneratedImage(meta: FileMeta): boolean {
    return isGeneratedImageName(meta.name);
}

/**
 * Global counts over the compact image corpus. `used-in-docs` counts unique
 * active images referenced by active documents.
 */
export function imageSummaryCounts(
    summaries: readonly ImageSummary[],
    usedInDocumentHashes: ReadonlySet<string>
): Record<ImageLibraryView, number> {
    let all = 0;
    let uploads = 0;
    let generated = 0;
    let usedInDocs = 0;
    let trash = 0;
    for (const summary of summaries) {
        if (summary.state === 'trash') {
            trash += 1;
            continue;
        }
        all += 1;
        if (isGeneratedImageName(summary.name)) generated += 1;
        else uploads += 1;
        if (usedInDocumentHashes.has(summary.hash)) usedInDocs += 1;
    }
    return {
        all,
        uploads,
        generated,
        'used-in-docs': usedInDocs,
        trash,
    };
}

/**
 * Locale-aware name ordering over compact summaries. Equal names fall back to
 * hash order so ties cannot duplicate or omit rows across pages.
 */
export function orderImageSummariesByName(
    summaries: readonly ImageSummary[],
    sort: 'name-asc' | 'name-desc'
): string[] {
    return [...summaries]
        .sort((a, b) => {
            const comparison =
                sort === 'name-asc'
                    ? a.name.localeCompare(b.name, undefined, {
                          sensitivity: 'base',
                      })
                    : b.name.localeCompare(a.name, undefined, {
                          sensitivity: 'base',
                      });
            if (comparison !== 0) return comparison;
            return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
        })
        .map((summary) => summary.hash);
}
