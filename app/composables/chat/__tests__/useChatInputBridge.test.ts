import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    hasPane,
    programmaticPrefill,
    programmaticSend,
    registerPaneInput,
    unregisterPaneInput,
} from '../useChatInputBridge';

describe('useChatInputBridge', () => {
    afterEach(() => unregisterPaneInput('pane-1'));

    it('awaits and returns the real durable send result', async () => {
        const setText = vi.fn();
        let resolveSend!: (value: {
            status: 'complete';
            requestId: string;
            userMessageId: string;
            assistantMessageId: string;
        }) => void;
        const resultPromise = new Promise<{
            status: 'complete';
            requestId: string;
            userMessageId: string;
            assistantMessageId: string;
        }>((resolve) => {
            resolveSend = resolve;
        });
        registerPaneInput('pane-1', {
            setText,
            focus: vi.fn(),
            triggerSend: () => resultPromise,
        });

        const pending = programmaticSend('pane-1', 'hello');
        expect(setText).toHaveBeenCalledWith('hello');
        resolveSend({
            status: 'complete',
            requestId: 'r1',
            userMessageId: 'u1',
            assistantMessageId: 'a1',
        });

        await expect(pending).resolves.toMatchObject({
            status: 'complete',
            userMessageId: 'u1',
        });
    });

    it('returns exact loading/auth/filter/limit rejections', async () => {
        for (const reason of [
            'busy',
            'missing_credentials',
            'filtered',
            'client_limit',
        ] as const) {
            registerPaneInput('pane-1', {
                setText: vi.fn(),
                focus: vi.fn(),
                triggerSend: async () => ({ status: 'rejected', reason }),
            });
            await expect(programmaticSend('pane-1', 'hello')).resolves.toEqual({
                status: 'rejected',
                reason,
            });
        }
    });

    it('returns unavailable when no pane input is registered', async () => {
        unregisterPaneInput('pane-1');
        expect(hasPane('pane-1')).toBe(false);
        await expect(programmaticSend('pane-1', 'hello')).resolves.toEqual({
            status: 'rejected',
            reason: 'unavailable',
        });
    });

    it('prefills and focuses the composer without sending', () => {
        const setText = vi.fn();
        const focus = vi.fn();
        const triggerSend = vi.fn();
        registerPaneInput('pane-1', { setText, focus, triggerSend });

        expect(programmaticPrefill('pane-1', '/"Fact checker" ')).toEqual({
            status: 'ready',
        });
        expect(setText).toHaveBeenCalledWith('/"Fact checker" ');
        expect(focus).toHaveBeenCalledOnce();
        expect(triggerSend).not.toHaveBeenCalled();
    });
});
