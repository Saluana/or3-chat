import { describe, it, expect } from 'vitest';
import { useChatSend } from '../useChatSend';

describe('useChatSend', () => {
    it('rejects empty', async () => {
        const chat = useChatSend();
        await expect(chat.send({ threadId: 't1', text: '' })).rejects.toThrow(
            'Empty message'
        );
    });
    it('sends basic message', async () => {
        const chat = useChatSend();
        const res = await chat.send({ threadId: 't1', text: 'Hello' });
        expect(res.id).toBeTruthy();
        expect(typeof res.createdAt).toBe('number');
    });
});
