import { expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { getActiveWorkspaceId, getWorkspaceGeneration } from '~/db/client';
import { delegatedChatJobs, finishDelegatedChat, queueDelegatedChat } from '~/utils/chat/delegated-chat-runtime';
import DelegatedChatRunner from '../DelegatedChatRunner.vue';

const chat = vi.hoisted(() => ({
    abort: vi.fn(),
    ensureHistorySynced: vi.fn(),
    sendMessage: vi.fn(),
}));
vi.mock('~/composables/chat/useAi', () => ({ useChat: () => chat }));

it('interrupts the waiting parent when its child runner is unmounted', async () => {
    let finishSync!: () => void;
    chat.abort.mockReset();
    chat.sendMessage.mockReset();
    chat.ensureHistorySynced.mockReturnValue(new Promise<void>(resolve => { finishSync = resolve; }));
    const completion = queueDelegatedChat({
        threadId: 'unmounted-child', workspaceId: getActiveWorkspaceId() ?? 'local',
        workspaceGeneration: getWorkspaceGeneration(), assertOrigin: () => {},
        content: 'A task', model: 'test/model', thinking: false, signal: new AbortController().signal,
    }).then(() => 'completed', error => (error as Error).message);
    const job = delegatedChatJobs().find(item => item.threadId === 'unmounted-child')!;
    const wrapper = mount(DelegatedChatRunner, { props: { job } });
    try {
        expect(chat.ensureHistorySynced).toHaveBeenCalled();
        wrapper.unmount();
        await flushPromises();
        expect(chat.abort).toHaveBeenCalledOnce();
        expect(await Promise.race([completion, Promise.resolve('still running')])).toMatch(/interrupted/i);
        finishSync();
        await flushPromises();
        expect(chat.sendMessage).not.toHaveBeenCalled();
    } finally {
        if (!wrapper.vm.$.isUnmounted) wrapper.unmount();
        finishDelegatedChat(job, undefined, new Error('Test cleanup'));
        finishSync();
        await completion;
    }
});
