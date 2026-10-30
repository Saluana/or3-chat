import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { ThreadSchema, MessageSchema } from '~/db/schema';
import { registerThreadChatTools } from '../thread-chat-tools';
import { useToolRegistry } from '../tool-registry';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';
import { useModelStore } from '~/composables/chat/useModelStore';
import { useChatModelSelection } from '~/composables/chat/useChatModelSelection';
import { getKvByName, setKvByName } from '~/db/kv';
import { assertDelegatedChatCurrent, attachDelegatedChat, delegatedChatController, delegatedChatJobs, finishDelegatedChat } from '../delegated-chat-runtime';
import type { ToolExecutionContext } from '../types';

const auth = vi.hoisted(() => ({ session: null as null | { authenticated: boolean; user: { id: string };
    workspace: { id: string }; role: 'editor'; authorizationRevision: number } }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => auth.session,
    getCachedSessionPayload: () => ({ session: auth.session, appAccessAllowed: true }),
}));

const workspace = `thread-read-${crypto.randomUUID()}`;
let dispose: (() => void) | undefined;
let previousAuth: boolean;
let previousModels: ReturnType<typeof useModelStore>['catalog']['value'];
let previousFavorites: ReturnType<typeof useModelStore>['favoriteModels']['value'];
beforeEach(() => {
    previousAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    previousModels = useModelStore().catalog.value;
    previousFavorites = useModelStore().favoriteModels.value;
    useModelStore().favoriteModels.value = [];
    useModelStore().catalog.value = [
        { id: 'test/sol', name: 'Vendor: GPT 6.1 Sol', supported_parameters: ['tools', 'reasoning'] },
        { id: 'test/fast-a', name: 'First: Fast', supported_parameters: ['tools'] },
        { id: 'test/fast-b', name: 'Second: Fast', supported_parameters: ['tools'] },
    ];
});
afterEach(async () => {
    dispose?.(); setHookEngine(null); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace);
    await Dexie.delete(`or3-db-${workspace}`);
    testRuntimeConfig.value.public.ssrAuthEnabled = previousAuth;
    useModelStore().catalog.value = previousModels;
    useModelStore().favoriteModels.value = previousFavorites;
    auth.session = null;
});

it('read_thread returns inherited reference history and the surviving retry turn in canonical order', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut([
        ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'current' }), ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'parent' }),
        ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'child', parent_thread_id: 'parent', branch_mode: 'reference', anchor_message_id: 'anchor', anchor_index: 1 }),
    ]);
    await db.messages.bulkPut([
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'anchor', thread_id: 'parent', role: 'user', index: 1, data: { content: 'Inherited question' } }),
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'after-anchor', thread_id: 'parent', role: 'assistant', index: 2, data: { content: 'Outside branch' } }),
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'obsolete', thread_id: 'child', role: 'assistant', index: 1, data: { content: 'Obsolete reply', superseded_by: 'replacement', generation_state: 'superseded' } }),
        MessageSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'replacement', thread_id: 'child', role: 'assistant', index: 2, data: { content: 'Current reply' } }),
    ]);
    dispose = registerThreadChatTools();
    const response = await useToolRegistry().executeTool('read_thread', JSON.stringify({ threadId: 'child' }), {
        subject: null, workspaceId: workspace, threadId: 'current', messageId: 'assistant', callId: 'read', requestId: 'request',
        abortSignal: new AbortController().signal,
    });
    expect(response.error).toBeUndefined();
    expect(JSON.parse(response.result!).messages).toEqual([
        { role: 'user', content: 'Inherited question' }, { role: 'assistant', content: 'Current reply' },
    ]);
});

async function delegationOrigin() {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.put(ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'origin' }));
    dispose = registerThreadChatTools();
    const controller = new AbortController();
    const context: ToolExecutionContext = { subject: null, workspaceId: workspace, threadId: 'origin',
        messageId: 'parent-message', callId: 'call', requestId: 'parent-request', abortSignal: controller.signal,
        parentModel: { model: 'test/sol', thinking: true, reasoningEffort: 'high' } };
    return { db, controller, context };
}

