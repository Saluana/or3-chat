import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    hasPane,
    programmaticPrefill,
    programmaticInsertReference,
    programmaticAttachFile,
    waitForPaneInput,
    programmaticSend,
    registerPaneInput,
    unregisterPaneInput,
} from '../useChatInputBridge';

describe('useChatInputBridge', () => {
    it('waits for the native composer after tab activation and stops on cancellation', async () => {
        unregisterPaneInput('pane-1');
        const pending = waitForPaneInput('pane-1', new AbortController().signal);
        registerPaneInput('pane-1', { setText: vi.fn(), focus: vi.fn(), triggerSend: vi.fn() });
        await expect(pending).resolves.toBe(true);
        unregisterPaneInput('pane-1');
        const abort = new AbortController();
        const cancelled = waitForPaneInput('pane-1', abort.signal);
        abort.abort();
        await expect(cancelled).resolves.toBe(false);
    });
    it('hands a saved image or PDF to the native attachment pipeline without replacing or sending the draft', async () => {
        const setText = vi.fn();
        const triggerSend = vi.fn();
        const attachFile = vi.fn(async () => true);
        registerPaneInput('pane-1', { setText, triggerSend, focus: vi.fn(), attachFile });
        const file = new File(['%PDF'], 'saved.pdf', { type: 'application/pdf' });
        await expect(programmaticAttachFile('pane-1', file)).resolves.toEqual({ status: 'ready' });
        expect(attachFile).toHaveBeenCalledWith(file);
        expect(setText).not.toHaveBeenCalled();
        expect(triggerSend).not.toHaveBeenCalled();
    });
    it('inserts a reference through the composer without replacing its draft or sending', () => {
        const setText = vi.fn();
        const triggerSend = vi.fn();
        const insertReference = vi.fn(() => true);
        registerPaneInput('pane-1', { setText, triggerSend, focus: vi.fn(), insertReference });
        const reference = { id: 'catalog-id', source: 'file' as const, label: 'Saved file' };
        expect(programmaticInsertReference('pane-1', reference)).toEqual({ status: 'ready' });
        expect(insertReference).toHaveBeenCalledWith(reference);
        expect(setText).not.toHaveBeenCalled();
        expect(triggerSend).not.toHaveBeenCalled();
    });
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
