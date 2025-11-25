import { nowSec } from '~/db/util';
import { defineNuxtPlugin } from '#imports';
import { create, tx } from '~/db';
import { reportError, err as coreErr } from '~/utils/errors';
import { useNuxtApp } from '#app';
import {
    setDocumentContent,
    setDocumentTitle,
    useDocumentState,
} from '~/composables/documents/useDocumentsStore';
import type { Ref } from 'vue';
import type { PaneState } from '~/composables/core/useMultiPane';
import { createPost, upsertPost, getPost, softDeletePost } from '~/db/posts';
import { db } from '~/db/client';
import type { Post, PostCreate } from '~/db/schema';
import type { TipTapDocument } from '~/types/database';

/** All error codes emitted by the Pane Plugin API */
export type PaneApiErrorCode =
    | 'missing_source'
    | 'missing_pane'
    | 'invalid_text'
    | 'not_found'
    | 'pane_not_chat'
    | 'pane_not_doc'
    | 'no_thread'
    | 'no_thread_bind'
    | 'append_failed'
    | 'no_document'
    | 'no_active_pane'
    | 'no_panes'
    | 'invalid_post_type'
    | 'post_not_found'
    | 'post_create_failed'
    | 'post_update_failed'
    | 'post_delete_failed';

/** Success result helper */
export type Ok<T extends object = Record<string, unknown>> = { ok: true } & T;
/** Error result helper */
export interface Err<C extends PaneApiErrorCode = PaneApiErrorCode> {
    ok: false;
    code: C;
    message: string;
}

/** Unified result type */
export type Result<T extends object = Record<string, unknown>> = Ok<T> | Err;
interface MultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    setPaneThread(i: number, id: string): Promise<void> | void;
}
interface HookBus {
    doAction?(name: string, ...a: unknown[]): void;
}

/** Input options for sendMessage */
export interface SendMessageOptions {
    paneId: string;
    text: string;
    role?: 'user' | 'assistant';
    createIfMissing?: boolean; // when true, auto-creates a thread for chat panes without one
    source: string; // required identifier for auditing
    stream?: boolean; // if true (default) trigger assistant streaming for chat pane
}
export type SendMessageResult = Result<{ messageId: string; threadId: string }>;

/** Document replace options */
export interface UpdateDocumentOptions {
    paneId: string;
    content: unknown; // caller supplies fully replaced doc JSON
    source: string;
}
/** Document patch options */
export interface PatchDocumentOptions {
    paneId: string;
    patch: unknown; // shallow merge rules (arrays concatenated)
    source: string;
}
/** Set document title options */
export interface SetDocumentTitleOptions {
    paneId: string;
    title: string;
    source: string;
}

export interface ActivePaneInfo {
    paneId: string;
    mode: string;
    threadId?: string;
    documentId?: string;
    recordId?: string;
    contentSnapshot?: unknown;
}

export interface PaneDescriptor {
    paneId: string;
    mode: PaneState['mode'];
    threadId?: string;
    documentId?: string;
    recordId?: string;
}

/** Post data returned from posts API (meta parsed when JSON string) */
export interface PostData extends Omit<Post, 'meta'> {
    meta?: unknown;
}

/** Options for creating a new post */
export interface CreatePostOptions {
    postType: string;
    title: string;
    content?: string;
    meta?: unknown;
    source: string;
}

/** Options for updating an existing post */
export interface UpdatePostOptions {
    id: string;
    patch: Partial<Pick<Post, 'title' | 'content' | 'postType'>> & {
        meta?: unknown;
    };
    source: string;
}

/** Options for listing posts by type */
export interface ListPostsByTypeOptions {
    postType: string;
    limit?: number;
}

/** Options for deleting a post */
export interface DeletePostOptions {
    id: string;
    source: string;
}

/** Options for getting a single post */
export interface GetPostOptions {
    id: string;
}

export interface PanePluginApi {
    /**
     * Append a new message into a chat pane's thread. Optionally creates a thread if missing.
     * Returns message & thread identifiers on success.
     */
    sendMessage(opts: SendMessageOptions): Promise<SendMessageResult>;

    /** Replace the full document content for a doc pane. */
    updateDocumentContent(opts: UpdateDocumentOptions): Result;

    /** Shallow patch merge into a document (arrays concatenated, other keys overwritten). */
    patchDocumentContent(opts: PatchDocumentOptions): Result;

    /** Update the document title associated with a doc pane. */
    setDocumentTitle(opts: SetDocumentTitleOptions): Result;

    /** Retrieve metadata + optional cloned content for the active pane. */
    getActivePaneData(): Result<ActivePaneInfo>;

    /** List all panes (lightweight descriptors) and the current active index. */
    getPanes(): Result<{ panes: PaneDescriptor[]; activeIndex: number }>;

