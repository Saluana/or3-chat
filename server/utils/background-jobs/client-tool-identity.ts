import { getChatJobExecution, type BackgroundJob } from './types';
import type { BackgroundClientToolIdentity } from '~~/shared/chat/background-client-tool-claim';

export function backgroundJobClientToolIdentity(job: BackgroundJob): BackgroundClientToolIdentity | null {
    const execution = getChatJobExecution(job);
    const pending = execution?.clientToolCall;
    if (!execution || !pending) return null;
    return { jobId: job.id, userId: job.userId, workspaceId: execution.workspaceId,
        threadId: job.threadId, messageId: job.messageId,
        call: { id: pending.callId, name: pending.name, arguments: pending.arguments, definition: pending.definition } };
}
