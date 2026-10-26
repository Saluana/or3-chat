import 'fake-indexeddb/auto';
import { Blob as NativeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkspaceDb, evictWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { MessageSchema, ThreadSchema } from '~/db/schema';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import type { SessionContext } from '~/core/hooks/hook-types';
import { runForegroundStreamLoop } from '../foregroundStream';
import { continueMessageImpl, type ContinueMessageContext } from '../continue';
import { createChatRequest } from '../requestController';
import { makeAssistantPersister } from '../persistence';
import type { StoredMessage } from '../types';

const boundary = vi.hoisted(() => ({ stream: vi.fn(), session: null as SessionContext | null }));
vi.mock('~/utils/chat/openrouterStream', async original => ({
    ...await original<typeof import('~/utils/chat/openrouterStream')>(),
    openRouterStreamWithRetry: boundary.stream,
}));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => boundary.session }));
vi.mock('#imports', async original => ({ ...await original<typeof import('#imports')>(),
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: false, storage: { enabled: false } } }),
}));
const databases: Array<{ id: string; db: Or3DB }> = [];
beforeEach(() => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    boundary.session = null;
    boundary.stream.mockReset();
    boundary.stream.mockImplementation(async function* () {
        yield { type: 'image', url: 'https://media.example.test/generated.png' };
        yield { type: 'done' };
    });
    vi.stubGlobal('Blob', NativeBlob);
    vi.stubGlobal('Image', undefined);
});
afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveWorkspaceDb(null); setHookEngine(null);
    for (const { id, db } of databases.splice(0)) { evictWorkspaceDb(id); await Dexie.delete(db.name); }
});
async function fixture() {
    const id = crypto.randomUUID(); const db = getWorkspaceDb(id); databases.push({ id, db }); await db.open();
    await db.threads.put(ThreadSchema.parse({ id: 'thread', clock: 1, created_at: 1, updated_at: 1 }));
    await db.messages.put(MessageSchema.parse({ id: 'assistant', role: 'assistant', thread_id: 'thread',
        index: 1, clock: 1, created_at: 1, updated_at: 1, data: { content: 'Existing reply' } }));
    return { id, db };
}
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
async function run(mode: 'send' | 'continue', origin: { id: string; db: Or3DB }) {
    const accumulator = { reset: vi.fn(), append: vi.fn(), finalize: vi.fn(), state: { finalized: false } };
    if (mode === 'send') {
        const fileHashes: string[] = [];
        await runForegroundStreamLoop({ apiKey: 'synthetic', modelId: 'model', modalities: ['text', 'image'],
            orMessages: [{ role: 'user', content: [{ type: 'text', text: 'Generate' }] }], originDb: origin.db,
            workspaceId: origin.id, threadId: 'thread', assistantId: 'assistant', streamId: 'request',
            abortSignal: new AbortController().signal, streamAcc: accumulator, hooks: useHooks(),
            toolRegistry: { executeTool: vi.fn() },
            persistAssistant: makeAssistantPersister(origin.db, (await origin.db.messages.get('assistant')) as StoredMessage, fileHashes),
            assistantFileHashes: fileHashes, activeToolCalls: new Map(), tailAssistant: ref(null), rawMessages: ref([]) });
        return 'complete';
    }
    const request = createChatRequest({ requestId: 'request', originDb: origin.db, workspaceId: origin.id,
        threadId: 'thread', kind: 'continue', accumulator });
    request.ownsView = () => !request.cancelled;
    const ctx: ContinueMessageContext = { request, loading: ref(false), aborted: ref(false), abortController: ref(null),
        threadIdRef: ref('thread'), tailAssistant: ref(null), rawMessages: ref([]), messages: ref([]), streamId: ref(undefined),
        streamAcc: accumulator, streamState: accumulator.state, hooks: useHooks(), effectiveApiKey: ref('synthetic'),
        hasInstanceKey: ref(false), hasUserKey: ref(true), defaultModelId: 'model', getSystemPromptContent: async () => null,
        useAiSettings: () => ({ settings: ref(undefined) }), resetStream: vi.fn(),
        resolveContextPolicy: async () => ({ model: { context_length: 1_000_000 }, userMaxContextTokens: null, source: 'openrouter-live' }) };
    await continueMessageImpl(ctx, 'assistant');
    return request.terminal?.outcome;
}