it('creates one child, honors the chosen model, returns its saved answer, and refuses replay', async () => {
    const { db, context } = await delegationOrigin();
    const registry = useToolRegistry();
    const args = { task: 'Review this', model: 'GPT 6.1 Sol', reasoningEffort: 'medium' };
    const execution = registry.executeTool('delegate_chat', JSON.stringify(args), context);
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const job = delegatedChatJobs()[0]!;
    expect(job).toMatchObject({ model: 'test/sol', thinking: true, reasoningEffort: 'medium', content: 'Review this' });
    expect(await db.threads.get(job.threadId)).toMatchObject({ id: job.threadId });
    expect(JSON.parse((await getKvByName(`chat-model:${job.threadId}`, db))!.value!)).toMatchObject({ model: 'test/sol' });
    await db.messages.put(MessageSchema.parse({ id: 'reply', thread_id: job.threadId, role: 'assistant', index: 1,
        data: { content: 'Review complete.' }, created_at: 1, updated_at: 1, clock: 1 }));
    finishDelegatedChat(job, { status: 'complete', requestId: 'child', userMessageId: 'question', assistantMessageId: 'reply' });
    const output = await execution;
    expect(output.error).toBeUndefined();
    expect(JSON.parse(output.result!)).toMatchObject({ threadId: job.threadId, model: 'test/sol',
        reasoningEffort: 'medium', content: 'Review complete.', status: 'complete' });
    const duplicate = await registry.executeTool('delegate_chat', JSON.stringify(args), context);
    expect(duplicate.error).toContain('already started');
    expect(delegatedChatJobs()).toHaveLength(0);
});

it('continues an existing chat and inherits the originating model and reasoning', async () => {
    const { db, context } = await delegationOrigin();
    await db.threads.put(ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'target' }));
    const execution = useToolRegistry().executeTool('delegate_chat', JSON.stringify({ task: 'Follow up', threadId: 'target' }), context);
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const job = delegatedChatJobs()[0]!;
    expect(job).toMatchObject({ threadId: 'target', model: 'test/sol', thinking: true, reasoningEffort: 'high' });
    await db.messages.put(MessageSchema.parse({ id: 'follow-up', thread_id: 'target', role: 'assistant', index: 1,
        data: { content: 'Done.' }, created_at: 1, updated_at: 1, clock: 1 }));
    finishDelegatedChat(job, { status: 'complete', requestId: 'child', userMessageId: 'question', assistantMessageId: 'follow-up' });
    expect((await execution).error).toBeUndefined();
});

it('updates the model selection in an already-open child pane when delegating a follow-up', async () => {
    const { db, context } = await delegationOrigin();
    await db.threads.put(ThreadSchema.parse({ created_at: 1, updated_at: 1, clock: 1, id: 'target' }));
    await setKvByName('chat-model:target', JSON.stringify({ model: 'test/fast-a', variant: 'off' }), db);
    await setKvByName('chat-model:origin', JSON.stringify({ model: 'test/fast-b', variant: 'off' }), db);
    const client = process as unknown as { client?: boolean };
    const previousClient = client.client;
    client.client = true;
    let selection!: ReturnType<typeof useChatModelSelection>;
    let originSelection!: ReturnType<typeof useChatModelSelection>;
    const wrapper = mount(defineComponent({ setup() {
        selection = useChatModelSelection({ threadId: () => 'target', onChange: () => {}, shouldFetchCatalog: () => false });
        originSelection = useChatModelSelection({ threadId: () => 'origin', onChange: () => {}, shouldFetchCatalog: () => false });
        return () => h('div');
    } }));
    let execution: ReturnType<ReturnType<typeof useToolRegistry>['executeTool']> | undefined;
    try {
        await vi.waitFor(() => expect(selection.selectedModel.value).toBe('test/fast-a'));
        await vi.waitFor(() => expect(originSelection.selectedModel.value).toBe('test/fast-b'));
        const previousGlobalModel = localStorage.getItem('last_selected_model');
        execution = useToolRegistry().executeTool('delegate_chat', JSON.stringify({ task: 'Follow up', threadId: 'target', model: 'test/sol:nitro' }), context);
        await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
        await vi.waitFor(() => expect(selection.selectedModel.value).toBe('test/sol'));
        expect(selection.modelVariant.value).toBe('nitro');
        expect(originSelection.selectedModel.value).toBe('test/fast-b');
        expect(localStorage.getItem('last_selected_model')).toBe(previousGlobalModel);
    } finally {
        const job = delegatedChatJobs().find(item => item.threadId === 'target');
        if (job) finishDelegatedChat(job, { status: 'failed', requestId: 'child', reason: 'unavailable', error: 'Stopped' });
        await execution;
        wrapper.unmount();
        if (previousClient === undefined) delete client.client;
        else client.client = previousClient;
    }
});