    /** Posts CRUD helpers for custom pane apps */
    posts: {
        /** Create a new post with specified type and data */
        create(opts: CreatePostOptions): Promise<Result<{ id: string }>>;

        /** Get a single post by ID */
        get(opts: GetPostOptions): Promise<Result<{ post: PostData }>>;

        /** Update an existing post by ID */
        update(opts: UpdatePostOptions): Promise<Result>;

        /** Delete a post by ID (soft delete) */
        delete(opts: DeletePostOptions): Promise<Result>;

        /** List all posts of a given type (soft-delete filtered, sorted by updated_at desc) */
        listByType(
            opts: ListPostsByTypeOptions
        ): Promise<Result<{ posts: PostData[] }>>;
    };
}
const err = <C extends PaneApiErrorCode>(code: C, message: string): Err<C> => ({
    ok: false,
    code,
    message,
});
const mp = (): MultiPaneApi | undefined =>
    (globalThis as unknown as { __or3MultiPaneApi?: MultiPaneApi }).__or3MultiPaneApi;
function getPaneEntry(
    id: string
): { pane: PaneState; index: number; mp: MultiPaneApi } | null {
    const m = mp();
    const ps = m?.panes.value;
    if (!ps) return null;
    const index = ps.findIndex((p) => p.id === id);
    if (index < 0) return null;
    const pane = ps[index];
    if (!pane) return null;
    return { pane, index, mp: m };
}
async function ensureThread(
    p: PaneState,
    i: number,
    h: HookBus,
    title: string
): Promise<string | Err> {
    if (p.threadId) return p.threadId;
    const m = mp();
    if (!m?.setPaneThread) return err('no_thread_bind', 'Cannot bind thread');
    const t: { id: string } = await create.thread({
        title: title.split(/\s+/).slice(0, 6).join(' ') || 'New Thread',
        last_message_at: nowSec(),
        parent_thread_id: null,
        system_prompt_id: null,
    });
    await m.setPaneThread(i, t.id);
    try {
        h.doAction?.('ui.pane.thread:action:changed', {
            pane: p,
            oldThreadId: '',
            newThreadId: t.id,
            paneIndex: i,
            messageCount: 0,
        });
    } catch {
        // Hook errors should not abort thread creation
        reportError(coreErr('ERR_INTERNAL', 'pane thread hook failed'), {
            silent: true,
            tags: { domain: 'pane', stage: 'thread_hook' },
        });
    }
    return t.id;
}
type DocJson = { type: string; content?: unknown[]; [k: string]: unknown };
function patchDoc(base: unknown, patch: unknown): DocJson {
    const b: DocJson =
        base && typeof base === 'object'
            ? (base as DocJson)
            : { type: 'doc', content: [] };
    if (patch && typeof patch === 'object') {
        const p = patch as DocJson;
        if (Array.isArray(b.content) && Array.isArray(p.content))
            b.content = [...b.content, ...p.content];
        else if (Array.isArray(p.content)) b.content = p.content;
        for (const k of Object.keys(p)) {
            if (k !== 'content') {
                (b as Record<string, unknown>)[k] = (p as Record<string, unknown>)[k];
            }
        }
    }
    return b;
}
const log = (tag: string, meta: unknown) => {
    if (import.meta.dev)
        try {
            console.debug('[pane-plugin-api] ' + tag, meta);
        } catch { /* ignore */ }
};

/**
 * Parse meta field from string to object/array when it contains JSON.
 * Returns parsed value or original if not parseable.
 */
function parseMeta(meta: unknown): unknown {
    if (typeof meta !== 'string') return meta;
    if (!meta) return meta;
    try {
        return JSON.parse(meta);
    } catch {
        return meta; // Return as-is if not valid JSON
    }
}

