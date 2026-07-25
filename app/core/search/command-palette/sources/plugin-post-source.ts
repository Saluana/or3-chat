import type { Or3DB } from '~/db/client';
import type { Post } from '~/db/schema';
import {
    isIndexablePostType,
    normalizeScalarMetadata,
    pickScalarMetadata,
    tiptapToPlainText,
} from '../normalize';
import type {
    PaletteAction,
    PaletteLoadContext,
    PalettePostSourceDefinition,
    PaletteResource,
    PaletteSearchSource,
} from '../types';
import { paneAppActions } from './actions';

export function createPluginPostPaletteSource(options: {
    definition: PalettePostSourceDefinition;
    pluginId: string;
    pluginGeneration?: number;
}): PaletteSearchSource {
    const { definition, pluginId, pluginGeneration } = options;
    const category = {
        id: definition.categoryId,
        label: definition.label,
        aliases: definition.filterAliases,
        icon: definition.icon,
        order: definition.order ?? 200,
    };

    return {
        id: definition.id,
        label: definition.label,
        category,
        order: definition.order ?? 200,
        pluginId,
        pluginGeneration,
        access: definition.access,
        async load(context) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            const posts = (
                await db.posts
                    .where('postType')
                    .equals(definition.postType)
                    .toArray()
            ).filter(
                (post) =>
                    !post.deleted &&
                    post.postType === definition.postType &&
                    isIndexablePostType(post.postType)
            );
            context.signal?.throwIfAborted();
            return posts.map((post) =>
                postToPluginResource(
                    post,
                    definition,
                    context,
                    pluginGeneration
                )
            );
        },
    };
}

export function postToPluginResource(
    post: Post,
    definition: PalettePostSourceDefinition,
    context: PaletteLoadContext,
    pluginGeneration?: number
): PaletteResource {
    const content = tiptapToPlainText(post.content) || post.content || '';
    const keywords = normalizeScalarMetadata(post.meta, definition.metaKeys);
    const openTarget = definition.openTarget;

    let primary: PaletteAction;
    let secondary: readonly PaletteAction[];
    if (openTarget.kind === 'pane-app') {
        const actions = paneAppActions(openTarget.appId, post.id, context);
        primary = actions.primary;
        secondary = actions.secondary;
    } else {
        primary = {
            id: `dashboard:open:${openTarget.pluginId}:${openTarget.pageId ?? ''}`,
            label: 'Open',
            target: {
                kind: 'dashboard' as const,
                pluginId: openTarget.pluginId,
                pageId: openTarget.pageId,
            },
        };
        secondary = [];
    }

    return {
        key: `${definition.id}:${post.id}`,
        sourceId: definition.id,
        categoryId: definition.categoryId,
        recordId: post.id,
        title: post.title,
        content,
        keywords,
        updatedAt: post.updated_at,
        revision: `${post.updated_at}:${content.length}`,
        icon: definition.icon,
        primaryAction: primary,
        secondaryActions: secondary,
        metadata: pickScalarMetadata(post.meta, definition.metaKeys),
        pluginGeneration,
    };
}
