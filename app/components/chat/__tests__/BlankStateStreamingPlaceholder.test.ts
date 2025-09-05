import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import ChatContainer from '../ChatContainer.vue';
import { shallowMount } from '@vue/test-utils';

// Minimal stub composables & globals if needed can be auto-mocked by existing test setup.

describe('ChatContainer blank state', () => {
    it('does not render streaming placeholder when no messages and no stream content', async () => {
        const wrapper = shallowMount(ChatContainer, {
            props: { messageHistory: [], threadId: undefined },
            global: {
                stubs: [
                    'VirtualMessageList',
                    'ChatMessage',
                    'chat-input-dropper',
                ],
            },
        });
        await nextTick();
        // Tail placeholder uses data-stream-id attribute when present; simpler: search for tail-* id usage
        const tail = wrapper.find('[data-stream-id^="tail-"]');
        // streamingMessage div itself not rendered -> no ChatMessage with pending assistant
        expect(tail.exists()).toBe(false);
    });

    it('does not render streaming placeholder when messages exist but no active stream', async () => {
        const wrapper = shallowMount(ChatContainer, {
            props: {
                messageHistory: [{ id: 'u1', role: 'user', content: 'Hello' }],
                threadId: 't1',
            },
            global: {
                stubs: [
                    'VirtualMessageList',
                    'ChatMessage',
                    'chat-input-dropper',
                ],
            },
        });
        await nextTick();
        expect(wrapper.find('[data-stream-id^="tail-"]').exists()).toBe(false);
    });
});
