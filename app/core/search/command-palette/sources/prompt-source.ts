import type { Or3DB } from '~/db/client';
import { parsePromptMeta } from '~/db/prompts';
import type { Post } from '~/db/schema';
import { tiptapToPlainText } from '../normalize';
import {
    CORE_PALETTE_CATEGORIES,
    type PalettePreview,
    type PaletteResource,
    type PaletteSearchSource,
} from '../types';

export function createPromptPaletteSource(): PaletteSearchSource {
    return {
        id: 'prompt',
        label: 'Prompts',
        category: CORE_PALETTE_CATEGORIES.find(
            (category) => category.id === 'prompt'
        )!,
        order: 45,
        async load(context) {
            context.signal?.throwIfAborted();
            const db = (await context.getDb()) as Or3DB;
            const posts = await db.posts
                .where('postType')
                .equals('prompt')
                .toArray();
            context.signal?.throwIfAborted();
            return posts
                .filter(
                    (post) => !post.deleted && post.postType === 'prompt'
                )
                .map(postToPromptResource);
        },
        async hydratePreview(resource): Promise<PalettePreview> {
            return {
                title: resource.title,
                categoryId: 'prompt',
                snippet: resource.content,
                description: resource.subtitle,
                metadata: resource.metadata,
            };
        },
    };
}

export function postToPromptResource(post: Post): PaletteResource {
    const meta = parsePromptMeta(post.meta);
    const convertedContent = tiptapToPlainText(post.content) || '';
    const rawContent = post.content.trim();
    const content =
        (rawContent.startsWith('{') || rawContent.startsWith('[')) &&
        convertedContent === rawContent
            ? ''
            : convertedContent;
    const excerpt =
        content.length > 180
            ? `${content.slice(0, 177).trimEnd()}…`
            : content;
    const keywords = [
        ...meta.tags,
        ...(meta.favorite ? ['favorite', 'favourite', 'starred'] : []),
        'system prompt',
    ];

    return {
        key: `prompt:${post.id}`,
        sourceId: 'prompt',
        categoryId: 'prompt',
        recordId: post.id,
        title: post.title,
        subtitle: excerpt || 'System prompt',
        content,
        keywords,
        updatedAt: post.updated_at,
        revision: `${post.updated_at}:${post.content.length}:${post.meta ?? ''}`,
        icon: 'i-lucide-scroll-text',
        primaryAction: {
            id: `prompt:edit:${post.id}`,
            label: 'Edit prompt',
            icon: 'i-lucide-pencil',
            target: {
                kind: 'system-prompt',
                mode: 'edit',
                promptId: post.id,
            },
        },
        secondaryActions: [
            {
                id: 'prompt:open-library',
                label: 'Open prompt library',
                icon: 'i-lucide-library',
                target: {
                    kind: 'system-prompt',
                    mode: 'home',
                },
            },
        ],
        metadata: {
            favorite: meta.favorite,
            tags: meta.tags.join(', '),
        },
    };
}
