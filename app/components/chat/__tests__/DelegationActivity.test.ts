import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { ThreadSchema, MessageSchema } from '~/db/schema';
import { setKvByName } from '~/db/kv';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';
import DelegationActivity from '../DelegationActivity.vue';

const openChat = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const navigation = vi.hoisted(() => ({ mobile: false, openResource: vi.fn(async () => ({ status: 'activated' })) }));
vi.mock('~/composables/search/useCommandPalette', () => ({ getPaletteHostContext: () => ({ openChat }) }));
vi.mock('~/composables/core/useResponsiveState', async () => {
    const { computed } = await import('vue');
    return { useResponsiveState: () => ({ isMobile: computed(() => navigation.mobile) }) };
});
vi.mock('~/utils/workspaceResourceNavigation', () => ({ getWorkspaceResourceNavigationApi: () => navigation }));
const workspace = `delegation-activity-${crypto.randomUUID()}`;
let previousAuth: boolean;
beforeEach(() => {
    previousAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    openChat.mockClear();
    navigation.mobile = false;
    navigation.openResource.mockClear();
});

it('opens a delegated chat in a workspace tab on mobile', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut(['origin', 'child'].map(id => ThreadSchema.parse({ id, created_at: 1, updated_at: 1, clock: 1 })));
    await db.messages.put(MessageSchema.parse({ id: 'message', thread_id: 'origin', role: 'assistant', index: 1,
        data: { content: '' }, created_at: 1, updated_at: 1, clock: 1 }));
    await setKvByName('chat-delegation:message:call', JSON.stringify({ threadId: 'child', model: 'test/sol',
        modelName: 'GPT 6.1 Sol', startedAt: Date.now() }), db);
    navigation.mobile = true;
    const wrapper = mount(DelegationActivity, { props: { call: { id: 'call', name: 'delegate_chat', status: 'loading' }, messageId: 'message' } });
    try {
        await vi.waitFor(() => expect(wrapper.find('button').exists()).toBe(true));
        expect(wrapper.text()).toContain('GPT 6.1 Sol working');
        expect(wrapper.get('button').attributes('aria-label')).toContain('new tab');
        await wrapper.get('button').trigger('click');
        await vi.waitFor(() => expect(navigation.openResource).toHaveBeenCalledWith({ kind: 'chat', threadId: 'child' }, 'new-tab', { reuseExisting: true }));
        expect(openChat).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
});

it('shows each batch child and opens its own mobile workspace tab', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut(['origin', 'first', 'second'].map(id => ThreadSchema.parse({ id, created_at: 1, updated_at: 1, clock: 1 })));
    await db.messages.put(MessageSchema.parse({ id: 'message', thread_id: 'origin', role: 'assistant', index: 1,
        data: { content: '' }, created_at: 1, updated_at: 1, clock: 1 }));
    for (const [index, threadId] of ['first', 'second'].entries()) await setKvByName(`chat-delegation:message:call:batch:${index}`,
        JSON.stringify({ threadId, model: `test/${index}`, modelName: `Model ${index}`, startedAt: 1 }), db);
    navigation.mobile = true;
    const call = { id: 'call', name: 'delegate_chat', status: 'complete' as const,
        args: JSON.stringify({ tasks: [{ task: 'First' }, { task: 'Second' }] }),
        result: JSON.stringify({ results: [{ index: 0, status: 'complete' }, { index: 1, error: 'Failed to run' }] }) };
    const wrapper = mount(DelegationActivity, { props: { call, messageId: 'message' } });
    try {
        await vi.waitFor(() => expect(wrapper.findAll('button')).toHaveLength(2));
        expect(wrapper.text()).toContain('Model 0 completed');
        expect(wrapper.text()).toContain('Model 1 could not finish');
        await wrapper.findAll('button')[0]!.trigger('click');
        await vi.waitFor(() => expect(navigation.openResource).toHaveBeenCalledTimes(1));
        await wrapper.findAll('button')[1]!.trigger('click');
        await vi.waitFor(() => expect(navigation.openResource).toHaveBeenCalledTimes(2));
        expect(navigation.openResource).toHaveBeenNthCalledWith(1, { kind: 'chat', threadId: 'first' }, 'new-tab', { reuseExisting: true });
        expect(navigation.openResource).toHaveBeenNthCalledWith(2, { kind: 'chat', threadId: 'second' }, 'new-tab', { reuseExisting: true });
    } finally { wrapper.unmount(); }
});

it('shows waiting, working and saving children before the batch settles', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut(['origin', 'first'].map(id => ThreadSchema.parse({ id, created_at: 1, updated_at: 1, clock: 1 })));
    await db.messages.put(MessageSchema.parse({ id: 'message', thread_id: 'origin', role: 'assistant', index: 1,
        data: { content: '' }, created_at: 1, updated_at: 1, clock: 1 }));
    const call = { id: 'call', name: 'delegate_chat', status: 'pending' as const,
        delegation: { version: 3 as const, callId: 'call', children: [
            { index: 0, threadId: 'first', modelName: 'Terra', outcome: 'working' as const },
            { index: 1, modelName: 'Sol', outcome: 'waiting' as const },
            { index: 2, modelName: 'Luna', outcome: 'saving' as const },
        ] } };
    const wrapper = mount(DelegationActivity, { props: { call, messageId: 'message' } });
    try {
        await vi.waitFor(() => expect(wrapper.findAll('button')).toHaveLength(1));
        expect(wrapper.text()).toContain('Terra working');
        expect(wrapper.text()).toContain('Sol waiting');
        expect(wrapper.text()).toContain('Luna saving');
    } finally { wrapper.unmount(); }
});