it('keeps a requested routing variant and uses the chosen model’s reasoning default', async () => {
    const { db, context } = await delegationOrigin();
    useModelStore().catalog.value[0]!.reasoning = { default_enabled: false };
    useModelStore().favoriteModels.value = [{ id: 'test/sol', name: 'Old favorite', reasoning: { default_enabled: true } }];
    const execution = useToolRegistry().executeTool('delegate_chat', JSON.stringify({ task: 'Work', model: 'test/sol:nitro' }), context);
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const job = delegatedChatJobs()[0]!;
    expect(job).toMatchObject({ model: 'test/sol:nitro', thinking: false });
    expect(JSON.parse((await getKvByName(`chat-model:${job.threadId}`, db))!.value!)).toMatchObject({ model: 'test/sol', variant: 'nitro' });
    finishDelegatedChat(job, { status: 'failed', requestId: 'child', reason: 'unavailable', error: 'Stopped' });
    expect((await execution).error).toContain('Stopped');
});

it('refuses a create hook that changes the authorized chat identity', async () => {
    const { db, context } = await delegationOrigin();
    useHooks().addAction('db.threads.create:action:before', ({ entity }) => { entity.id = 'different-chat'; });
    const output = await useToolRegistry().executeTool('delegate_chat', JSON.stringify({ task: 'Work', model: 'test/sol' }), context);
    expect(output.error).toContain('changed during preparation');
    expect(await db.threads.count()).toBe(1);
    expect(delegatedChatJobs()).toHaveLength(0);
});

it('creates within the originating project and refuses an outside or busy target', async () => {
    const { db, context } = await delegationOrigin();
    await db.projects.bulkPut(['project', 'other'].map(id => ({ id, name: id, data: [], created_at: 1, updated_at: 1, clock: 1, deleted: false })));
    await db.threads.update('origin', { project_id: 'project' });
    await db.threads.bulkPut([
        ThreadSchema.parse({ id: 'outside', project_id: 'other', created_at: 1, updated_at: 1, clock: 1 }),
        ThreadSchema.parse({ id: 'busy', project_id: 'project', created_at: 1, updated_at: 1, clock: 1 }),
    ]);
    await db.messages.put(MessageSchema.parse({ id: 'pending', thread_id: 'busy', role: 'assistant', index: 1, pending: true,
        data: { background_job_id: 'active-job' }, created_at: 1, updated_at: 1, clock: 1 }));
    const registry = useToolRegistry();
    expect((await registry.executeTool('delegate_chat', JSON.stringify({ task: 'Work', model: 'test/sol', threadId: 'outside' }), context)).error)
        .toContain('outside the permitted project');
    expect((await registry.executeTool('delegate_chat', JSON.stringify({ task: 'Work', model: 'test/sol', threadId: 'busy' }), context)).error)
        .toContain('already responding');
    const execution = registry.executeTool('delegate_chat', JSON.stringify({ task: 'Work', model: 'test/sol' }), context);
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const job = delegatedChatJobs()[0]!;
    expect(await db.threads.get(job.threadId)).toMatchObject({ project_id: 'project' });
    expect((await db.projects.get('project'))!.data).toContainEqual(expect.objectContaining({ kind: 'chat', id: job.threadId }));
    finishDelegatedChat(job, { status: 'failed', requestId: 'child', reason: 'unavailable', error: 'Stopped' });
    expect((await execution).error).toContain('Stopped');
});

