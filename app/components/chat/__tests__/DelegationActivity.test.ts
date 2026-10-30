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
vi.mock('~/composables/search/useCommandPalette', () => ({ getPaletteHostContext: () => ({ openChat }) }));
const workspace = `delegation-activity-${crypto.randomUUID()}`;
let previousAuth: boolean;
beforeEach(() => {
    previousAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    openChat.mockClear();
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
