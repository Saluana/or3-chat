import type {
    BranchState,
    HitlAction,
    HitlRequestState,
    ToolCallState,
    UiWorkflowState,
} from '~/utils/chat/workflow-types';
import {
    MERGE_BRANCH_ID,
    MERGE_BRANCH_LABEL,
} from '~/utils/chat/workflow-types';

export type WorkflowStatusIcons = {
    pending: string;
    running: string;
    completed: string;
    error: string;
    stopped: string;
};

export type HitlActionDescriptor = {
    key: string;
    label: string;
    action: HitlAction;
    requiresInput?: boolean;
    primary?: boolean;
};

export function projectWorkflowAttachments(
    state: UiWorkflowState
) {
    const attachments = state.attachments ?? [];
    const images = attachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => {
            const url =
                attachment.url ??
                (attachment.content && attachment.mimeType
                    ? `data:${attachment.mimeType};base64,${attachment.content}`
                    : null);
            return url
                ? {
                      id: attachment.id,
                      url,
                      name: attachment.name || 'Image',
                  }
                : null;
        })
        .filter(
            (
                attachment
            ): attachment is { id: string; url: string; name: string } =>
                attachment !== null
        );
    const files = attachments
        .filter((attachment) => attachment.type === 'file')
        .map((attachment) => ({
            id: attachment.id,
            name: attachment.name || 'File',
            mimeType:
                attachment.mimeType || 'application/octet-stream',
        }));
    return { images, files };
}

export function executionStatusIcon(
    state: UiWorkflowState['executionState'],
    hasPendingHitl: boolean,
    icons: WorkflowStatusIcons
): string {
    if (hasPendingHitl) return icons.pending;
    if (state === 'running') return icons.running;
    if (state === 'completed') return icons.completed;
    if (state === 'error') return icons.error;
    if (state === 'stopped' || state === 'interrupted') {
        return icons.stopped;
    }
    return icons.pending;
}

export function executionStatusColor(
    state: UiWorkflowState['executionState'],
    hasPendingHitl: boolean
): string {
    if (hasPendingHitl) {
        return 'text-[var(--md-extended-color-warning-color)] animate-pulse';
    }
    if (state === 'running') {
        return 'text-[var(--md-primary)] animate-spin';
    }
    if (state === 'completed') return 'text-[var(--md-primary)]';
    if (state === 'error') return 'text-[var(--md-error)]';
    return 'text-[var(--md-outline)]';
}

function activeNodeWasStopped(
    status: string,
    executionState: UiWorkflowState['executionState']
): boolean {
    return (
        status === 'active' &&
        (executionState === 'interrupted' ||
            executionState === 'stopped' ||
            executionState === 'error')
    );
}

export function nodeStatusIcon(
    status: string,
    executionState: UiWorkflowState['executionState'],
    icons: WorkflowStatusIcons
): string {
    if (activeNodeWasStopped(status, executionState)) return icons.stopped;
    if (status === 'active') return icons.running;
    if (status === 'completed') return icons.completed;
    if (status === 'error') return icons.error;
    return icons.pending;
}

export function nodeStatusColor(
    status: string,
    executionState: UiWorkflowState['executionState']
): string {
    if (activeNodeWasStopped(status, executionState)) {
        return 'text-[var(--md-outline)]';
    }
    if (status === 'active') {
        return 'text-[var(--md-primary)] animate-spin';
    }
    if (status === 'waiting') {
        return 'text-[var(--md-extended-color-warning-color)] animate-pulse';
    }
    if (status === 'completed') return 'text-[var(--md-primary)]';
    if (status === 'error') return 'text-[var(--md-error)]';
    return 'text-[var(--md-outline)] opacity-50';
}

export function branchLabel(branch: BranchState): string {
    if (branch.id !== MERGE_BRANCH_ID) return branch.label;
    return branch.status === 'completed' ? 'Merge' : MERGE_BRANCH_LABEL;
}

export function branchContent(branch: BranchState): string {
    return branch.id === MERGE_BRANCH_ID
        ? ''
        : branch.output || branch.streamingText || '';
}

export function branchStatusIcon(
    branch: BranchState,
    icons: WorkflowStatusIcons
): string {
    if (branch.status === 'active') return icons.running;
    if (branch.status === 'completed') return icons.completed;
    return icons.pending;
}

export function statusColor(status: string): string {
    if (status === 'active') {
        return 'text-[var(--md-primary)] animate-spin';
    }
    if (status === 'completed') return 'text-[var(--md-primary)]';
    if (status === 'error') return 'text-[var(--md-error)]';
    return 'text-[var(--md-outline)] opacity-50';
}

export function toolStatusIcon(
    tool: ToolCallState,
    icons: WorkflowStatusIcons
): string {
    if (tool.status === 'active') return icons.running;
    if (tool.status === 'completed') return icons.completed;
    return icons.error;
}

export function toolStatusText(
    status: ToolCallState['status']
): string {
    if (status === 'active') return 'Running';
    if (status === 'completed') return 'Succeeded';
    return 'Failed';
}

export function hitlHeading(request: HitlRequestState): string {
    if (request.mode === 'approval') return 'Approval Required';
    if (request.mode === 'input') return 'Input Required';
    return 'Review Required';
}

export function hitlInputLabel(request: HitlRequestState): string {
    if (request.mode === 'approval') return 'Input to approve';
    if (request.mode === 'input') return 'Input provided';
    return 'Input context';
}

export function hitlActions(
    request: HitlRequestState
): HitlActionDescriptor[] {
    if (request.mode === 'input') {
        return [
            {
                key: `${request.id}-submit`,
                label: 'Provide Input',
                action: 'submit',
                requiresInput: true,
                primary: true,
            },
            {
                key: `${request.id}-skip`,
                label: 'Skip',
                action: 'skip',
            },
        ];
    }
    if (request.mode === 'review') {
        return [
            {
                key: `${request.id}-approve`,
                label: 'Review & Approve',
                action: 'approve',
                primary: true,
            },
            {
                key: `${request.id}-modify`,
                label: 'Edit Output',
                action: 'modify',
                requiresInput: true,
            },
        ];
    }
    if (request.options?.length) {
        return request.options.map((option) => ({
            key: `${request.id}-${option.id}`,
            label:
                option.action === 'approve'
                    ? 'Review & Approve'
                    : option.action === 'reject'
                      ? 'Reject & Stop'
                      : option.label,
            action: option.action,
            primary: option.action === 'approve',
            requiresInput: option.action === 'custom',
        }));
    }
    return [
        {
            key: `${request.id}-approve`,
            label: 'Review & Approve',
            action: 'approve',
            primary: true,
        },
        {
            key: `${request.id}-reject`,
            label: 'Reject & Stop',
            action: 'reject',
        },
    ];
}