it.each([
    [{ task: 'Test', model: 'missing' }, 'Model not found'],
    [{ task: 'Test', model: 'Fast' }, 'Model is ambiguous'],
    [{ task: 'Test', model: 'test/fast-a', reasoningEffort: 'high' }, 'does not support'],
] as const)('rejects invalid model choices before creating a chat', async (args, message) => {
    const { db, context } = await delegationOrigin();
    const output = await useToolRegistry().executeTool('delegate_chat', JSON.stringify(args), context);
    expect(output.error).toContain(message);
    expect(await db.threads.count()).toBe(1);
    expect(delegatedChatJobs()).toHaveLength(0);
});

it('stops a child without deleting it or repeating the same execution', async () => {
    const { db, context, controller } = await delegationOrigin();
    const registry = useToolRegistry();
    const args = JSON.stringify({ task: 'Take a while', model: 'test/sol' });
    const execution = registry.executeTool('delegate_chat', args, context);
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const threadId = delegatedChatJobs()[0]!.threadId;
    controller.abort();
    expect((await execution).error).toBeTruthy();
    expect(await db.threads.get(threadId)).toBeDefined();
    expect(delegatedChatJobs()).toHaveLength(0);
    expect((await registry.executeTool('delegate_chat', args, { ...context, abortSignal: new AbortController().signal })).error)
        .toContain('already started');
});

it('does not return a child result to a different workspace', async () => {
    const { db, context } = await delegationOrigin();
    const execution = useToolRegistry().executeTool('delegate_chat', JSON.stringify({ task: 'Work', model: 'test/sol' }), context);
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const job = delegatedChatJobs()[0]!;
    const controller = { abort: vi.fn() } as unknown as Parameters<typeof attachDelegatedChat>[1];
    attachDelegatedChat(job, controller);
    expect(delegatedChatController(job.threadId)).toBe(controller);
    await db.messages.put(MessageSchema.parse({ id: 'reply', thread_id: job.threadId, role: 'assistant', index: 1,
        data: { content: 'Origin only' }, created_at: 1, updated_at: 1, clock: 1 }));
    const other = `${workspace}-other`;
    try {
        const otherDb = setActiveWorkspaceDb(other); await otherDb.open();
        await otherDb.threads.put(ThreadSchema.parse({ id: job.threadId, created_at: 1, updated_at: 1, clock: 1 }));
        expect(controller.abort).toHaveBeenCalled();
        expect(delegatedChatController(job.threadId)).toBeUndefined();
        expect(() => assertDelegatedChatCurrent(job)).toThrow('workspace');
        finishDelegatedChat(job, { status: 'complete', requestId: 'child', userMessageId: 'question', assistantMessageId: 'reply' });
        expect((await execution).error).toContain('workspace');
        expect(await otherDb.messages.count()).toBe(0);
    } finally { setActiveWorkspaceDb(workspace); evictWorkspaceDb(other); await Dexie.delete(`or3-db-${other}`); }
});

it('hides a live child and refuses its result after an account change in the same workspace', async () => {
    const { context } = await delegationOrigin();
    testRuntimeConfig.value.public.ssrAuthEnabled = true;
    auth.session = reactive({ authenticated: true, user: { id: 'user-a' }, workspace: { id: workspace },
        role: 'editor' as const, authorizationRevision: 1 });
    const execution = useToolRegistry().executeTool('delegate_chat', JSON.stringify({ task: 'Private work', model: 'test/sol' }),
        { ...context, subject: 'user-a' });
    await vi.waitFor(() => expect(delegatedChatJobs()).toHaveLength(1));
    const job = delegatedChatJobs()[0]!;
    const controller = { abort: vi.fn() } as unknown as Parameters<typeof attachDelegatedChat>[1];
    attachDelegatedChat(job, controller);
    const visible = computed(() => delegatedChatController(job.threadId));
    expect(visible.value).toBe(controller);
    auth.session.user.id = 'user-b';
    expect(visible.value).toBeUndefined();
    expect(() => assertDelegatedChatCurrent(job)).toThrow('workspace');
    finishDelegatedChat(job, { status: 'failed', requestId: 'child', reason: 'unavailable', error: 'Stopped' });
    expect((await execution).error).toBeTruthy();
});