describe.each(['send', 'continue'] as const)('generated image %s ownership and durability', mode => {
    it('stores a current image and persists its hash on the originating reply', async () => {
        const origin = await fixture(); setActiveWorkspaceDb(origin.id);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            { headers: { 'content-type': 'image/png' } })));
        expect(await run(mode, origin)).toBe(mode === 'send' ? 'complete' : 'completed');
        const meta = (await origin.db.file_meta.toArray())[0]!;
        expect(meta.kind).toBe('image');
        expect((await origin.db.file_blobs.get(meta.hash))?.blob.size).toBe(8);
        expect(JSON.parse((await origin.db.messages.get('assistant'))!.file_hashes!)).toEqual([meta.hash]);
    });

    it.each(['download switch', 'download return', 'intake switch', 'account change'] as const)(
        'does not store originating bytes after %s', async transition => {
            const origin = await fixture(); const target = await fixture(); setActiveWorkspaceDb(origin.id);
            const reached = deferred(); const gate = deferred();
            if (transition === 'account change') boundary.session = { authenticated: true, user: { id: 'A' }, role: 'owner' };
            vi.stubGlobal('fetch', vi.fn(async () => {
                if (transition !== 'intake switch') { reached.resolve(); await gate.promise; }
                return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'content-type': 'image/png' } });
            }));
            if (transition === 'intake switch') useHooks().addFilter('db.files.create:filter:input', async row => {
                reached.resolve(); await gate.promise; return row;
            });
            const running = run(mode, origin).catch(error => error);
            try {
                await reached.promise;
                if (transition === 'account change') boundary.session!.user = { id: 'B' };
                else {
                    setActiveWorkspaceDb(target.id);
                    if (transition === 'download return') setActiveWorkspaceDb(origin.id);
                }
                gate.resolve(); await running;
                expect(await target.db.file_meta.count()).toBe(0); expect(await target.db.file_blobs.count()).toBe(0);
                expect(await origin.db.file_meta.count()).toBe(0); expect(await origin.db.file_blobs.count()).toBe(0);
            } finally { gate.resolve(); await running; }
        }
    );

    it('reports a failed generation when the image blob cannot be stored', async () => {
        const origin = await fixture(); setActiveWorkspaceDb(origin.id);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('bytes', { headers: { 'content-type': 'application/octet-stream' } })));
        vi.spyOn(origin.db.file_blobs, 'put').mockRejectedValueOnce(new DOMException('Synthetic quota exhaustion', 'QuotaExceededError'));
        const result = await run(mode, origin).catch(error => error);
        if (mode === 'send') expect(result).toBeInstanceOf(Error);
        else expect(result).toBe('failed');
        expect(await origin.db.file_meta.count()).toBe(0); expect(await origin.db.file_blobs.count()).toBe(0);
    });
});


describe('continuation durable admission and output', () => {
    it('does not finalize a legacy reply when its revision changes before the continuation claim', async () => {
        const origin = await fixture(); setActiveWorkspaceDb(origin.id);
        let edited: Awaited<ReturnType<typeof origin.db.messages.get>>;
        const edit = async () => {
            if (edited) return;
            await origin.db.messages.update('assistant', { clock: 2, data: { content: 'Edited in another pane' } });
            edited = await origin.db.messages.get('assistant');
        };
        useHooks().addAction('db.messages.upsert:action:before', edit);
        try {
            await run('continue', origin);
            expect(boundary.stream).not.toHaveBeenCalled();
            expect(await origin.db.messages.get('assistant')).toEqual(edited);
        } finally { useHooks().removeAction('db.messages.upsert:action:before', edit); }
    });

    it('admits only one of two panes preparing the same assistant', async () => {
        const origin = await fixture(); setActiveWorkspaceDb(origin.id);
        const reached = deferred(); const release = deferred(); let prepared = 0;
        useHooks().addAction('db.messages.upsert:action:before', async () => {
            prepared++;
            if (prepared <= 2) { if (prepared === 2) reached.resolve(); await release.promise; }
        });
        boundary.stream.mockImplementation(async function* () { yield { type: 'text', text: ' continuation' }; });
        const first = run('continue', origin); const second = run('continue', origin);
        try {
            await reached.promise; release.resolve(); await Promise.all([first, second]);
            expect(boundary.stream).toHaveBeenCalledTimes(1);
            expect((await origin.db.messages.get('assistant'))?.pending).toBe(false);
        } finally { release.resolve(); await Promise.all([first, second]); }
    });

    it.each(['text', 'reasoning'] as const)('rejects oversized continued %s while preserving a saveable accepted prefix', async (type) => {
        const origin = await fixture(); setActiveWorkspaceDb(origin.id);
        boundary.stream.mockImplementation(async function* () {
            yield { type, text: ' accepted' };
            yield { type, text: '\0'.repeat(50_000) };
        });
        expect(await run('continue', origin)).toBe('failed');
        const row = (await origin.db.messages.get('assistant'))!;
        expect(row.pending).toBe(false);
        const data = row.data as Record<string, unknown>;
        expect(data.content).toBe(type === 'text' ? 'Existing reply accepted' : 'Existing reply');
        expect(type === 'reasoning' ? data.reasoning_text : data.content).not.toContain('\0');
        expect(new TextEncoder().encode(JSON.stringify(row)).byteLength).toBeLessThan(256 * 1024);
    });
});
