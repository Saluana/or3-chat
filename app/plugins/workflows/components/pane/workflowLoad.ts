import type { WorkflowData } from 'or3-workflow-core';

export const EMPTY_WORKFLOW: WorkflowData = {
    meta: { version: '2.0.0', name: 'Untitled' },
    nodes: [
        {
            id: 'start',
            type: 'start',
            position: { x: 250, y: 100 },
            data: { label: 'Start' },
        },
    ],
    edges: [],
};

export interface WorkflowResolution {
    status: 'new' | 'loaded' | 'error';
    data?: WorkflowData;
    error?: string;
}

/**
 * Decide what to load into the editor given a recordId and persisted meta.
 * - No recordId: treat as a new workflow (empty template).
 * - Record present with valid meta: load it.
 * - Record present without meta: surface an error; do not fall back to empty (prevents clobber).
 */
export function resolveWorkflowData(options: {
    recordId?: string | null;
    meta: WorkflowData | null | undefined;
}): WorkflowResolution {
    const { recordId, meta } = options;

    if (!recordId) {
        return { status: 'new', data: EMPTY_WORKFLOW };
    }

    if (meta) {
        return { status: 'loaded', data: meta };
    }

    return {
        status: 'error',
        error: 'Workflow data is missing. Please reload or restore a backup.',
    };
}
