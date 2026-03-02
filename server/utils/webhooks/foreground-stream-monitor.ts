import { emitMessageCompletedWebhookEvent } from './hook-emissions';

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
        while (true) {
            const { done } = await reader.read();
            if (done) {
                return;
            }
        }
    } finally {
        reader.releaseLock();
    }
}

export async function mirrorForegroundStreamCompletion(params: {
    stream: ReadableStream<Uint8Array>;
    threadId: string | null;
    messageId: string | null;
    modelId: string | null;
    onError?: (error: unknown) => void;
}): Promise<void> {
    if (!params.threadId || !params.messageId) {
        return;
    }

    try {
        await drainStream(params.stream);

        await emitMessageCompletedWebhookEvent({
            threadId: params.threadId,
            messageId: params.messageId,
            modelId: params.modelId,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return;
        }

        params.onError?.(error);
    }
}
