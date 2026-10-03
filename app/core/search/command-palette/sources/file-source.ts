import type { Or3DB } from '~/db/client';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem, workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import type { PaletteSearchSource } from '../types';
import { paneAppActions } from './actions';
import { parseFileHashes } from '~/db/files-util';

/** Metadata/text only: opening search never downloads a blob. */
export function createFilePaletteSource(): PaletteSearchSource {
    return {
        id: 'file', label: 'Files', order: 35,
        category: { id: 'file', label: 'Files', aliases: ['file', 'files'], icon: 'i-lucide-file', order: 35 },
        async load(context) {
            context.signal?.throwIfAborted();
            const db = await context.getDb() as Or3DB;
            const posts = await db.posts.where('postType').equals(FILE_CATALOG_POST_TYPE).filter(isVisibleWorkspaceItem).toArray();
            context.signal?.throwIfAborted();
            const hashes = posts.map(post => parseFileHashes(post.file_hashes));
            const metadata = await db.file_meta.bulkGet(hashes.map(values => values.length === 1 ? values[0]! : ''));
            context.signal?.throwIfAborted();
            return posts.filter((_post, index) => metadata[index] && !metadata[index]!.deleted).map(post => {
                const actions = paneAppActions('or3-files', post.id, context);
                return { key: `file:${post.id}`, sourceId: 'file', categoryId: 'file', recordId: post.id,
                    title: post.title, content: post.content, icon: 'i-lucide-file', updatedAt: post.updated_at,
                    revision: `${post.clock}:${post.updated_at}:${post.content.length}:${post.title}`,
                    primaryAction: actions.primary, secondaryActions: actions.secondary,
                    metadata: { textCoverage: workspaceItemMetadata(post.meta)?.text?.coverage ?? 'none' } };
            });
        },
    };
}
