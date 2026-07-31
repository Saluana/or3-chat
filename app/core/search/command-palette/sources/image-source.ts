import type { Or3DB } from '~/db/client';
import type { FileMeta } from '~/db/schema';
import {
    CORE_PALETTE_CATEGORIES,
    type PalettePreview,
    type PalettePreviewContext,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';

function category() {
    return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'image')!;
}

export function isImageFileMeta(meta: FileMeta): boolean {
    if (meta.deleted) return false;
    if (meta.kind === 'image') return true;
    return (meta.mime_type ?? '').startsWith('image/');
}

export function createImagePaletteSource(): PaletteSearchSource {
    return {
        id: 'image',
        label: 'Images',
        category: category(),
        order: 60,
        async load(context) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            const files = (await db.file_meta.toArray()).filter(isImageFileMeta);
            context.signal?.throwIfAborted();
            return files.map(fileMetaToResource);
        },
        async hydratePreview(resource, context) {
            return hydrateImagePreview(resource, context);
        },
    };
}

export function fileMetaToResource(meta: FileMeta): PaletteResource {
    const keywords = [
        meta.name,
        meta.mime_type,
        meta.kind,
        meta.width != null && meta.height != null
            ? `${meta.width}x${meta.height}`
            : '',
    ].filter(Boolean);
    return {
        key: `image:${meta.hash}`,
        sourceId: 'image',
        categoryId: 'image',
        recordId: meta.hash,
        title: meta.name || meta.hash.slice(0, 8),
        subtitle: meta.mime_type,
        keywords,
        updatedAt: meta.updated_at,
        revision: String(meta.updated_at),
        icon: 'i-lucide-image',
        primaryAction: {
            id: `image:open:${meta.hash}`,
            label: 'Open image',
            target: { kind: 'image', hash: meta.hash },
        },
        secondaryActions: [],
        metadata: {
            mime_type: meta.mime_type,
            kind: meta.kind,
            width: meta.width ?? null,
            height: meta.height ?? null,
            size_bytes: meta.size_bytes,
        },
    };
}

export async function hydrateImagePreview(
    resource: PaletteResource,
    context: PalettePreviewContext
): Promise<PalettePreview> {
    const db = (await context.getDb()) as Or3DB;
    try {
        const blobRow = await db.file_blobs.get(resource.recordId);
        if (!blobRow?.blob) {
            return {
                title: resource.title,
                categoryId: 'image',
                metadata: resource.metadata,
                unavailable: true,
            };
        }
        if (context.signal?.aborted) {
            return {
                title: resource.title,
                categoryId: 'image',
                unavailable: true,
            };
        }
        const objectUrl = URL.createObjectURL(blobRow.blob);
        return {
            title: resource.title,
            categoryId: 'image',
            metadata: resource.metadata,
            imageObjectUrl: objectUrl,
            cleanup: () => {
                URL.revokeObjectURL(objectUrl);
            },
        };
    } catch {
        return {
            title: resource.title,
            categoryId: 'image',
            metadata: resource.metadata,
            unavailable: true,
        };
    }
}
