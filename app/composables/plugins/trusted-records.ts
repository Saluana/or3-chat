import { liveQuery } from 'dexie';
import { pluginError, pluginOk, type PluginPostsClient, type PluginMessagesClient, type PluginStoredMessage } from '@or3/plugin-sdk';
import { getActiveWorkspaceId, getDb, type Or3DB } from '~/db/client';
import type { Message } from '~/db/schema';
import { createPost, upsertPost, softDeletePost } from '~/db/posts';
import { getWriteTxTableNames, nextClock, nowSec } from '~/db/util';
import { changeRefCount, changeFileRefRows, notifyFileRefChanges, type FileRefNotification } from '~/db/files';
import { captureWorkspaceOperation, type WorkspaceOperationScope } from '~/utils/chat/workspace-access';
import { resolveChatProject } from '~/db/project-workspace';
import { parseHashes } from '~/utils/files/attachments';
import { deriveMessageContent } from '~/utils/chat/messages';

export function createTrustedRecords(input: {
    db: Or3DB; allow(grant: 'posts.read' | 'posts.write' | 'chat.read' | 'chat.message.write'): void;
    postTypes: ReadonlySet<string>; messageTypes: ReadonlySet<string>; cleanup(callback: () => void): void;
    current(): boolean; inBeforeSend(): boolean;
}) {
    const live = () => { if (!input.current() || getDb() !== input.db) throw Object.assign(new Error('Plugin workspace changed'), { code: 'stale-context' }); };
    const capture = (threadId = 'plugin-records', access: 'read' | 'write' = 'write') => {
        live();
        const scope = captureWorkspaceOperation({ subject: null, workspaceId: getActiveWorkspaceId() ?? 'local',
            threadId, messageId: null, requestId: 'plugin-records', callId: 'plugin-records', abortSignal: new AbortController().signal });
        scope.assertCurrent(access);
        return scope;
    };
    const ordinary = async (scope: WorkspaceOperationScope, threadId: string) => {
        live(); scope.assertCurrent();
        const thread = await input.db.threads.get(threadId);
        if (!thread || thread.deleted) throw new Error('The originating chat is no longer available.');
        if (await resolveChatProject(input.db, threadId))
            throw new Error('This plugin cannot capture project context. Use a normal project chat.');
        scope.assertCurrent();
    };
    const run = async <T>(grant: Parameters<typeof input.allow>[0], fn: () => Promise<T>) => {
        try { live(); input.allow(grant); const result = await fn(); live(); return pluginOk(result); }
        catch (error) { const e = error as { code?: string; message?: string }; return pluginError((e.code ?? 'host-unavailable') as Parameters<typeof pluginError>[0], e.message ?? 'Record operation failed'); }
    };
    const owns = (types: ReadonlySet<string>, type: unknown) => { if (typeof type !== 'string' || !types.has(type)) throw Object.assign(new Error('Record type is not registered by this plugin'), { code: 'permission-denied' }); };
    const messageType = (data: unknown) => data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined;
    const writable = (row: Message | undefined) => { if (!row || row.deleted) throw Object.assign(new Error('Message not found'), { code: 'not-found' }); if (row.role !== 'assistant') throw Object.assign(new Error('Only assistant messages can be written'), { code: 'permission-denied' }); owns(input.messageTypes, messageType(row.data)); return row; };
    const toMessage = (row: Message): PluginStoredMessage => ({ id: row.id, threadId: row.thread_id, streamId: row.stream_id ?? '', role: row.role, content: deriveMessageContent({ data: row.data }), data: row.data, createdAt: row.created_at, updatedAt: row.updated_at, clock: row.clock, fileIds: parseHashes(row.file_hashes) });
    const writtenFiles = new Map<string, number>();
    const retainFile = (id: string) => writtenFiles.set(id, (writtenFiles.get(id) ?? 0) + 1);
    const releaseFiles = async () => {
        const pending = [...writtenFiles];
        writtenFiles.clear();
        for (const [id, count] of pending) await changeRefCount(id, -count, input.db);
    };
    const posts: PluginPostsClient = {
        get: id => run('posts.read', async () => { const row = await input.db.posts.get(id); return row && !row.deleted ? row : null; }),
        list: query => run('posts.read', async () => { const rows = await input.db.posts.where('postType').equals(query.postType).and(row => !row.deleted).toArray(); return query.limit ? rows.slice(0, query.limit) : rows; }),
        create: value => run('posts.write', async () => { owns(input.postTypes, value.postType); const row = await createPost({ ...value, content: value.content ?? '' } as Parameters<typeof createPost>[0], { db: input.db, assertCurrent: live }); return { id: row.id }; }),
        update: (id, patch) => run('posts.write', async () => {
            await input.db.transaction('rw', getWriteTxTableNames(input.db, 'posts'), async () => {
                live(); const row = await input.db.posts.get(id); if (!row || row.deleted) throw Object.assign(new Error('Post not found'), { code: 'not-found' });
                owns(input.postTypes, row.postType); await upsertPost({ ...row, ...patch } as typeof row, { db: input.db, assertCurrent: live }); live();
            });
        }),
        delete: id => run('posts.write', async () => {
            await input.db.transaction('rw', getWriteTxTableNames(input.db, 'posts', { includeTombstones: true }), async () => {
                live(); const row = await input.db.posts.get(id); if (!row || row.deleted) return;
                owns(input.postTypes, row.postType); await softDeletePost(id, { db: input.db, assertCurrent: live }); live();
            });
        }),
        onChange(listener) {
            live(); input.allow('posts.read');
            const subscription = liveQuery(() => input.db.posts.toArray()).subscribe(() => { if (input.current()) listener(); });
            const dispose = () => subscription.unsubscribe(); input.cleanup(dispose); return { dispose };
        },
    };
    const messages: PluginMessagesClient = {
        get: id => run('chat.read', async () => { const row = await input.db.messages.get(id); return row && !row.deleted ? toMessage(row) : null; }),
        list: query => run('chat.read', async () => (await input.db.messages.where('data.type').equals(query.type).and(row => !row.deleted).toArray()).map(toMessage)),
        listByThread: (id, query) => run('chat.read', async () => {
            const scope = capture(id, 'read');
            return input.db.transaction('r', ['messages', 'threads', 'projects'], async () => {
                await ordinary(scope, id);
                return (await input.db.messages.where('thread_id').equals(id).and(row => !row.deleted && (!query?.type || messageType(row.data) === query.type)).sortBy('index')).map(toMessage);
            });
        }),
        upsert: submitted => run('chat.message.write', async () => {
            const value = JSON.parse(JSON.stringify(submitted)) as typeof submitted;
            owns(input.messageTypes, messageType(value.data));
            const scope = capture(value.threadId);
            await input.db.transaction('rw', getWriteTxTableNames(input.db, ['messages', 'threads', 'projects']), async () => {
                await ordinary(scope, value.threadId);
                live(); const previous = await input.db.messages.get(value.id); const timestamp = nowSec();
                if (previous && (previous.thread_id !== value.threadId || previous.stream_id !== value.streamId))
                    throw new Error('The originating plugin message changed.');
                if (previous && !(input.inBeforeSend() && previous.role === 'assistant' && previous.pending && !previous.deleted && previous.thread_id === value.threadId && previous.stream_id === value.streamId && !messageType(previous.data))) writable(previous);
                scope.assertCurrent('write');
                await input.db.messages.put(previous ? { ...previous, data: value.data as Message['data'], pending: value.pending, updated_at: timestamp, clock: nextClock(previous.clock) } : {
                    id: value.id, role: 'assistant', data: value.data as Message['data'], pending: value.pending, created_at: timestamp, updated_at: timestamp,
                    error: null, deleted: false, thread_id: value.threadId, index: Date.now(), clock: nextClock(), stream_id: value.streamId, file_hashes: null,
                }); live(); scope.assertCurrent('write');
            });
        }),
        updateData: submitted => run('chat.message.write', async () => {
            const updates = JSON.parse(JSON.stringify(submitted)) as typeof submitted;
            const scope = capture();
            for (const value of updates) owns(input.messageTypes, messageType(value.data));
            await input.db.transaction('rw', getWriteTxTableNames(input.db, ['messages', 'threads', 'projects']), async () => {
                for (const value of updates) {
                    live(); const row = await input.db.messages.get(value.id); if (!row || row.deleted) continue; writable(row);
                    await ordinary(scope, row.thread_id); scope.assertCurrent('write');
                    if (row.clock !== value.ifClock || JSON.stringify(row.data) !== JSON.stringify(value.ifData)) continue;
                    await input.db.messages.put({ ...row, data: value.data as Message['data'], pending: value.pending, updated_at: nowSec(), clock: nextClock(row.clock) });
                } live(); scope.assertCurrent('write');
            });
        }),
        async attachFile(id, file) {
            const references = writtenFiles.get(file.id) ?? 0;
            if (!references) return pluginError(input.current() ? 'invalid-input' : 'stale-context', 'File reference was not issued by this activation or was already consumed');
            if (references === 1) writtenFiles.delete(file.id); else writtenFiles.set(file.id, references - 1);
            const changes: FileRefNotification[] = [];
            const result = await run('chat.message.write', async () => {
                const scope = capture();
                await input.db.transaction('rw', getWriteTxTableNames(input.db, ['messages', 'file_meta', 'threads', 'projects']), async () => {
                    live(); const row = writable(await input.db.messages.get(id));
                    await ordinary(scope, row.thread_id); scope.assertCurrent('write');
                    const hashes = parseHashes(row.file_hashes);
                    if (hashes.includes(file.id)) {
                        const changed = await changeFileRefRows(file.id, -1, input.db);
                        if (changed) changes.push(changed.notification);
                    }
                    else await input.db.messages.put({ ...row, file_hashes: JSON.stringify([...hashes, file.id]), updated_at: nowSec(), clock: nextClock(row.clock) });
                    live(); scope.assertCurrent('write');
                });
            });
            if (result.ok) await notifyFileRefChanges(changes);
            if (!result.ok) await changeRefCount(file.id, -1, input.db);
            return result;
        },
    };
    return { posts, messages, retainFile, releaseFiles };
}
