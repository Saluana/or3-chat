import { prepareDocumentCreate } from '~/db/documents';
import { getWriteTxTableNames } from '~/db/util';
import { captureWorkspaceOperation } from './workspace-access';
import { workspaceRevision, readWorkspaceItem } from './workspace-items';
import type { ToolExecutionContext } from './types';
import { assertProjectUnchanged, prepareWorkspaceProjectAssociation } from './workspace-projects';
import { nextClock } from '~/db/util';
import { serializeDocumentFileHashes } from '~/utils/documents/document-content';

/** No extra model call: validate and commit the chat model's requested native content. */
export async function createWorkspaceDocument(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
    const scope = captureWorkspaceOperation(context);
    scope.assertCurrent('write');
    const execution = await workspaceRevision({ requestId: context.requestId, callId: context.callId });
    const inputDigest = await workspaceRevision(args);
    const id = `workspace-document-${execution}`;
    scope.assertCurrent('write');
    const previous = await scope.db.posts.get(id);
    if (previous) {
        const metadata = typeof previous.meta === 'string' ? JSON.parse(previous.meta || '{}') as Record<string, unknown> : {};
        if (previous.deleted || previous.postType !== 'doc' || metadata['or3.workspace-create'] !== inputDigest) {
            throw new Error('This execution already saved a different result or its document is unavailable.');
        }
        const loaded = await readWorkspaceItem(scope, { kind: 'document', id });
        return JSON.stringify({ version: 1, workspaceId: scope.workspaceId, source: loaded.source, status: 'saved', replay: true });
    }
    const [{ loadDocumentEditorSchema }, { validateDocumentContent }] = await Promise.all([
        import('~/utils/documents/document-editor-schema'), import('~/utils/documents/validate-document-content'),
    ]);
    const schema = await loadDocumentEditorSchema();
    scope.assertCurrent('write');
    const content = await validateDocumentContent(schema, args.content, scope.db);
    scope.assertCurrent('write');
    const prepared = await prepareDocumentCreate({ title: String(args.title), content }, id);
    // Filters and before-hooks are trusted extensions, but their output still must be valid.
    if (prepared.row.id !== id) throw new Error('A document hook changed the operation identity.');
    const filteredContent = await validateDocumentContent(schema, JSON.parse(prepared.row.content), scope.db);
    prepared.row.content = JSON.stringify(filteredContent);
    prepared.row.file_hashes = serializeDocumentFileHashes(filteredContent);
    prepared.row.meta = JSON.stringify({ 'or3.workspace-create': inputDigest });
    const association = args.project ? await prepareWorkspaceProjectAssociation(scope,
        args.project as { id: string; revision: string }, { kind: 'document', id, title: prepared.row.title }) : undefined;
    scope.assertCurrent('write');
    const committed = await scope.db.transaction('rw', getWriteTxTableNames(scope.db, 'posts', { include: ['file_meta', 'projects'] }), async () => {
        scope.assertCurrent('write');
        const existing = await scope.db.posts.get(id);
        scope.assertCurrent('write');
        if (existing) {
            if (existing.meta !== prepared.row.meta || existing.deleted || existing.postType !== 'doc') {
                throw new Error('This execution already saved a different result.');
            }
            return false;
        }
        // References are checked in the same transaction as ownership, never against a new workspace.
        const hashes = JSON.parse(prepared.row.file_hashes || '[]') as string[];
        for (const hash of hashes) {
            const file = await scope.db.file_meta.get(hash);
            scope.assertCurrent('write');
            if (!file || file.deleted) throw new Error('A referenced workspace image is unavailable.');
        }
        if (association) {
            const currentProject = await scope.db.projects.get(association.base.id);
            scope.assertCurrent('write');
            assertProjectUnchanged(currentProject, association.base);
            await scope.db.projects.put({ ...association.prepared.row, clock: nextClock(association.base.clock) });
        }
        scope.assertCurrent('write');
        await scope.db.posts.put(prepared.row);
        scope.assertCurrent('write');
        return true;
    });
    // A failed notification cannot turn a committed write into a fictitious unsaved result.
    if (committed) {
        try {
            await prepared.afterCommit();
            if (association) await association.prepared.afterCommit({ ...association.prepared.row, clock: nextClock(association.base.clock) });
        } catch (error) { console.warn('Document saved; after-create hook failed.', error); }
    }
    const loaded = await readWorkspaceItem(scope, { kind: 'document', id });
    return JSON.stringify({ version: 1, workspaceId: scope.workspaceId, source: loaded.source, status: 'saved' });
}
