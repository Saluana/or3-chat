import {
    WorkflowEditor,
    StarterKit,
    type WorkflowData,
} from '@or3/workflow-core';

import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';

const POST_TYPE = 'workflow-entry';
const SOURCE = 'workflows-plugin';

// ─────────────────────────────────────────────────────────────
// Per-Pane Workflow Editor Management
// ─────────────────────────────────────────────────────────────

/**
 * Map of pane IDs to their workflow editor instances.
 * Each pane gets its own isolated editor state.
 */
const editorInstances = new Map<string, WorkflowEditor>();

// Debug logging in development
if (import.meta.dev) {
    (globalThis as any).__workflowEditorInstances = editorInstances;
}

/**
 * Empty workflow template
 */
const EMPTY_WORKFLOW: WorkflowData = {
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

/**
 * Create default editor options for new instances
 */
function createDefaultEditorOptions() {
    return {
        extensions: StarterKit.configure({
            // Configure specific nodes
            agent: {
                defaultModel: 'anthropic/claude-3.5-sonnet',
            },
        }),
    };
}

/**
 * Get or create a workflow editor for a specific pane.
 * Each pane ID gets its own isolated editor instance.
 */
export function getEditorForPane(paneId: string): WorkflowEditor {
    let editor = editorInstances.get(paneId);
    if (!editor) {
        editor = new WorkflowEditor(createDefaultEditorOptions());
        editorInstances.set(paneId, editor);
    }
    return editor;
}

/**
 * Destroy a workflow editor instance when pane is closed.
 * Call this when a workflow pane is unmounted.
 */
export function destroyEditorForPane(paneId: string): void {
    const editor = editorInstances.get(paneId);
    if (editor) {
        // Call destroy() to clean up listeners and extensions
        // Do NOT load EMPTY_WORKFLOW - that would trigger update events and race with saves
        editor.destroy();
        editorInstances.delete(paneId);
    }
}

/**
 * Clear selection in all workflow editors except the active pane.
 */
export function deselectAllOtherEditors(activePaneId: string): void {
    for (const [paneId, editor] of editorInstances.entries()) {
        if (paneId === activePaneId) continue;
        const selected = editor.getSelected();
        if (selected.nodes.length || selected.edges.length) {
            editor.commands.deselectAll();
        }
    }
}

/**
 * Get all active editor instances (for debugging/inspection)
 */
export function getActiveEditorCount(): number {
    return editorInstances.size;
}

// Type for workflow posts with parsed meta
export interface WorkflowPost {
    id: string;
    title: string;
    content: string;
    postType: typeof POST_TYPE;
    meta: WorkflowData | null;
    created_at: number;
    updated_at: number;
}

/**
 * Check if a post is a workflow post
 */
export function isWorkflowPost(post: unknown): post is WorkflowPost {
    return (
        typeof post === 'object' &&
        post !== null &&
        'postType' in post &&
        (post as { postType: string }).postType === POST_TYPE
    );
}

/**
 * Composable for workflow CRUD operations.
 * Must be called in component setup to capture the posts API.
 */
export function useWorkflowsCrud(postApi: PanePluginApi['posts'] | null) {
    /**
     * Create a new workflow
     */
    async function createWorkflow(
        title: string,
        data?: WorkflowData
    ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
        if (!postApi) {
            return { ok: false, error: 'Posts API not available' };
        }

        try {
            const result = await postApi.create({
                postType: POST_TYPE,
                title,
                content: '',
                meta: data ?? EMPTY_WORKFLOW,
                source: SOURCE,
            });

            if (!result.ok) {
                return { ok: false, error: result.message };
            }

            return { ok: true, id: result.id };
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            };
        }
    }

    /**
     * Get a workflow by ID
     */
    async function getWorkflow(
        id: string
    ): Promise<
        { ok: true; workflow: WorkflowPost } | { ok: false; error: string }
    > {
        if (!postApi) {
            return { ok: false, error: 'Posts API not available' };
        }

        try {
            const result = await postApi.get({ id });

            if (!result.ok) {
                return { ok: false, error: result.message };
            }

            const post = result.post;
            return {
                ok: true,
                workflow: {
                    id: post.id,
                    title: post.title,
                    content: post.content,
                    postType: POST_TYPE,
                    meta: post.meta as WorkflowData | null,
                    created_at: post.created_at,
                    updated_at: post.updated_at,
                },
            };
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            };
        }
    }

    /**
     * Update a workflow's data
     */
    async function updateWorkflow(
        id: string,
        patch: {
            title?: string;
            data?: WorkflowData;
        }
    ): Promise<{ ok: true } | { ok: false; error: string }> {
        if (!postApi) {
            return { ok: false, error: 'Posts API not available' };
        }

        try {
            const result = await postApi.update({
                id,
                patch: {
                    ...(patch.title !== undefined && { title: patch.title }),
                    ...(patch.data !== undefined && { meta: patch.data }),
                },
                source: SOURCE,
            });

            if (!result.ok) {
                return { ok: false, error: result.message };
            }

            return { ok: true };
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            };
        }
    }

    /**
     * Delete a workflow (soft delete)
     */
    async function deleteWorkflow(
        id: string
    ): Promise<{ ok: true } | { ok: false; error: string }> {
        if (!postApi) {
            return { ok: false, error: 'Posts API not available' };
        }

        try {
            const result = await postApi.delete({
                id,
                source: SOURCE,
            });

            if (!result.ok) {
                return { ok: false, error: result.message };
            }

            return { ok: true };
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            };
        }
    }

    /**
     * List all workflows
     */
    async function listWorkflows(
        limit?: number
    ): Promise<
        { ok: true; workflows: WorkflowPost[] } | { ok: false; error: string }
    > {
        if (!postApi) {
            return { ok: false, error: 'Posts API not available' };
        }

        try {
            const result = await postApi.listByType({
                postType: POST_TYPE,
                limit,
            });

            if (!result.ok) {
                return { ok: false, error: result.message };
            }

            const workflows: WorkflowPost[] = result.posts.map((post) => ({
                id: post.id,
                title: post.title,
                content: post.content,
                postType: POST_TYPE,
                meta: post.meta as WorkflowData | null,
                created_at: post.created_at,
                updated_at: post.updated_at,
            }));

            return { ok: true, workflows };
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : 'Unknown error',
            };
        }
    }

    return {
        createWorkflow,
        getWorkflow,
        updateWorkflow,
        deleteWorkflow,
        listWorkflows,
    };
}
