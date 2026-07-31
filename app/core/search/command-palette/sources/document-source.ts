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

function category() {
    return CORE_PALETTE_CATEGORIES.find((c) => c.id === 'document')!;
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
            ).filter(
                (post) =>
                    !post.deleted &&
                    post.postType === 'doc' &&
                    isIndexablePostType(post.postType)
            );
            context.signal?.throwIfAborted();
            return posts.map((post) => postToDocumentResource(post, context));
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
