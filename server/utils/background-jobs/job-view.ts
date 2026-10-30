import { projectBackgroundWorkflowState } from '~~/shared/chat/background-workflow-state';
import { readRequestUsage } from '~~/shared/chat/compaction';
import type { BackgroundJob } from './types';
import type { getJobLiveState } from './viewers';

type LiveState = NonNullable<ReturnType<typeof getJobLiveState>>;

/** Select the viewer-visible state without reading or mutating either source. */
export function projectJobView(job: BackgroundJob, rawLive?: LiveState | null) {
    const canonicalAttempt = job.attempts ?? 0;
    const live = rawLive && (rawLive.attempt === undefined || rawLive.attempt >= canonicalAttempt)
        ? rawLive : undefined;
    const attempt = live?.attempt ?? canonicalAttempt;
    const advanced = attempt > canonicalAttempt;
    const content = live && (advanced || live.content.length > job.content.length)
        ? live.content : job.content;
    const reasoning = live && (advanced || live.reasoning.length > job.reasoning.length)
        ? live.reasoning : job.reasoning;
    const status = live && (advanced || live.status !== 'streaming') ? live.status : job.status;
    const liveUsage = readRequestUsage(live?.usage);
    const canonicalUsage = advanced ? undefined : readRequestUsage(job.usage);
    const usage = liveUsage && (!canonicalUsage || liveUsage.iteration >= canonicalUsage.iteration)
        ? liveUsage : canonicalUsage;
    const workflow = advanced || live?.workflow_state !== undefined ? live?.workflow_state : job.workflow_state;
    return {
        id: job.id, status, threadId: job.threadId, messageId: job.messageId,
        model: job.model, attempt, startedAt: job.startedAt,
        completedAt: advanced || live?.completedAt !== undefined ? live?.completedAt : job.completedAt,
        error: advanced || typeof live?.error === 'string' ? live?.error : job.error,
        chunksReceived: live && (advanced || live.chunksReceived > job.chunksReceived)
            ? live.chunksReceived : job.chunksReceived,
        tool_calls: advanced || live?.tool_calls !== undefined ? live?.tool_calls : job.tool_calls,
        workflow_state: projectBackgroundWorkflowState(status, workflow),
        usage, content, reasoning_text: reasoning,
    };
}
