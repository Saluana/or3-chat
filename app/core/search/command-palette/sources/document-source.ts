import type { Or3DB } from '~/db/client';
import type { Post } from '~/db/schema';
import { isIndexablePostType, tiptapToPlainText } from '../normalize';
import {
    CORE_PALETTE_CATEGORIES,
    type PaletteLoadContext,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';
import { documentActions } from './actions';
import { isVisibleWorkspaceItem } from '~~/shared/posts/workspace-item';

function category() {
    return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'document')!;
}

function isSearchableDocument(post: Post | undefined): post is Post {
    return Boolean(post && isVisibleWorkspaceItem(post) &&
        post.postType === 'doc' && isIndexablePostType(post.postType));
}

export function createDocumentPaletteSource(): PaletteSearchSource {
    return {
        id: 'document',
        label: 'Documents',
        category: category(),
        order: 30,
        async load(context) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            const posts = (
                await db.posts.where('postType').equals('doc').toArray()
            ).filter(isSearchableDocument);
            context.signal?.throwIfAborted();
            return posts.map((post) => postToDocumentResource(post, context));
        },
        async loadRecords(context, recordIds) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            context.signal?.throwIfAborted();
            const ids = [...new Set(recordIds)];
            const posts = await db.posts.bulkGet(ids);
            context.signal?.throwIfAborted();
            const resources: PaletteResource[] = [];
            const removedKeys: string[] = [];
            posts.forEach((post, index) => {
                if (isSearchableDocument(post)) {
                    resources.push(postToDocumentResource(post, context));
                } else {
                    removedKeys.push(`document:${ids[index]}`);
                }
            });
            return { resources, removedKeys };
        },
    };
}

export function postToDocumentResource(
    post: Post,
    context: PaletteLoadContext
): PaletteResource {
    const body = tiptapToPlainText(post.content);
    const actions = documentActions(post.id, context);
    return {
        key: `document:${post.id}`,
        sourceId: 'document',
        categoryId: 'document',
        recordId: post.id,
        title: post.title,
        content: body,
        updatedAt: post.updated_at,
        revision: `${post.updated_at}:${body.length}`,
        icon: 'i-lucide-file-text',
        primaryAction: actions.primary,
        secondaryActions: actions.secondary,
    };
}
