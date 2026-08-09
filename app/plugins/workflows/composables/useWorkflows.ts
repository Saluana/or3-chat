import {
    DEFAULT_WORKFLOW_MODEL,
    WorkflowEditor,
    StarterKit,
    type WorkflowData,
} from 'or3-workflow-core';
import { computed } from 'vue';

import {
    usePostsList,
    type PostData as ListedPostData,
} from '~/composables/posts/usePostsList';
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
interface WorkflowEditorRegistry {
    // Kept on globalThis in development so the registry survives module HMR.
    instances: Map<string, WorkflowEditor>;
    owners: Map<string, number>;
    pendingDestruction: Map<string, ReturnType<typeof setTimeout>>;
    loadedRecordIds: Map<string, string | null>;
}

const workflowEditorGlobal = globalThis as typeof globalThis & {
    __workflowEditorRegistry?: WorkflowEditorRegistry;
    __workflowEditorInstances?: Map<string, WorkflowEditor>;
};

function createWorkflowEditorRegistry(): WorkflowEditorRegistry {
    return {
        instances: new Map(),
        owners: new Map(),
        pendingDestruction: new Map(),
        loadedRecordIds: new Map(),
    };
}

const editorRegistry = import.meta.dev
    ? (workflowEditorGlobal.__workflowEditorRegistry ??=
          createWorkflowEditorRegistry())
    : createWorkflowEditorRegistry();
const editorInstances = editorRegistry.instances;
const workflowSyncState = new Map<
    string,
    { updatedAt: number; lastWriterPaneId?: string }
>();

// Debug logging in development
if (import.meta.dev) {
    workflowEditorGlobal.__workflowEditorInstances = editorInstances;
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
                defaultModel: DEFAULT_WORKFLOW_MODEL,
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
    if (editor?.isDestroyed()) {
        editorInstances.delete(paneId);
        editorRegistry.owners.delete(paneId);
        editorRegistry.loadedRecordIds.delete(paneId);
        editor = undefined;
    }
    if (!editor) {
        editor = new WorkflowEditor(createDefaultEditorOptions());
        editorInstances.set(paneId, editor);
    }
    return editor;
}

/**
 * Acquire ownership of a pane editor for a mounted WorkflowPane.
 * A replacement mount cancels deferred teardown from the outgoing component.
 */
export function acquireEditorForPane(paneId: string): WorkflowEditor {
    const pending = editorRegistry.pendingDestruction.get(paneId);
    if (pending) {
        clearTimeout(pending);
        editorRegistry.pendingDestruction.delete(paneId);
    }

    const editor = getEditorForPane(paneId);
    editorRegistry.owners.set(
        paneId,
        (editorRegistry.owners.get(paneId) ?? 0) + 1,
    );
    return editor;
}

/**
 * Release a mounted pane's ownership. Destruction waits until the next task so
 * Vue/Vite replacement mounts can reacquire the same editor during HMR.
 */
export function releaseEditorForPane(
    paneId: string,
    expectedEditor: WorkflowEditor,
): void {
    if (editorInstances.get(paneId) !== expectedEditor) return;

    const remainingOwners = Math.max(
        0,
        (editorRegistry.owners.get(paneId) ?? 1) - 1,
    );
    if (remainingOwners > 0) {
        editorRegistry.owners.set(paneId, remainingOwners);
        return;
    }
    editorRegistry.owners.delete(paneId);

    const previous = editorRegistry.pendingDestruction.get(paneId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
        editorRegistry.pendingDestruction.delete(paneId);
        if ((editorRegistry.owners.get(paneId) ?? 0) > 0) return;
        destroyEditorForPane(paneId, expectedEditor);
    }, 0);
    editorRegistry.pendingDestruction.set(paneId, timer);
}

export function getLoadedWorkflowRecordForPane(
    paneId: string,
): string | null | undefined {
    return editorRegistry.loadedRecordIds.get(paneId);
}

export function markEditorForPaneLoaded(
    paneId: string,
    editor: WorkflowEditor,
    recordId: string | null,
): void {
    if (editorInstances.get(paneId) === editor && !editor.isDestroyed()) {
        editorRegistry.loadedRecordIds.set(paneId, recordId);
    }
}

/**
 * Immediately destroy a workflow editor instance.
 * Mounted panes should normally use releaseEditorForPane instead.
 */
export function destroyEditorForPane(
    paneId: string,
    expectedEditor?: WorkflowEditor,
): void {
    const editor = editorInstances.get(paneId);
    if (editor && (!expectedEditor || editor === expectedEditor)) {
        const pending = editorRegistry.pendingDestruction.get(paneId);
        if (pending) clearTimeout(pending);
        editorRegistry.pendingDestruction.delete(paneId);
        editorRegistry.owners.delete(paneId);
        editorRegistry.loadedRecordIds.delete(paneId);
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
        if (editor.isDestroyed()) {
            editorInstances.delete(paneId);
            continue;
        }
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

export function getWorkflowSyncState(recordId: string) {
    return workflowSyncState.get(recordId);
}

export function setWorkflowSyncState(
    recordId: string,
    state: { updatedAt: number; lastWriterPaneId?: string }
) {
    workflowSyncState.set(recordId, state);
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

function toWorkflowPost(
    post: Pick<
        ListedPostData,
        'id' | 'title' | 'content' | 'meta' | 'created_at' | 'updated_at'
    >
): WorkflowPost {
    return {
        id: post.id,
        title: post.title,
        content: post.content,
        postType: POST_TYPE,
        meta: (post.meta as WorkflowData | null | undefined) ?? null,
        created_at: post.created_at,
        updated_at: post.updated_at,
    };
}

/**
 * Reactive workflow list backed by Dexie liveQuery.
 * Automatically reflects local writes and remote sync pulls.
 */
export function useWorkflowList(limit?: number) {
    const { items, loading, error, refresh } = usePostsList(POST_TYPE, {
        limit,
        sort: 'updated_at',
        sortDir: 'desc',
    });

    const workflows = computed(() => items.value.map(toWorkflowPost));
    const errorMessage = computed(() => error.value?.message ?? null);

    return {
        workflows,
        loading,
        error: errorMessage,
        refresh,
    };
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
        data?: WorkflowData,
        description?: string
    ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
        if (!postApi) {
            return { ok: false, error: 'Posts API not available' };
        }

        try {
            const baseData = data ?? EMPTY_WORKFLOW;
            const workflowData: WorkflowData = {
                ...baseData,
                meta: {
                    ...baseData.meta,
                    name: title,
                    ...(description !== undefined && {
                        description: description.trim() || undefined,
                    }),
                },
            };
            const result = await postApi.create({
                postType: POST_TYPE,
                title,
                content: '',
                meta: workflowData,
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
                workflow: toWorkflowPost(post),
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

            const workflows: WorkflowPost[] = result.posts.map(toWorkflowPost);

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
