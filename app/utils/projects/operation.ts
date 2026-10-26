import { getActiveWorkspaceId } from '~/db/client';
import { captureWorkspaceOperation } from '~/utils/chat/workspace-access';
import { createRuntimeUuid } from '~~/shared/runtime-id';

/** Capture the current workspace without loading project retrieval or AI transport. */
export function captureProjectOperation(
    signal = new AbortController().signal,
    threadId = 'project-home',
) {
    return captureWorkspaceOperation({
        subject: null,
        workspaceId: getActiveWorkspaceId() ?? 'local',
        threadId,
        messageId: null,
        requestId: createRuntimeUuid(),
        callId: createRuntimeUuid(),
        abortSignal: signal,
    });
}
