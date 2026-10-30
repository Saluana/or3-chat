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

import { Or3DB, setActiveWorkspaceDb, evictWorkspaceDb } from '../client';
import { ref, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { captureCardChatScope, createToolCardChatBridge, provideToolCardChatBridge } from '~/composables/chat/tool-card-chat-bridge';
import ToolCardSlot from '~/components/chat/tool-cards/ToolCardSlot.vue';
import { vueCard } from '@or3/plugin-sdk/cards/vue';
import type { ToolCardContext } from '@or3/plugin-sdk/cards';
import { ensureUiMessage, type ToolCallInfo } from '~/utils/chat/uiMessages';
import { resolveThreadProjection } from '~/utils/chat/compaction/history';
import { projectTranscriptForUi, projectTranscriptForOpenRouter, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { buildOpenRouterMessages } from '~/core/auth/openrouter-build';
import { pluginOk } from '@or3/plugin-sdk';
import { makeAssistantPersister, startForegroundGenerationHeartbeat } from '~/utils/chat/useAi-internal/persistence';
import {
    appendMessage,
    upsertMessage,
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

    it('aborts an upsert when the authoritative transaction read fails', async () => {
        const db = testState.db!;
        const original = makeMessage('read-failure', 'thread', 1, { clock: 8 });
        await db.messages.put(original);
        const get = vi.spyOn(db.messages, 'get');
        get.mockImplementationOnce(() => Promise.resolve(original) as never);
        get.mockImplementationOnce(() => Promise.reject(new Error('read unavailable')) as never);
        await expect(upsertMessage({ ...original, clock: 0 })).rejects.toThrow('read unavailable');
        get.mockRestore();
        expect((await db.messages.get(original.id))?.clock).toBe(8);
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

    it.each(['projection', 'persistence'] as const)('keeps card subscribers quiet during unrelated text %s updates', async channel => {
        vi.useRealTimers();
        const db = testState.db!;
        const call: ToolCallInfo = { id: 'call', name: 'fixture_card', args: '{"step":1}', status: 'complete', result: '{}' };
        const data = {
            content: 'Before', tool_calls: [call], tool_cards: { call: { v: 1, state: { answer: 'A' }, updated_at: 1 } },
        };
        const row = makeMessage('quiet-card', 'thread', 1, { role: 'assistant', data });
        await db.messages.put(row);
        const message = ref(ensureUiMessage({ id: row.id, role: 'assistant', data }));
        const bridge = createToolCardChatBridge({ threadId: ref('thread'), busy: ref(false), send: async () => pluginOk(undefined) });
        const updates: { args: unknown; state: unknown }[] = [];
        let card!: ToolCardContext;
        const binding = { tool: call.name, ownerPluginId: null, source: { kind: 'page' as const, module: {
            mount(_el: HTMLElement, context: ToolCardContext) {
                card = context;
                return card.onUpdate(next => updates.push({ args: next.args, state: next.state }));
            },
        } } };
        vi.stubGlobal('IntersectionObserver', class {
            constructor(readonly callback: (entries: unknown[]) => void) {}
            observe(target: Element) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]); }
            disconnect() {}
        });
        const wrapper = mount(defineComponent({ setup() {
            provideToolCardChatBridge(bridge);
            return () => h(ToolCardSlot, { message: message.value, call: message.value.toolCalls![0]!, binding });
        } }));
        try {
            await vi.waitFor(() => expect(card?.state).toEqual({ answer: 'A' }));
            // Let the mounted liveQuery's initial read and theme settle.
            await new Promise(resolve => setTimeout(resolve, 100));
            updates.length = 0;
            for (let i = 0; i < 4; i++) {
                if (channel === 'projection') message.value = ensureUiMessage({ id: row.id, role: 'assistant',
                    data: { ...data, content: 'Text ' + i, tool_calls: [{ ...call }] },
                });
                else await patchMessageInDb(db, row.id, { data: { content: 'Text ' + i } });
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            expect(updates).toEqual([]);
            // Real call and persisted-state changes still reach the same card.
            message.value.toolCalls![0]!.args = '{"step":2}';
            await vi.waitFor(() => expect(card.args).toEqual({ step: 2 }));
            await patchMessageDataEntry(db, row.id, 'tool_cards', 'call', { v: 1, state: { answer: 'B' }, updated_at: 2 });
            await vi.waitFor(() => expect(card.state).toEqual({ answer: 'B' }));
            expect(updates).toContainEqual({ args: { step: 2 }, state: { answer: 'B' } });
        } finally { wrapper.unmount(); await bridge.flush(); }
        expect(card.signal.aborted).toBe(true);
    });

    it.each(['mount', 'update'] as const)('stops failed-card work after a renderer fails during %s while healthy cards stay live', async phase => {
        vi.useRealTimers();
        const db = testState.db!;
        const rows = ['failed', 'healthy'].map(id => makeMessage(id, 'thread', 1, {
            role: 'assistant', data: { tool_cards: { call: { v: 1, state: 0, updated_at: 1 } } },
        }));
        await db.messages.bulkPut(rows);
        const bridge = createToolCardChatBridge({ threadId: ref('thread'), busy: ref(false), send: async () => pluginOk(undefined) });
        let failedCard!: ToolCardContext;
        const postAbortUpdates: unknown[] = [];
        let failedCleanup = 0;
        vi.stubGlobal('IntersectionObserver', class {
            constructor(readonly callback: (entries: unknown[]) => void) {}
            observe(target: Element) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]); }
            disconnect() {}
        });
        const reads = vi.spyOn(db.messages, 'get');
        const wrapper = mount(defineComponent({ setup() {
            provideToolCardChatBridge(bridge);
            return () => h('div', rows.map(row => h(ToolCardSlot, {
                message: { id: row.id }, call: { id: 'call', name: row.id + '_card', status: 'complete' },
                binding: { tool: row.id + '_card', ownerPluginId: null, source: { kind: 'page', module: {
                    mount(el, card) {
                        if (row.id === 'failed') {
                            failedCard = card;
                            if (phase === 'mount') throw new Error('Synthetic renderer failure');
                            const stopFailure = card.onUpdate(() => {
                                if (card.state === 1) throw new Error('Synthetic update failure');
                            });
                            const stopLaterWork = card.onUpdate(() => {
                                if (card.signal.aborted) postAbortUpdates.push(card.state);
                            });
                            el.textContent = 'Waiting for persisted update';
                            return () => { failedCleanup++; stopFailure(); stopLaterWork(); };
                        }
                        const render = () => { el.textContent = String(card.state); };
                        render();
                        return card.onUpdate(render);
                    },
                } } },
            })));
        } }));
        try {
            if (phase === 'update') {
                await vi.waitFor(() => expect(wrapper.text()).toContain('Waiting for persisted update'));
                await db.messages.update('failed', { data: { tool_cards: { call: { v: 1, state: 1, updated_at: 2 } } } });
            }
            await vi.waitFor(() => expect(wrapper.text()).toContain('card unavailable (mount-error)'));
            await vi.waitFor(() => expect(wrapper.get('[data-tool-card="healthy_card"]').text()).toBe('0'));
            await new Promise(resolve => setTimeout(resolve, 100));
            reads.mockClear();
            for (let state = 1; state <= 4; state++) {
                await db.messages.bulkPut(rows.map(row => ({ ...row, data: { tool_cards: { call: { v: 1, state, updated_at: state } } } })));
                await vi.waitFor(() => expect(wrapper.get('[data-tool-card="healthy_card"]').text()).toBe(String(state)));
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(failedCard.signal.aborted).toBe(true);
            expect(postAbortUpdates, 'aborting a card must stop the rest of its notification batch').toEqual([]);
            expect(failedCleanup).toBe(phase === 'update' ? 1 : 0);
            const readKeys: unknown[] = reads.mock.calls.map(([id]) => id);
            expect(readKeys.filter(id => id === 'failed')).toHaveLength(0);
            expect(readKeys).toContain('healthy');
        } finally { wrapper.unmount(); reads.mockRestore(); await bridge.flush(); }
    });

    it.each(['other workspace', 'returned workspace'] as const)('retires a mounted card before unmount after switching to %s', async destination => {
        vi.useRealTimers();
        const initialDb = testState.db!;
        const workspace = `card-lifecycle-${databaseSequence++}`;
        const origin = setActiveWorkspaceDb(workspace);
        testState.db = origin;
        await origin.open();
        const row = makeMessage('shared-card', 'thread', 1, { role: 'assistant', data: {
            tool_cards: { call: { v: 1, state: 'origin', updated_at: 1 } },
        } });
        await origin.messages.put(row);
        vi.stubGlobal('IntersectionObserver', class {
            constructor(readonly callback: (entries: unknown[]) => void) {}
            observe(target: Element) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]); }
            disconnect() {}
        });
        const bridge = createToolCardChatBridge({ threadId: ref('thread'), busy: ref(false), send: async () => pluginOk(undefined) });
        const call = ref<ToolCallInfo>({ id: 'call', name: 'workspace_card', status: 'complete', args: '{"step":1}' });
        const cards: ToolCardContext[] = [];
        let aborts = 0;
        let cleanups = 0;
        const binding = { tool: call.value.name, ownerPluginId: null, source: { kind: 'page' as const, module: {
            mount(el: HTMLElement, card: ToolCardContext) {
                cards.push(card);
                card.signal.addEventListener('abort', () => { aborts++; }, { once: true });
                const render = () => { el.textContent = String(card.state); };
                render();
                const stop = card.onUpdate(render);
                return () => { cleanups++; stop(); };
            },
        } } };
        const host = defineComponent({ setup() {
            provideToolCardChatBridge(bridge);
            return () => h(ToolCardSlot, { message: { id: row.id }, call: call.value, binding });
        } });
        const old = mount(host);
        let current: ReturnType<typeof mount> | undefined;
        const reads = vi.spyOn(origin.messages, 'get');
        try {
            await vi.waitFor(() => expect(old.text()).toBe('origin'));
            const other = setActiveWorkspaceDb(`${workspace}-other`);
            testState.db = other;
            await other.open();
            if (destination === 'returned workspace') testState.db = setActiveWorkspaceDb(workspace);
            const currentDb = testState.db!;
            await currentDb.messages.put({ ...row, data: { tool_cards: { call: { v: 1, state: 'current', updated_at: 2 } } } });
            // Keep the old host alive through the switch, as a delayed Vue teardown
            // or same-message projection can. The workspace signal must retire it.
            current = mount(host);
            await vi.waitFor(() => expect(current!.text()).toBe('current'));
            reads.mockClear();
            for (let value = 1; value <= 3; value++) {
                await origin.messages.put({ ...row, data: { tool_cards: { call: { v: 1, state: value, updated_at: value + 2 } } } });
                if (currentDb !== origin) await currentDb.messages.put({ ...row, data: { tool_cards: { call: { v: 1, state: value, updated_at: value + 2 } } } });
                await vi.waitFor(() => expect(current!.text()).toBe(String(value)));
            }
            call.value = { ...call.value, args: '{"step":2}' };
            await vi.waitFor(() => expect(cards[1]!.args).toEqual({ step: 2 }));
            expect.soft(cards[0]!.signal.aborted, 'the departing card must abort before Vue unmount').toBe(true);
            expect.soft(aborts).toBe(1);
            expect.soft(cards[0]!.args, 'retired cards must stop parsing later call snapshots').toEqual({ step: 1 });
            expect.soft(old.text(), 'the retired host must not receive later database values').toBe('origin');
            expect.soft(reads.mock.calls.length, 'only the current host may read the returning workspace').toBe(destination === 'returned workspace' ? 3 : 0);
            expect((await cards[0]!.setState('stale')).ok).toBe(false);
            expect(cards[1]!.signal.aborted).toBe(false);
            expect(cleanups).toBe(0);
        } finally {
            old.unmount();
            current?.unmount();
            reads.mockRestore();
            await bridge.flush();
            setActiveWorkspaceDb(null);
            for (const id of [workspace, `${workspace}-other`]) {
                evictWorkspaceDb(id);
                await Dexie.delete(`or3-db-${id}`);
            }
            testState.db = initialDb;
        }
        expect(aborts).toBe(2);
        expect(cleanups).toBe(2);
    });

    it('ignores a stale near-viewport observation until the card returns to the preload range', async () => {
        vi.useRealTimers();
        let cardTop = 2000;
        let observeNear!: IntersectionObserverCallback;
        vi.stubGlobal('IntersectionObserver', class {
            constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
                if (options.rootMargin) observeNear = callback;
            }
            observe() {}
            disconnect() {}
        });
        const bounds = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} });
        const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return this.classList.contains('chat-message-list') ? bounds(0, 600) : bounds(cardTop, 64);
        });
        const call: ToolCallInfo = { id: 'call', name: 'fixture_card', status: 'complete' };
        const wrapper = mount(defineComponent({ setup: () => () => h('div', { class: 'chat-message-list' }, [
            h(ToolCardSlot, { message: { id: 'near-card' }, call,
                binding: { tool: call.name, ownerPluginId: null, source: { kind: 'page', module: {
                    mount(el) { el.textContent = 'Card loaded'; },
                } } },
            }),
        ]) }));
        try {
            // The entry describes the old position; layout or scrolling has
            // moved the target beyond the 600px preload distance meanwhile.
            observeNear([{ isIntersecting: true, boundingClientRect: bounds(100, 64) } as IntersectionObserverEntry], {} as IntersectionObserver);
            await new Promise(resolve => setTimeout(resolve, 30));
            expect(wrapper.text()).not.toContain('Card loaded');
            cardTop = 100;
            observeNear([{ isIntersecting: true, boundingClientRect: bounds(100, 64) } as IntersectionObserverEntry], {} as IntersectionObserver);
            await vi.waitFor(() => expect(wrapper.text()).toContain('Card loaded'));
        } finally { wrapper.unmount(); geometry.mockRestore(); }
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
