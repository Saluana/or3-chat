import type { FileMeta } from '~/db/schema';

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

export function isGeneratedImage(meta: FileMeta): boolean {
    return /^gen(?:erated)?[-_ ]?image(?:[-_. ]|$)/i.test(meta.name.trim());
}

export function filterImageLibrary(
    items: FileMeta[],
    view: ImageLibraryView,
    usedInDocumentHashes: ReadonlySet<string>
): FileMeta[] {
    if (view === 'generated') return items.filter(isGeneratedImage);
    if (view === 'uploads')
        return items.filter((item) => !isGeneratedImage(item));
    if (view === 'used-in-docs') {
        return items.filter((item) => usedInDocumentHashes.has(item.hash));
    }
    return items;
}

export function sortImageLibrary(
    items: FileMeta[],
    sort: ImageLibrarySort
): FileMeta[] {
    const result = [...items];
    result.sort((a, b) => {
        if (sort === 'oldest') return a.created_at - b.created_at;
        if (sort === 'name-asc') {
            return a.name.localeCompare(b.name, undefined, {
                sensitivity: 'base',
            });
        }
        if (sort === 'name-desc') {
            return b.name.localeCompare(a.name, undefined, {
                sensitivity: 'base',
            });
        }
        if (sort === 'largest') return b.size_bytes - a.size_bytes;
        if (sort === 'smallest') return a.size_bytes - b.size_bytes;
        return b.created_at - a.created_at;
    });
    return result;
}

export function imageLibraryCounts(
    items: FileMeta[],
    trashItems: FileMeta[],
    usedInDocumentHashes: ReadonlySet<string>
): Record<ImageLibraryView, number> {
    return {
        all: items.length,
        uploads: items.filter((item) => !isGeneratedImage(item)).length,
        generated: items.filter(isGeneratedImage).length,
        'used-in-docs': items.filter((item) =>
            usedInDocumentHashes.has(item.hash)
        ).length,
        trash: trashItems.length,
    };
}
