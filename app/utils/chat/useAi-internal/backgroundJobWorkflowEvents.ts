/**
 * Workflow hook projection for background job status updates.
 */
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import type { HookEngine } from '~/core/hooks/hooks';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';

let cachedWorkflowHooks: TypedHookEngine | null = null;

function resolveWorkflowHooks(): TypedHookEngine | null {
    if (cachedWorkflowHooks) return cachedWorkflowHooks;
    const globalHooks = globalThis as typeof globalThis & {
        __NUXT_HOOKS__?: HookEngine;
    };
    if (!globalHooks.__NUXT_HOOKS__) return null;
    cachedWorkflowHooks = createTypedHookEngine(globalHooks.__NUXT_HOOKS__);
    return cachedWorkflowHooks;
}

export function dispatchWorkflowStateUpdate(
    messageId: string,
    state: WorkflowMessageData
): void {
    const hooks = resolveWorkflowHooks();
    if (!hooks?.hasAction('workflow.execution:action:state_update')) return;
    void hooks
        .doAction('workflow.execution:action:state_update', {
            messageId,
            state,
        })
        .catch(() => undefined);
}

export function dispatchWorkflowComplete(
    messageId: string,
    workflowId: string,
    finalOutput?: string
): void {
    const hooks = resolveWorkflowHooks();
    if (!hooks?.hasAction('workflow.execution:action:complete')) return;
    void hooks
        .doAction('workflow.execution:action:complete', {
            messageId,
            workflowId,
            finalOutput,
        })
        .catch(() => undefined);
}