function makeApi(): PanePluginApi {
    const nuxtApp = useNuxtApp() as unknown as { $hooks?: HookBus };
    const hooks: HookBus = nuxtApp.$hooks ?? {};
    return {
        async sendMessage({
            paneId,
            text,
            role = 'user',
            createIfMissing,
            source,
            stream = true,
        }: SendMessageOptions) {
            if (!source) return err('missing_source', 'source required');
            if (!paneId) return err('missing_pane', 'paneId required');
            if (typeof text !== 'string' || !text.trim())
                return err('invalid_text', 'text required');
            const entry = getPaneEntry(paneId);
            if (!entry) return err('not_found', 'pane not found');
            const { pane: p, index } = entry;
            if (p.mode !== 'chat') return err('pane_not_chat', 'pane not chat');
            let threadId = p.threadId;
            if (!threadId) {
                if (!createIfMissing) return err('no_thread', 'no thread');
                const t = await ensureThread(p, index, hooks, text);
                if (typeof t !== 'string') return t;
                threadId = t;
            }
            try {
                // Simplest non-duplicating behavior: if role is user & stream requested, use ChatInput bridge instead of manual append.
                if (role === 'user' && stream) {
                    const { programmaticSend, hasPane } = await import(
                        '~/composables/chat/useChatInputBridge'
                    );
                    if (hasPane(p.id)) {
                        const okBridge = programmaticSend(p.id, text);
                        if (okBridge) {
                            log('sendMessage-bridge', {
                                source,
                                paneId,
                                threadId,
                            });
                            return {
                                ok: true,
                                messageId: 'bridge',
                                threadId,
                            };
                        }
                    }
                }
                // Fallback: direct append (no streaming)
                const dbMsg = await tx.appendMessage({
                    thread_id: threadId,
                    role: role === 'assistant' ? 'assistant' : 'user',
                    data: { content: text, attachments: [] },
                });
                try {
                    hooks.doAction?.('ui.pane.msg:action:sent', {
                        pane: p,
                        paneIndex: index,
                        message: {
                            id: dbMsg.id,
                            threadId,
                            length: text.length,
                            fileHashes: null,
                        },
                        meta: { source },
                    });
                } catch {
                    reportError(
                        coreErr('ERR_INTERNAL', 'pane msg hook failed'),
                        {
                            silent: true,
                            tags: { domain: 'pane', stage: 'msg_hook' },
                        }
                    );
                }
                log('sendMessage-fallback', {
                    source,
                    paneId,
                    threadId,
                    id: dbMsg.id,
                });
                return { ok: true, messageId: dbMsg.id, threadId };
            } catch (e: unknown) {
                return err(
                    'append_failed',
                    e instanceof Error ? e.message : 'append failed'
                );
            }
        },
        updateDocumentContent({
            paneId,
            content,
            source,
        }: UpdateDocumentOptions) {
            if (!source) return err('missing_source', 'source required');
            const entry = getPaneEntry(paneId);
            if (!entry) return err('not_found', 'pane not found');
            const p = entry.pane;
            if (p.mode !== 'doc') return err('pane_not_doc', 'pane not doc');
            if (!p.documentId) return err('no_document', 'no document');
            // Runtime validation could be added here, for now we cast to satisfy the store API
            setDocumentContent(p.documentId, content as TipTapDocument);
            log('updateDocumentContent', { source, paneId });
            return { ok: true };
        },
        patchDocumentContent({ paneId, patch, source }: PatchDocumentOptions) {
            if (!source) return err('missing_source', 'source required');
            const entry = getPaneEntry(paneId);
            if (!entry) return err('not_found', 'pane not found');
            const p = entry.pane;
            if (p.mode !== 'doc') return err('pane_not_doc', 'pane not doc');
            if (!p.documentId) return err('no_document', 'no document');
            const st = useDocumentState(p.documentId) as {
                record?: { content?: unknown };
            };
            const merged = patchDoc(st?.record?.content, patch);
            setDocumentContent(p.documentId, merged as unknown as TipTapDocument);
            log('patchDocumentContent', { source, paneId });
            return { ok: true };
        },
        setDocumentTitle({ paneId, title, source }: SetDocumentTitleOptions) {
            if (!source) return err('missing_source', 'source required');
            const entry = getPaneEntry(paneId);
            if (!entry) return err('not_found', 'pane not found');
            const p = entry.pane;
            if (p.mode !== 'doc') return err('pane_not_doc', 'pane not doc');
            if (!p.documentId) return err('no_document', 'no document');
            setDocumentTitle(p.documentId, title);
            log('setDocumentTitle', { source, paneId });
            return { ok: true };
        },
        getActivePaneData() {
            const m = mp();
            const panes = m?.panes.value;
            const idx = m?.activePaneIndex.value ?? -1;
            if (!panes || idx < 0 || idx >= panes.length)
                return err('no_active_pane', 'no active pane');
            const p = panes[idx];
            if (!p) return err('no_active_pane', 'no active pane');
            const base: ActivePaneInfo = { paneId: p.id, mode: p.mode };

            // Add recordId for all panes (alias of documentId)
            if (p.documentId) {
                base.recordId = p.documentId;
            }

            if (p.mode === 'chat' && p.threadId) base.threadId = p.threadId;
            if (p.mode === 'doc' && p.documentId) {
                base.documentId = p.documentId;
                try {
                    const st = useDocumentState(p.documentId) as {
                        record?: { content?: unknown };
                    };
                    const c = st.record?.content;
                    base.contentSnapshot = c
                        ? JSON.parse(JSON.stringify(c))
                        : undefined;
                } catch {
                    reportError(
                        coreErr('ERR_INTERNAL', 'pane doc snapshot failed'),
                        {
                            silent: true,
                            tags: { domain: 'pane', stage: 'snapshot' },
                        }
                    );
                }
            }
            return { ok: true, ...base };
        },
        getPanes() {
            const m = mp();
            const panes = m?.panes.value;
            if (!panes) return err('no_panes', 'no panes');
            const activeIndex = m.activePaneIndex.value;
            const mapped: PaneDescriptor[] = panes.map((p) => ({
                paneId: p.id,
                mode: p.mode,
                threadId: p.threadId || undefined,
                documentId: p.documentId || undefined,
                recordId: p.documentId || undefined, // Alias for non-doc panes
            }));
            return { ok: true, panes: mapped, activeIndex };
        },
        posts: {
            async create({
                postType,
                title,
                content = '',
                meta,
                source,
            }: CreatePostOptions) {
                if (!source) return err('missing_source', 'source required');
                if (!postType || typeof postType !== 'string')
                    return err('invalid_post_type', 'postType required');
                if (!title || typeof title !== 'string' || !title.trim())
                    return err('invalid_text', 'title required');

                try {
                    const input: PostCreate = {
                        title: title.trim(),
                        content,
                        postType,
                        meta: meta as Post['meta'], // Schema will normalize
                    };
                    const created = await createPost(input);
                    log('posts.create', { source, postType, id: created.id });
                    return { ok: true, id: created.id };
                } catch (e: unknown) {
                    return err(
                        'post_create_failed',
                        e instanceof Error ? e.message : 'create failed'
                    );
                }
            },

            async get({ id }: GetPostOptions) {
                if (!id) return err('post_not_found', 'id required');

                try {
                    const post = await getPost(id);
                    if (!post) {
                        return err('post_not_found', 'post not found');
                    }

                    // getPost returns Post, convert to PostData with parsed meta
                    const dbPost = post as unknown as Post;
                    const postData: PostData = {
                        ...dbPost,
                        meta: parseMeta(dbPost.meta),
                    };

                    log('posts.get', { id });
                    return { ok: true, post: postData };
                } catch (e: unknown) {
                    return err(
                        'post_not_found',
                        e instanceof Error ? e.message : 'get failed'
                    );
                }
            },

            async update({ id, patch, source }: UpdatePostOptions) {
                if (!source) return err('missing_source', 'source required');
                if (!id) return err('post_not_found', 'id required');

                try {
                    const existing = await getPost(id);
                    if (!existing)
                        return err('post_not_found', 'post not found');

                    // getPost returns Post through db.posts.get
                    const existingPost = existing as unknown as Post;

                    const updated: Post = {
                        ...existingPost,
                        title: patch.title?.trim() || existingPost.title,
                        content: patch.content ?? existingPost.content,
                        postType: patch.postType ?? existingPost.postType,
                        meta:
                            patch.meta !== undefined
                                ? (patch.meta as Post['meta'])
                                : existingPost.meta,
                        updated_at: nowSec(),
                    };

                    await upsertPost(updated);
                    log('posts.update', { source, id });
                    return { ok: true };
                } catch (e: unknown) {
                    return err(
                        'post_update_failed',
                        e instanceof Error ? e.message : 'update failed'
                    );
                }
            },

            async delete({ id, source }: DeletePostOptions) {
                if (!source) return err('missing_source', 'source required');
                if (!id) return err('post_not_found', 'id required');

                try {
                    const existing = await getPost(id);
                    if (!existing)
                        return err('post_not_found', 'post not found');

                    await softDeletePost(id);
                    log('posts.delete', { source, id });
                    return { ok: true };
                } catch (e: unknown) {
                    return err(
                        'post_delete_failed',
                        e instanceof Error ? e.message : 'delete failed'
                    );
                }
            },

            async listByType({ postType, limit }: ListPostsByTypeOptions) {
                if (!postType || typeof postType !== 'string')
                    return err('invalid_post_type', 'postType required');

                try {
                    const results = await db.posts
                        .where('postType')
                        .equals(postType)
                        .and((p) => !p.deleted)
                        .sortBy('updated_at');

                    const sorted = results.slice().reverse();
                    const sliced = limit ? sorted.slice(0, limit) : sorted;

                    // Parse meta for each post
                    const posts: PostData[] = sliced.map((p) => ({
                        ...p,
                        meta: parseMeta(p.meta),
                    }));

                    log('posts.listByType', {
                        postType,
                        count: posts.length,
                    });
                    return { ok: true, posts };
                } catch (e: unknown) {
                    return err(
                        'post_not_found',
                        e instanceof Error ? e.message : 'list failed'
                    );
                }
            },
        },
    };
}
export default defineNuxtPlugin(() => {
    const g = globalThis as unknown as { __or3PanePluginApi?: PanePluginApi };
    if (g.__or3PanePluginApi) return;
    try {
        g.__or3PanePluginApi = makeApi();
        if (import.meta.dev) console.log('[pane-plugin-api] ready');
    } catch (e) {
        console.error('[pane-plugin-api] failed to init', e);
    }
});
