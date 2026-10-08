/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

const emitMessageCompletedWebhookEventMock = vi.hoisted(() => vi.fn());

vi.mock('../hook-emissions', () => ({
    emitMessageCompletedWebhookEvent:
        (...args: unknown[]) => emitMessageCompletedWebhookEventMock(...args),
}));

function createStream() {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
        },
    });
}

describe('foreground stream monitor', () => {
    it('emits completion from the client stream without teeing the upstream', async () => {
        emitMessageCompletedWebhookEventMock.mockReset().mockResolvedValue(undefined);
        const { monitorForegroundStreamForClient } = await import(
            '../foreground-stream-monitor'
        );

        const monitored = monitorForegroundStreamForClient({
            stream: createStream(),
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            modelId: 'openai/gpt-4o-mini',
        });
        const reader = monitored.getReader();

        await expect(reader.read()).resolves.toMatchObject({ done: false });
        await expect(reader.read()).resolves.toMatchObject({ done: true });
        await Promise.resolve();

        expect(emitMessageCompletedWebhookEventMock).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            modelId: 'openai/gpt-4o-mini',
        });
    });
});
