import { pluginError, pluginOk, type PluginFileAction, type PluginFilesCatalogClient,
    type PluginGrant, type PluginResult, type PluginSavedFile } from '@or3/plugin-sdk';
import type { Or3DB } from '~/db/client';
import { catalogWorkspaceFile, enableWorkspaceFileText, removeWorkspaceFile, updateWorkspaceFile, workspaceFileSnapshot } from '~/db/workspace-files';
import { captureWorkspaceOperation, workspaceFilesAvailable } from '~/utils/chat/workspace-access';
import { FILE_CATALOG_POST_TYPE, isVisibleWorkspaceItem, workspaceItemMetadata } from '~~/shared/posts/workspace-item';
import { isValidHash } from '~/utils/hash';
import { parseFileHashes } from '~/db/files-util';
import { registerWorkspaceFileAction } from '~/composables/files/useWorkspaceFileActions';

export function createTrustedWorkspaceFiles(input: {
    pluginId: string; workspaceId: string; db: Or3DB; signal: AbortSignal;
    allow(grant: PluginGrant): void; current(): boolean; cleanup(callback: () => void): void;
}) {
    const invalid = (message: string) => Object.assign(new Error(message), { code: 'invalid-input' });
    function assertAccess(write = false) {
        if (!input.current()) throw Object.assign(new Error('Plugin context has ended'), { code: 'stale-context' });
        if (!workspaceFilesAvailable()) throw Object.assign(new Error('Workspace Files is unavailable'), { code: 'unsupported' });
        let scope: ReturnType<typeof captureWorkspaceOperation>;
        try {
            scope = captureWorkspaceOperation({ subject: null, workspaceId: input.workspaceId,
                threadId: 'workspace-files', messageId: null, requestId: input.pluginId, callId: input.pluginId, abortSignal: input.signal });
        } catch (error) {
            throw Object.assign(error as Error, { code: input.current() ? 'permission-denied' : 'stale-context' });
        }
        const originalAssert = scope.assertCurrent;
        scope.assertCurrent = (access = 'read') => {
            if (!input.current() || scope.db !== input.db) throw Object.assign(new Error('Plugin context has ended'), { code: 'stale-context' });
            try { originalAssert(access); }
            catch (error) { throw Object.assign(error as Error, { code: input.current() ? 'permission-denied' : 'stale-context' }); }
        };
        scope.assertCurrent(write ? 'write' : 'read');
        return scope;
    }
    async function run<T>(grant: PluginGrant, work: (scope: ReturnType<typeof assertAccess>) => Promise<T>): Promise<PluginResult<T>> {
        try {
            input.allow(grant);
            const scope = assertAccess(grant === 'files.catalog.write');
            const result = await work(scope);
            scope.assertCurrent();
            return pluginOk(result);
        } catch (error) {
            const failure = error as { code?: Parameters<typeof pluginError>[0]; message?: string };
            return pluginError(!input.current() ? 'stale-context' : failure.code ?? 'internal', failure.message ?? 'File operation failed');
        }
    }
    function identifier(id: string) {
        if (typeof id !== 'string' || !id.trim() || id.length > 500) throw Object.assign(new Error('Invalid catalog ID'), { code: 'invalid-input' });
    }
    function revision(value: string) {
        if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw Object.assign(new Error('Invalid catalog revision'), { code: 'invalid-input' });
    }
    async function load(scope: ReturnType<typeof assertAccess>, id: string) {
        identifier(id);
        const post = await input.db.posts.get(id);
        scope.assertCurrent();
        if (!post || post.deleted || !['doc', FILE_CATALOG_POST_TYPE].includes(post.postType)) return null;
        if (post.postType === FILE_CATALOG_POST_TYPE && parseFileHashes(post.file_hashes).length !== 1) return null;
        if (!isVisibleWorkspaceItem(post) && workspaceItemMetadata(post.meta)?.trashed_at == null) return null;
        const item = await workspaceFileSnapshot(scope, post);
        if (item.kind === 'file' && (!item.file || (await input.db.file_meta.get(item.file.id))?.deleted)) return null;
        scope.assertCurrent();
        return item;
    }
    const catalog: PluginFilesCatalogClient = {
        list: (options = {}) => run('files.catalog.read', async scope => {
            if (!options || typeof options !== 'object' || Array.isArray(options)) throw invalid('Invalid catalog list options.');
            const limit = options.limit ?? 50;
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (options.trashed !== undefined && typeof options.trashed !== 'boolean')) {
                throw invalid('Use a limit of 1–100 and a boolean Trash filter.');
            }
            if (options.cursor !== undefined) identifier(options.cursor);
            const items: PluginSavedFile[] = [];
            // Scan metadata in primary-key order; never fetch originals or build an eager workspace list.
            const rows = await input.db.posts.orderBy(':id').filter(post =>
                (!options.cursor || post.id > options.cursor) && !post.deleted && ['doc', FILE_CATALOG_POST_TYPE].includes(post.postType)
                && (options.trashed ? workspaceItemMetadata(post.meta)?.trashed_at != null : isVisibleWorkspaceItem(post))).limit(limit + 1).toArray();
            for (const post of rows.slice(0, limit)) {
                const item = await load(scope, post.id);
                if (item) items.push(item);
            }
            return { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
        }),
        get: id => run('files.catalog.read', scope => load(scope, id)),
        save: fileId => run('files.catalog.write', async scope => {
            if (typeof fileId !== 'string' || !isValidHash(fileId)) throw invalid('Invalid file reference');
            const result = await catalogWorkspaceFile(scope, fileId, { restore: true });
            return workspaceFileSnapshot(scope, result.post);
        }),
        update: (id, observed, changes) => run('files.catalog.write', async scope => {
            identifier(id); revision(observed);
            if (!changes || (changes.title === undefined && changes.trashed === undefined)
                || (changes.title !== undefined && (typeof changes.title !== 'string' || !changes.title.trim() || changes.title.length > 500))
                || (changes.trashed !== undefined && typeof changes.trashed !== 'boolean')) throw invalid('Supply a title of 1–500 characters or boolean Trash change.');
            return workspaceFileSnapshot(scope, await updateWorkspaceFile(scope, id, observed, changes));
        }),
        enableText: (id, observed) => run('files.catalog.write', async scope => {
            identifier(id); revision(observed);
            return workspaceFileSnapshot(scope, await enableWorkspaceFileText(scope, id, observed));
        }),
        remove: (id, observed) => run('files.catalog.write', async scope => {
            identifier(id); revision(observed);
            await removeWorkspaceFile(scope, id, observed);
        }),
    };
    function registerAction(action: PluginFileAction) {
        // Grants only; `run` checks workspace access and the selected revision.
        input.allow('files.actions.register'); input.allow('files.catalog.read');
        if (!action || typeof action.id !== 'string' || !action.id.trim() || action.id.length > 100
            || typeof action.label !== 'string' || !action.label.trim() || action.label.length > 100 || typeof action.run !== 'function'
            || (action.kinds && (!Array.isArray(action.kinds) || action.kinds.some(kind => !['file', 'document'].includes(kind))))
            || (action.order !== undefined && !Number.isFinite(action.order))
            || (action.icon !== undefined && typeof action.icon !== 'string')
            || (action.requiresWrite !== undefined && typeof action.requiresWrite !== 'boolean')) {
            throw Object.assign(new Error('Invalid file action'), { code: 'invalid-input' });
        }
        const handle = registerWorkspaceFileAction({ ...action, id: `${input.pluginId}:${action.id}`, pluginId: input.pluginId,
            workspaceId: input.workspaceId, kinds: action.kinds ? Object.freeze([...action.kinds]) : undefined,
            async run(selected) {
                input.allow('files.actions.register'); input.allow('files.catalog.read');
                if (handle.disposed) throw new Error('File action has been disposed');
                const scope = assertAccess(action.requiresWrite);
                if (selected.workspaceId !== input.workspaceId) throw new Error('File belongs to another workspace');
                const current = await load(scope, selected.id);
                if (!current || current.trashed || current.revision !== selected.revision) throw Object.assign(new Error('This item changed. Read it again.'), { code: 'conflict' });
                await action.run(current);
            } });
        input.cleanup(() => handle.dispose());
        return { dispose: () => { handle.dispose(); } };
    }
    return { catalog, registerAction, assertAccess };
}
