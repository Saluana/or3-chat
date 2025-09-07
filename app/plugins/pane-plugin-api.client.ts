import { nowSec } from '~/db/util';
import { create, tx } from '~/db';
import { useNuxtApp } from '#app';
import {
    setDocumentContent,
    setDocumentTitle,
    useDocumentState,
} from '~/composables/useDocumentsStore';
import type { Ref } from 'vue';
import type { PaneState } from '~/composables/useMultiPane';

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
    | 'no_panes';

/** Success result helper */
export type Ok<T extends object = {}> = { ok: true } & T;
/** Error result helper */
export interface Err<C extends PaneApiErrorCode = PaneApiErrorCode> {
    ok: false;
    code: C;
    message: string;
}

/** Unified result type */
export type Result<T extends object = {}> = Ok<T> | Err;
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
    contentSnapshot?: unknown;
}

export interface PaneDescriptor {
    paneId: string;
    mode: PaneState['mode'];
    threadId?: string;
    documentId?: string;
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
}
const err = <C extends PaneApiErrorCode>(code: C, message: string): Err<C> => ({
    ok: false,
    code,
    message,
});
const mp = (): MultiPaneApi | undefined =>
    (globalThis as any).__or3MultiPaneApi;
function getPaneEntry(
    id: string
): { pane: PaneState; index: number; mp: MultiPaneApi } | null {
    const m = mp();
    const ps = m?.panes?.value;
    if (!ps) return null;
    const index = ps.findIndex((p) => p.id === id);
    if (index < 0) return null;
    const pane = ps[index];
    if (!pane) return null;
    return { pane, index, mp: m! };
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
        h.doAction?.('ui.pane.thread:action:changed', p, '', t.id, 0);
    } catch {}
    return t.id;
}
type DocJson = { type: string; content?: unknown[]; [k: string]: unknown };
function patchDoc(base: unknown, patch: unknown): DocJson {
    let b: DocJson =
        base && typeof base === 'object'
            ? (base as DocJson)
            : { type: 'doc', content: [] };
    if (patch && typeof patch === 'object') {
        const p = patch as DocJson;
        if (Array.isArray(b.content) && Array.isArray(p.content))
            b.content = [...b.content, ...p.content];
        else if (Array.isArray(p.content)) b.content = p.content;
        for (const k of Object.keys(p))
            if (k !== 'content') (b as any)[k] = (p as any)[k];
    }
    return b;
}
const log = (tag: string, meta: unknown) => {
    if (import.meta.dev)
        try {
            console.debug('[pane-plugin-api] ' + tag, meta);
        } catch {}
};
async function makeApi(): Promise<PanePluginApi> {
    const hooks: HookBus = (useNuxtApp() as any).$hooks;
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
                        '~/composables/useChatInputBridge'
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
                            } as any;
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
                    hooks.doAction?.('ui.pane.msg:action:sent', p, {
                        id: dbMsg.id,
                        threadId,
                        length: text.length,
                        fileHashes: null,
                        paneIndex: -1,
                        source,
                    });
                } catch {}
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
            setDocumentContent(p.documentId, content);
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
            setDocumentContent(p.documentId, merged);
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
            const panes = m?.panes?.value;
            const idx = m?.activePaneIndex?.value ?? -1;
            if (!panes || idx < 0 || idx >= panes.length)
                return err('no_active_pane', 'no active pane');
            const p = panes[idx];
            if (!p) return err('no_active_pane', 'no active pane');
            const base: ActivePaneInfo = { paneId: p.id, mode: p.mode };
            if (p.mode === 'chat' && p.threadId) base.threadId = p.threadId;
            if (p.mode === 'doc' && p.documentId) {
                base.documentId = p.documentId;
                try {
                    const st = useDocumentState(p.documentId) as {
                        record?: { content?: unknown };
                    };
                    const c = st?.record?.content;
                    base.contentSnapshot = c
                        ? JSON.parse(JSON.stringify(c))
                        : undefined;
                } catch {}
            }
            return { ok: true, ...base };
        },
        getPanes() {
            const m = mp();
            const panes = m?.panes?.value;
            if (!panes) return err('no_panes', 'no panes');
            const activeIndex = m?.activePaneIndex?.value ?? -1;
            const mapped: PaneDescriptor[] = panes.map((p) => ({
                paneId: p.id,
                mode: p.mode,
                threadId: p.threadId || undefined,
                documentId: p.documentId || undefined,
            }));
            return { ok: true, panes: mapped, activeIndex };
        },
    };
}
export default defineNuxtPlugin(async () => {
    if ((globalThis as any).__or3PanePluginApi) return;
    try {
        (globalThis as any).__or3PanePluginApi = await makeApi();
        if (import.meta.dev) console.log('[pane-plugin-api] ready');
    } catch (e) {
        console.error('[pane-plugin-api] failed to init', e);
    }
});