it.each([['stopped', 'stopped'], ['failed', 'could not finish']] as const)(
    'uses canonical batch outcomes including %s when local receipts are absent', async (outcome, label) => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut(['origin', 'first', 'second', 'third'].map(id => ThreadSchema.parse({ id, created_at: 1, updated_at: 1, clock: 1 })));
    await db.messages.put(MessageSchema.parse({ id: 'message', thread_id: 'origin', role: 'assistant', index: 1,
        data: { content: '' }, created_at: 1, updated_at: 1, clock: 1 }));
    navigation.mobile = true;
    const call = { id: 'call', name: 'delegate_chat', status: 'complete' as const,
        delegation: { version: 1 as const, callId: 'call', children: [
            { index: 0, threadId: 'first', modelName: 'Terra', outcome: 'complete' as const },
            { index: 1, threadId: 'second', modelName: 'Sol', outcome: 'unknown' as const },
            { index: 2, modelName: 'Luna', outcome: 'unavailable' as const, executionUncertain: true as const },
            { index: 3, threadId: 'third', modelName: 'Nova', outcome },
        ] } };
    const wrapper = mount(DelegationActivity, { props: { call, messageId: 'message' } });
    try {
        await vi.waitFor(() => expect(wrapper.findAll('button')).toHaveLength(3));
        expect(wrapper.text()).toContain('Terra completed');
        expect(wrapper.text()).toContain('Sol outcome unknown');
        expect(wrapper.text()).toContain('Luna result unavailable; outcome unknown');
        expect(wrapper.text()).toContain(`Nova ${label}`);
        await wrapper.findAll('button')[1]!.trigger('click');
        await vi.waitFor(() => expect(navigation.openResource).toHaveBeenCalledWith({ kind: 'chat', threadId: 'second' }, 'new-tab', { reuseExisting: true }));
    } finally { wrapper.unmount(); }
});

it('clears child activity when the active workspace changes', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.put(ThreadSchema.parse({ id: 'child', created_at: 1, updated_at: 1, clock: 1 }));
    await setKvByName('chat-delegation:message:call', JSON.stringify({ threadId: 'child', model: 'test/sol',
        modelName: 'Private model', startedAt: Date.now() }), db);
    const wrapper = mount(DelegationActivity, { props: { call: { id: 'call', name: 'delegate_chat', status: 'loading' }, messageId: 'message' } });
    try {
        await vi.waitFor(() => expect(wrapper.text()).toContain('Private model'));
        setActiveWorkspaceDb(null);
        await vi.waitFor(() => expect(wrapper.text()).not.toContain('Private model'));
        expect(wrapper.find('button').exists()).toBe(false);
    } finally { wrapper.unmount(); }
});
afterEach(async () => {
    vi.useRealTimers(); setHookEngine(null); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace);
    await Dexie.delete(`or3-db-${workspace}`);
    testRuntimeConfig.value.public.ssrAuthEnabled = previousAuth;
});

it('shows compact elapsed time, opens a pane, and freezes the completed duration', async () => {
    const db = setActiveWorkspaceDb(workspace); await db.open();
    await db.threads.bulkPut(['origin', 'child'].map(id => ThreadSchema.parse({ id, created_at: 1, updated_at: 1, clock: 1 })));
    await db.messages.put(MessageSchema.parse({ id: 'message', thread_id: 'origin', role: 'assistant', index: 1,
        data: { content: '' }, created_at: 1, updated_at: 1, clock: 1 }));
    const startedAt = Date.now();
    await setKvByName('chat-delegation:message:call', JSON.stringify({ threadId: 'child', model: 'test/sol',
        modelName: 'GPT 6.1 Sol', startedAt }), db);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(startedAt + 38_000);
    const call = { id: 'call', name: 'delegate_chat', status: 'loading' as const };
    const wrapper = mount(DelegationActivity, { props: { call, messageId: 'message' } });
    try {
        await vi.waitFor(() => expect(wrapper.text()).toContain('GPT 6.1 Sol working for 38s'));
        const button = wrapper.get('button');
        expect(button.attributes('aria-label')).toContain('new pane');
        await button.trigger('click');
        await vi.waitFor(() => expect(openChat).toHaveBeenCalledWith('child', 'new-pane'));
        await wrapper.setProps({ call: { ...call, status: 'complete', completedAt: startedAt + 90 * 60_000 } });
        expect(wrapper.text()).toContain('GPT 6.1 Sol worked for 1h30m');
        vi.setSystemTime(startedAt + 100 * 60_000);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(wrapper.text()).toContain('GPT 6.1 Sol worked for 1h30m');
    } finally { wrapper.unmount(); }
});
