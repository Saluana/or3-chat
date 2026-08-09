import { emitMessageCompletedWebhookEvent } from './hook-emissions';

type ForegroundCompletionParams = {
    workspaceId: string | null;
    threadId: string | null;
    messageId: string | null;
    modelId: string | null;
    onError?: (error: unknown) => void;
};

async function emitCompletion(
    params: ForegroundCompletionParams
): Promise<void> {
    if (!params.workspaceId || !params.threadId || !params.messageId) {
        return;
    }

    await emitMessageCompletedWebhookEvent({
        workspaceId: params.workspaceId,
        threadId: params.threadId,
        messageId: params.messageId,
        modelId: params.modelId,
    });
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
    try {
        reader.releaseLock();
    } catch {
        /* the reader was already released */
    }
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
        for (;;) {
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
} & ForegroundCompletionParams): Promise<void> {

    try {
        await drainStream(params.stream);
        await emitCompletion(params);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return;
        }

        params.onError?.(error);
    }
}

/**
 * Return a client stream that emits its completion webhook only after the
 * client-facing stream naturally reaches EOF. Reading occurs from `pull()`,
 * so the upstream honors downstream backpressure instead of `tee()` retaining
 * an unbounded branch for a slow client.
 */
export function monitorForegroundStreamForClient(params: {
    stream: ReadableStream<Uint8Array>;
} & ForegroundCompletionParams): ReadableStream<Uint8Array> {
    const reader = params.stream.getReader();
    let settled = false;

    const notifyCompletion = () => {
        void emitCompletion(params).catch((error) => {
            params.onError?.(error);
        });
    };

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (settled) return;
            try {
                const { done, value } = await reader.read();
                if (done) {
                    settled = true;
                    releaseReader(reader);
                    controller.close();
                    notifyCompletion();
                    return;
                }
                controller.enqueue(value);
            } catch (error) {
                settled = true;
                releaseReader(reader);
                if (!(error instanceof Error && error.name === 'AbortError')) {
                    params.onError?.(error);
                }
                controller.error(error);
            }
        },
        async cancel(reason) {
            if (settled) return;
            settled = true;
            try {
                await reader.cancel(reason);
            } finally {
                releaseReader(reader);
            }
        },
    });
}
