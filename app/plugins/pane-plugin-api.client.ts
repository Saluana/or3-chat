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

type Ok<T extends object = {}> = { ok: true } & T;
type Err = { ok: false; code: string; message: string };
interface MultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    setPaneThread(i: number, id: string): Promise<void> | void;
}
interface HookBus {
    doAction?(name: string, ...a: unknown[]): void;
}
export interface PanePluginApi {
    sendMessage(o: {
        paneId: string;
        text: string;
        role?: 'user' | 'assistant';
        createIfMissing?: boolean;
        source: string;
    }): Promise<Ok<{ messageId: string; threadId: string }> | Err>;
    updateDocumentContent(o: {
        paneId: string;
        content: unknown;
        source: string;
    }): Ok | Err;
    patchDocumentContent(o: {
        paneId: string;
        patch: unknown;
        source: string;
    }): Ok | Err;
    setDocumentTitle(o: {
        paneId: string;
        title: string;
        source: string;
    }): Ok | Err;
    getActivePaneData():
        | Ok<{
              paneId: string;
              mode: string;
              threadId?: string;
              documentId?: string;
              contentSnapshot?: unknown;
          }>
        | Err;
}
const err = (code: string, message: string): Err => ({
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
        }) {
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
                    });
                } catch {}
                log('sendMessage', { source, paneId, threadId, id: dbMsg.id });
                return { ok: true, messageId: dbMsg.id, threadId };
            } catch (e: unknown) {
                return err(
                    'append_failed',
                    e instanceof Error ? e.message : 'append failed'
                );
            }
        },
        updateDocumentContent({ paneId, content, source }) {
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
        patchDocumentContent({ paneId, patch, source }) {
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
        setDocumentTitle({ paneId, title, source }) {
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
            const base: {
                paneId: string;
                mode: string;
                threadId?: string;
                documentId?: string;
                contentSnapshot?: unknown;
            } = { paneId: p.id, mode: p.mode };
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
