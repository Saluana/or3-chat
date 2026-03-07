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

function createErroredStream(error: Error) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.error(error);
        },
    });
}

describe('foreground stream monitor', () => {
    it('emits message.completed when the foreground stream finishes naturally', async () => {
        emitMessageCompletedWebhookEventMock.mockReset().mockResolvedValue(undefined);

        const { mirrorForegroundStreamCompletion } = await import(
            '../foreground-stream-monitor'
        );

        await mirrorForegroundStreamCompletion({
            stream: createStream(),
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            modelId: 'openai/gpt-4o-mini',
        });

        expect(emitMessageCompletedWebhookEventMock).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            modelId: 'openai/gpt-4o-mini',
        });
    });

    it('ignores aborted stream monitors without surfacing an error', async () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';

        emitMessageCompletedWebhookEventMock.mockReset();
        const onError = vi.fn();

        const { mirrorForegroundStreamCompletion } = await import(
            '../foreground-stream-monitor'
        );

        await mirrorForegroundStreamCompletion({
            stream: createErroredStream(abortError),
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            modelId: 'openai/gpt-4o-mini',
            onError,
        });

        expect(emitMessageCompletedWebhookEventMock).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });
});
