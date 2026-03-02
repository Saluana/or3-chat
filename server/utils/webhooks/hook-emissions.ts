import { emitWebhookSystemHook } from './runtime';

export interface BackgroundJobWebhookEventInput {
    status: 'completed' | 'failed';
    jobId: string;
    workspaceId: string;
    userId: string;
    threadId: string;
    messageId: string;
    error?: string;
}

export interface MessageCompletedWebhookEventInput {
    threadId: string;
    messageId: string;
    modelId?: string | null;
    jobId?: string | null;
    completedAt?: string | number | Date | null;
}

function toIsoTimestamp(value?: string | number | Date | null): string {
    if (typeof value === 'string' && value.trim()) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }

    return new Date().toISOString();
}

export async function emitBackgroundJobWebhookEvent(
    input: BackgroundJobWebhookEventInput
): Promise<void> {
    await emitWebhookSystemHook(
        input.status === 'completed'
            ? 'background.job:completed'
            : 'background.job:failed',
        {
            jobId: input.jobId,
            status: input.status,
            workspaceId: input.workspaceId,
            userId: input.userId,
            threadId: input.threadId,
            messageId: input.messageId,
            error: input.error ?? null,
        }
    );
}

export async function emitMessageCompletedWebhookEvent(
    input: MessageCompletedWebhookEventInput
): Promise<void> {
    await emitWebhookSystemHook('ai.chat.stream:action:complete', {
        threadId: input.threadId,
        messageId: input.messageId,
        modelId: input.modelId ?? null,
        jobId: input.jobId ?? null,
        completedAt: toIsoTimestamp(input.completedAt),
    });
}
