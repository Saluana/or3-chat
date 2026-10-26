import { createHookEngine } from '~~/shared/hooks/hook-engine-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, Thread } from '../schema';
import Dexie from 'dexie';

const testState = vi.hoisted(() => ({
    db: null as import('../client').Or3DB | null,
    doAction: vi.fn(),
}));

vi.mock('../client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../client')>();
    return {
        ...actual,
        getDb: () => {
            if (!testState.db) throw new Error('Test database is not initialized');
            return testState.db;
        },
    };
});

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: testState.doAction,
    }),
}));

import { Or3DB } from '../client';
import { ref, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { captureCardChatScope, createToolCardChatBridge, provideToolCardChatBridge } from '~/composables/chat/tool-card-chat-bridge';
import ToolCardSlot from '~/components/chat/tool-cards/ToolCardSlot.vue';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import type { ToolCardContext } from '@or3/plugin-sdk/cards';
import { resolveThreadProjection } from '~/utils/chat/compaction/history';
import { projectTranscriptForUi, projectTranscriptForOpenRouter, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { buildOpenRouterMessages } from '~/core/auth/openrouter-build';
import { pluginOk } from '@or3/plugin-sdk';
import { makeAssistantPersister, startForegroundGenerationHeartbeat } from '~/utils/chat/useAi-internal/persistence';
import {
    appendMessage,
    copyMessage,
    insertMessageAfter,
    messagesByThread,
    moveMessage,
    normalizeThreadIndexes,
    patchMessageInDb,
    patchMessageDataEntry,
} from '../messages';

let databaseSequence = 0;

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
    return {
        id,
        title: id,
        created_at: 100,
        updated_at: 100,
        last_message_at: null,
        parent_thread_id: null,
        anchor_message_id: null,
        anchor_index: null,
        branch_mode: null,
        status: 'ready',
        deleted: false,
        pinned: false,
        clock: 0,
        forked: false,
        project_id: null,
        system_prompt_id: null,
        ...overrides,
    };
}

function makeMessage(
    id: string,
    threadId: string,
    index: number,
    overrides: Partial<Message> = {}
): Message {
    return {
        id,
        thread_id: threadId,
        role: 'user',
        data: { content: id },
        index,
        order_key: `order-${id}`,
        created_at: 100,
        updated_at: 100,
        deleted: false,
        clock: 0,
        ...overrides,
    };
}

describe('message transaction and ordering contracts', () => {
    beforeEach(async () => {
        vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request in synthetic message test'); }));
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
        testState.doAction.mockReset();
        testState.doAction.mockResolvedValue(undefined);
        testState.db = new Or3DB(`or3-messages-test-${databaseSequence++}`);
        await testState.db.open();
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        const db = testState.db;
        testState.db = null;
        if (db) {
            db.close();
            await db.delete();
        }
    });

    it('finishes admitted card saves on the original thread while rejecting new stale actions', async () => {
        const db = testState.db!;
        await db.messages.put(makeMessage('card', 'original', 1, { role: 'assistant' }));
        const threadId = ref<string | null>('original');
        const bridge = createToolCardChatBridge({ threadId, busy: ref(false), send: async () => pluginOk(undefined) });
        const scope = captureCardChatScope(threadId.value);
        const write = bridge.writeState('card', 'call', { answer: 'A' }, scope);
        threadId.value = 'other';
        await bridge.flush();
        expect((await write).ok).toBe(true);
        expect((await db.messages.get('card'))?.data).toMatchObject({ tool_cards: { call: { state: { answer: 'A' } } } });
        expect((await bridge.writeState('card', 'call', {}, scope)).ok).toBe(false);
        const admitted = bridge.writeState('card', 'call', {}, captureCardChatScope('other'));
        testState.db = new Or3DB('switched-card-workspace');
        try {
            await bridge.flush();
            expect((await admitted).ok).toBe(false);
        } finally {
            testState.db.close();
            testState.db = db;
        }
    });

    it.each(['same pane', 'reference branch'])('keeps same-call saves ordered across asynchronous hooks from %s', async pane => {
        vi.useRealTimers();
        const db = testState.db!;
        await db.messages.put(makeMessage('card', 'original', 1, { role: 'assistant' }));
        const bridge = createToolCardChatBridge({ threadId: ref('original'), busy: ref(false), send: async () => pluginOk(undefined) });
        const scope = captureCardChatScope('original');
        let release!: () => void;
        let entered!: () => void;
        const firstEntered = new Promise<void>(resolve => { entered = resolve; });
        let blocked = false;
        testState.doAction.mockImplementation(async (name: string) => {
            if (name === 'db.messages.upsert:action:before' && !blocked) {
                blocked = true;
                entered();
                await new Promise<void>(resolve => { release = resolve; });
            }
        });
        const first = bridge.writeState('card', 'call', 1, scope);
        const firstFlush = bridge.flush();
        await firstEntered;
        const secondBridge = pane === 'same pane' ? bridge
            : createToolCardChatBridge({ threadId: ref('branch'), busy: ref(false), send: async () => pluginOk(undefined) });
        const secondScope = pane === 'same pane' ? scope : { ...captureCardChatScope('branch'), sourceThreadId: 'original' };
        const second = secondBridge.writeState('card', 'call', 2, secondScope);
        const secondFlush = secondBridge.flush();
        // Allow an incorrectly concurrent second transaction to complete first.
        await new Promise(resolve => setTimeout(resolve, 100));
        release();
        await Promise.all([firstFlush, secondFlush]);
        expect((await first).ok).toBe(true);
        expect((await second).ok).toBe(true);
        expect((await db.messages.get('card'))?.data).toMatchObject({ tool_cards: { call: { state: 2 } } });
    });

    it('reloads and saves inherited card state while sending through the branch pane', async () => {
        vi.useRealTimers();
        const db = testState.db!;
        await db.threads.bulkPut([makeThread('source'), makeThread('branch', {
            parent_thread_id: 'source', anchor_message_id: 'inherited-card', anchor_index: 1, branch_mode: 'reference', forked: true,
        })]);
        await db.messages.put(makeMessage('inherited-card', 'source', 1, { role: 'assistant', data: {
            content: '', tool_calls: [{ id: 'call', name: 'fixture_card', args: '{}', status: 'complete', result: '{}' }],
            tool_cards: { call: { v: 1, state: { answer: 'A' }, updated_at: 1 } },
        } }));
        const projection = await resolveThreadProjection('branch', db);
        const canonical = storedMessagesToCanonicalTranscript(projection.messages);
        const message = projectTranscriptForUi(canonical)[0]!;
        const call = message.toolCalls![0]!;
        const send = vi.fn(async () => pluginOk(undefined));
        const bridge = createToolCardChatBridge({ threadId: ref('branch'), busy: ref(false), send });
        let card!: ToolCardContext;
        const probe = defineComponent({ props: ['card'], setup(props) {
            card = props.card as ToolCardContext;
            return () => h('output', JSON.stringify(card.state));
        } });
        vi.stubGlobal('IntersectionObserver', class {
            constructor(readonly callback: (entries: unknown[]) => void) {}
            observe(target: Element) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]); }
            disconnect() {}
        });
        vi.stubGlobal('navigator', { userActivation: { isActive: true } });
        const wrapper = mount(defineComponent({ setup() {
            provideToolCardChatBridge(bridge);
            return () => h(ToolCardSlot, { message, call, binding: {
                tool: call.name, ownerPluginId: null, source: { kind: 'page', module: vueCard(probe) },
            } });
        } }));
        try {
            await vi.waitFor(() => expect(wrapper.text()).toContain('A'));
            await db.messages.update('inherited-card', { data: { tool_cards: { call: { v: 1, state: { answer: 'Synced' }, updated_at: 2 } } } });
            await vi.waitFor(() => expect(wrapper.text()).toContain('Synced'));
            const saving = card.setState({ answer: 'B' });
            await bridge.flush();
            expect((await saving).ok).toBe(true);
            expect((await db.messages.get('inherited-card'))?.data).toMatchObject({ tool_cards: { call: { state: { answer: 'B' } } } });
            expect(await db.messages.where('thread_id').equals('branch').count()).toBe(0);
            expect((await card.send('Answer B')).ok).toBe(true);
            expect(send).toHaveBeenCalledWith('Answer B', expect.objectContaining({ message_id: 'inherited-card', call_id: 'call' }));
            const wire = await buildOpenRouterMessages(projectTranscriptForOpenRouter(canonical));
            expect(JSON.stringify(wire)).not.toMatch(/sourceThreadId|tool_cards|card_origin/);
        } finally { wrapper.unmount(); await bridge.flush(); }
    });

    it('appends with sparse indexes, serializes file hashes, and updates the thread atomically', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1', { clock: 4 }));

        const first = await appendMessage({
            id: 'message-1',
            thread_id: 'thread-1',
            role: 'user',
            file_hashes: ['hash-a', 'hash-b'] as unknown as string,
        });
        const second = await appendMessage({
            id: 'message-2',
            thread_id: 'thread-1',
            role: 'assistant',
        });

        expect(first).toMatchObject({
            id: 'message-1',
            index: 1000,
            clock: 1,
            file_hashes: JSON.stringify(['hash-a', 'hash-b']),
        });
        expect(second.index).toBe(2000);
        expect((await db.threads.get('thread-1'))).toMatchObject({
            last_message_at: 1767323045,
            updated_at: 1767323045,
            clock: 6,
        });
        expect(testState.doAction).toHaveBeenCalledWith(
            'db.messages.append:action:after',
            expect.objectContaining({ id: 'message-2', index: 2000 })
        );
    });

    it('moves a message and copies another to the next destination indexes', async () => {
        const db = testState.db!;
        await db.threads.bulkPut([
            makeThread('source'),
            makeThread('destination', { clock: 10 }),
        ]);
        await db.messages.bulkPut([
            makeMessage('source-move', 'source', 1000),
            makeMessage('source-copy', 'source', 2000, {
                role: 'assistant',
                data: { content: 'preserved', tool_cards: { call: { v: 1, state: { answer: 'Original' }, updated_at: 1 } } },
            }),
            makeMessage('destination-existing', 'destination', 3000),
        ]);

        await moveMessage('source-move', 'destination');
        await copyMessage('source-copy', 'destination');

        const moved = await db.messages.get('source-move');
        expect(moved).toMatchObject({
            thread_id: 'destination',
            index: 4000,
            clock: 1,
        });

        const destinationRows = await db.messages
            .where('thread_id')
            .equals('destination')
            .toArray();
        const copied = destinationRows.find(
            (message) =>
                message.id !== 'source-move' &&
                message.id !== 'destination-existing'
        );
        expect(copied).toMatchObject({
            thread_id: 'destination',
            index: 5000,
            data: { content: 'preserved' },
            clock: 1,
        });
        expect(copied?.id).not.toBe('source-copy');
        expect(await db.messages.get('source-copy')).toBeDefined();
        expect(await db.threads.get('destination')).toMatchObject({
            last_message_at: 1767323045,
            clock: 12,
        });
        const bridge = createToolCardChatBridge({ threadId: ref('destination'), busy: ref(false), send: async () => pluginOk(undefined) });
        const saving = bridge.writeState(copied!.id, 'call', { answer: 'Copied' }, captureCardChatScope('destination'));
        await bridge.flush();
        expect((await saving).ok).toBe(true);
        expect((await db.messages.get(copied!.id))?.data).toMatchObject({ tool_cards: { call: { state: { answer: 'Copied' } } } });
        expect((await db.messages.get('source-copy'))?.data).toMatchObject({ tool_cards: { call: { state: { answer: 'Original' } } } });
    });

    it('inserts at a midpoint without rewriting existing sparse indexes', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        await db.messages.bulkPut([
            makeMessage('before', 'thread-1', 1000),
            makeMessage('after', 'thread-1', 2000),
        ]);

        const inserted = await insertMessageAfter('before', {
            id: 'inserted',
            thread_id: 'ignored-by-api',
            role: 'assistant',
        });

        expect(inserted).toMatchObject({
            id: 'inserted',
            thread_id: 'thread-1',
            index: 1500,
        });
        expect((await db.messages.get('before'))?.index).toBe(1000);
        expect((await db.messages.get('after'))?.index).toBe(2000);
    });

    it('normalizes adjacent indexes before inserting and preserves their order', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        await db.messages.bulkPut([
            makeMessage('first', 'thread-1', 10),
            makeMessage('second', 'thread-1', 11),
            makeMessage('third', 'thread-1', 12),
        ]);

        const inserted = await insertMessageAfter('first', {
            id: 'inserted',
            thread_id: 'thread-1',
            role: 'assistant',
        });

        expect(inserted.index).toBe(1500);
        const rows = await db.messages
            .where('thread_id')
            .equals('thread-1')
            .toArray();
        rows.sort((a, b) => a.index - b.index);
        expect(rows.map(({ id, index }) => [id, index])).toEqual([
            ['first', 1000],
            ['inserted', 1500],
            ['second', 2000],
            ['third', 3000],
        ]);
    });

    it('normalizes with custom spacing and skips already normalized rows', async () => {
        const db = testState.db!;
        await db.messages.bulkPut([
            makeMessage('first', 'thread-1', 50, { clock: 2 }),
            makeMessage('second', 'thread-1', 75, { clock: 3 }),
            makeMessage('third', 'thread-1', 100, { clock: 4 }),
        ]);

        await normalizeThreadIndexes('thread-1', 50, 50);

        expect(await db.messages.get('first')).toMatchObject({
            index: 50,
            clock: 2,
            updated_at: 100,
        });
        expect(await db.messages.get('second')).toMatchObject({
            index: 100,
            clock: 4,
            updated_at: 1767323045,
        });
        expect(await db.messages.get('third')).toMatchObject({
            index: 150,
            clock: 5,
            updated_at: 1767323045,
        });
    });

    it('insertMessageAfter ignores other threads when the anchor is last', async () => {
        const db = testState.db!;
        // Dexie compound-index order interleaves thread b between thread a rows
        // unless the neighbor query is bounded to the anchor thread.
        await db.threads.bulkPut([makeThread('thread-a'), makeThread('thread-b')]);
        await db.messages.bulkPut([
            makeMessage('a-1', 'thread-a', 1000),
            makeMessage('a-2', 'thread-a', 2000),
            makeMessage('a-3', 'thread-a', 3000),
            makeMessage('b-1', 'thread-b', 1000),
        ]);
        const inserted = await insertMessageAfter('a-3', {
            id: 'a-4',
            thread_id: 'thread-a',
            role: 'assistant',
        } as any);

        expect(inserted.thread_id).toBe('thread-a');
        expect(inserted.index).toBe(4000);
        expect(inserted.index).toBeGreaterThan(3000);
    });

    it('orders index collisions deterministically by order key and then id', async () => {
        const db = testState.db!;
        await db.messages.bulkPut([
            makeMessage('z-id', 'thread-1', 1000, { order_key: 'a' }),
            makeMessage('a-id', 'thread-1', 1000, { order_key: 'a' }),
            makeMessage('middle', 'thread-1', 1000, { order_key: 'b' }),
            makeMessage('last-index', 'thread-1', 2000, {
                order_key: '0',
            }),
        ]);

        const ordered = (await messagesByThread('thread-1')) as Message[];

        expect(ordered.map((message) => message.id)).toEqual([
            'a-id',
            'z-id',
            'middle',
            'last-index',
        ]);
    });

    it('patchMessageInDb merges deltas atomically without dropping concurrent keys', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        await db.messages.put(
            makeMessage('msg-1', 'thread-1', 1000, {
                data: {
                    content: 'concurrent edit',
                    plugin_initial: true,
                    plugin_concurrent: { keep: true },
                },
                file_hashes: '["concurrent-file"]',
                clock: 5,
            })
        );

        // Delta built from stale state (no concurrent keys) must not erase them.
        const acknowledged = await patchMessageInDb(db, 'msg-1', {
            data: { reasoning_text: 'new reasoning', tool_calls: [] },
        } as any);

        const row = await db.messages.get('msg-1');
        expect(acknowledged).toEqual(row);
        expect(row).toMatchObject({
            clock: 6,
            file_hashes: '["concurrent-file"]',
            data: {
                content: 'concurrent edit',
                plugin_initial: true,
                plugin_concurrent: { keep: true },
                reasoning_text: 'new reasoning',
                tool_calls: [],
            },
        });
        await expect(patchMessageInDb(db, 'msg-1', { data: { content: 'stale generation' } }, undefined, () => false)).resolves.toBeUndefined();
        expect(await db.messages.get('msg-1')).toEqual(row);
    });

    // state-concurrency, state-validation and state-lifecycle in failure-modes.md.
    it('merges card entries with a concurrent streaming patch and deletes only one entry', async () => {
        const db = testState.db!;
        await db.messages.put(
            makeMessage('card-row', 'thread', 1000, {
                role: 'assistant',
                clock: 3,
            }),
        );
        await Promise.all([
            patchMessageDataEntry(db, 'card-row', 'tool_cards', 'a', {
                v: 1,
                state: { picked: 1 },
                updated_at: 1,
            }),
            patchMessageDataEntry(db, 'card-row', 'tool_cards', 'b', {
                v: 1,
                state: { picked: 2 },
                updated_at: 1,
            }),
            patchMessageInDb(db, 'card-row', {
                data: { tool_calls: [{ name: 'quiz', status: 'complete' }] },
            }),
        ]);
        expect(await db.messages.get('card-row')).toMatchObject({
            clock: 6,
            data: {
                tool_cards: {
                    a: { state: { picked: 1 } },
                    b: { state: { picked: 2 } },
                },
                tool_calls: [{ name: 'quiz', status: 'complete' }],
                content: 'card-row',
            },
        });
        await patchMessageDataEntry(db, 'card-row', 'tool_cards', 'a', null);
        const row = await db.messages.get('card-row');
        expect(Object.keys((row!.data as any).tool_cards)).toEqual(['b']);
        await expect(
            patchMessageDataEntry(db, 'card-row', 'tool_cards', 'b', {
                state: 'x'.repeat(17000),
            }),
        ).rejects.toThrow();
        expect(await db.messages.get('card-row')).toEqual(row);
        await db.messages.delete('card-row');
        await expect(
            patchMessageDataEntry(db, 'card-row', 'tool_cards', 'a', {}),
        ).rejects.toThrow();
        expect(await db.messages.get('card-row')).toBeUndefined();
    });

    it.each(['new-owner', 'cancel'] as const)('fences an in-flight foreground heartbeat after %s', async (change) => {
        const db = testState.db!;
        const initial = makeMessage('assistant', 'thread', 1, {
            role: 'assistant', pending: true,
            data: { content: 'partial', generation_lease_id: 'owner', generation_heartbeat_at: Date.now() },
        });
        await db.messages.put(initial);
        const controller = new AbortController();
        let release!: () => void;
        testState.doAction.mockImplementation((name: string) => name === 'db.messages.upsert:action:before'
            ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve());
        const stop = startForegroundGenerationHeartbeat(db, initial.id, 'owner', controller.signal);
        try {
            await vi.advanceTimersByTimeAsync(10_000);
            await vi.waitFor(() => expect(release).toBeTypeOf('function'));
            const latest = change === 'new-owner'
                ? { ...initial, clock: 2, data: { content: 'replacement', generation_lease_id: 'new-owner', generation_heartbeat_at: Date.now() } }
                : initial;
            if (change === 'new-owner') await db.messages.put(latest);
            else controller.abort();
            release();
            await vi.advanceTimersByTimeAsync(1);
            // Allow the prepared write to enter its real Dexie transaction.
            await db.transaction('rw', db.messages, async () => {});
            expect(await db.messages.get(initial.id)).toEqual(latest);
        } finally {
            stop();
        }
    });

    it.each(['new-owner', 'finalized'] as const)('preserves %s against a prepared foreground progress write', async (change) => {
        const db = testState.db!;
        const initial = {
            ...makeMessage('assistant', 'thread', 1, { role: 'assistant', pending: true }),
            data: { content: 'partial', generation_lease_id: 'owner' },
        };
        await db.messages.put(initial);
        let release!: () => void;
        testState.doAction.mockImplementation((name: string) => name === 'db.messages.upsert:action:before'
            ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve());
        const persist = makeAssistantPersister(db, initial, [], 'owner');
        const write = persist({ content: 'old progress', reasoning: 'old reasoning' });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const latest = {
            ...initial, clock: 2, pending: change === 'new-owner',
            data: { content: 'accepted answer', generation_lease_id: change === 'new-owner' ? 'new-owner' : 'owner' },
        };
        await db.messages.put(latest);
        release();
        await write;
        expect(await db.messages.get(initial.id)).toEqual(latest);
    });

    // Failure inventory: asynchronous before-hooks must finish before the write;
    // after-hook failures must not turn an already committed append into retry.
    it('appends atomically around asynchronous preparation and failed notification', async () => {
        vi.useRealTimers();
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1'));
        const observations: boolean[] = [];
        testState.doAction.mockImplementation(async (name: string) => {
            if (!name.startsWith('db.messages.append:')) return;
            await new Promise(resolve => setTimeout(resolve, 10));
            observations.push(Boolean(Dexie.currentTransaction));
            if (name.endsWith(':after')) {
                expect(await db.messages.get('committed')).toBeDefined();
                throw new Error('Notification failed');
            }
        });
        await expect(appendMessage({ id: 'committed', thread_id: 'thread-1', role: 'user' })).resolves.toMatchObject({ id: 'committed' });
        expect(observations).toEqual([false, false]);
        expect((await db.threads.get('thread-1'))?.clock).toBeGreaterThan(0);
    });

    it.each(['missing', 'deleted', 'deleted-during-hook'] as const)('refuses append into a %s parent without writing a message', async (state) => {
        const db = testState.db!;
        if (state !== 'missing') await db.threads.put(makeThread('thread-1', { deleted: state === 'deleted' }));
        if (state === 'deleted-during-hook') testState.doAction.mockImplementation(async (name: string) => {
            if (name === 'db.messages.append:action:before') await db.threads.update('thread-1', { deleted: true });
        });
        await expect(appendMessage({ id: 'orphan', thread_id: 'thread-1', role: 'user' })).rejects.toThrow(/thread/i);
        expect(await db.messages.get('orphan')).toBeUndefined();
    });

    it('keeps the canonical order of colliding indexes when normalizing', async () => {
        const db = testState.db!;
        await db.messages.bulkPut([
            makeMessage('a', 'thread-1', 10, { order_key: 'z' }),
            makeMessage('z', 'thread-1', 10, { order_key: 'a' }),
            makeMessage('b', 'thread-1', 10, { order_key: 'a' }),
        ]);
        expect(((await messagesByThread('thread-1')) as Message[]).map(row => row.id)).toEqual(['b', 'z', 'a']);
        await normalizeThreadIndexes('thread-1');
        expect(((await messagesByThread('thread-1')) as Message[]).map(row => row.id)).toEqual(['b', 'z', 'a']);
    });

    it('commits an append despite a real observational action callback failing', async () => {
        const db = testState.db!;
        await db.threads.put(makeThread('thread-1', { clock: 8 }));
        const engine = createHookEngine();
        const callback = vi.fn(() => { throw new Error('forced hook failure'); });
        engine.addAction('db.messages.append:action:before', callback);
        testState.doAction.mockImplementation(engine.doAction);
        await expect(appendMessage({ id: 'committed', thread_id: 'thread-1', role: 'user' })).resolves.toMatchObject({ id: 'committed' });
        expect(callback).toHaveBeenCalledOnce();
        expect(await db.messages.get('committed')).toBeDefined();
        expect((await db.threads.get('thread-1'))?.clock).toBe(9);
    });
});
