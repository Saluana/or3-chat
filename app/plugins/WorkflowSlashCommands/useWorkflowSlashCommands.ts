/**
 * Workflow Slash Commands - Search & Lookup
 *
 * Provides functions to search and retrieve workflows for the slash command feature.
 */

import type { WorkflowData } from 'or3-workflow-core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Workflow item for display in the slash command popover
 */
export interface WorkflowItem {
    /** Unique workflow ID */
    id: string;
    /** Workflow title/name */
    label: string;
    /** Last update timestamp (Unix seconds) */
    updatedAt: number;
}

/**
 * Full workflow data for execution
 */
export interface WorkflowRecord {
    id: string;
    title: string;
    postType: string;
    meta: WorkflowData | null;
    created_at: number;
    updated_at: number;
}

// Post type used by the workflows plugin
const POST_TYPE = 'workflow-entry';

// ─────────────────────────────────────────────────────────────
// Search Functions
// ─────────────────────────────────────────────────────────────

/**
 * Search workflows by query string.
 * Returns top matching workflows sorted by most recently updated.
 *
 * @param query - Search query (case-insensitive substring match on title)
 * @param limit - Max number of results (default: 10). Pass undefined to return all.
 * @returns Array of matching workflow items
 */
export async function searchWorkflows(
    query: string,
    limit: number | undefined = 10
): Promise<WorkflowItem[]> {
    try {
        const { getDb } = await import('~/db/client');
        const db = getDb();

        // Get all non-deleted workflows
        const workflows = await db.posts
            .where('postType')
            .equals(POST_TYPE)
            .and((p: any) => !p.deleted)
            .toArray();

        // Filter by query (case-insensitive substring match)
        const q = query.toLowerCase().trim();
        const filtered = q
            ? workflows.filter((w: any) =>
                  (w.title || '').toLowerCase().includes(q)
              )
            : workflows;

        // Sort by most recently updated and apply limit if provided
        const sorted = filtered.sort(
            (a: any, b: any) => (b.updated_at || 0) - (a.updated_at || 0)
        );
        const limited =
            typeof limit === 'number'
                ? sorted.slice(0, Math.max(limit, 0))
                : sorted;

        return limited.map((w: any) => ({
            id: w.id,
            label: w.title || 'Untitled Workflow',
            updatedAt: w.updated_at || w.created_at || 0,
        }));
    } catch (error) {
        console.error('[workflow-slash] Search failed:', error);
        return [];
    }
}

/**
 * Get a workflow by its exact title.
 * Used when executing a workflow from a slash command.
 *
 * @param name - Exact workflow title to match
 * @returns Workflow record or null if not found
 */
export async function getWorkflowByName(
    name: string
): Promise<WorkflowRecord | null> {
    try {
        const { getDb } = await import('~/db/client');
        const db = getDb();

        const workflow = await db.posts
            .where('postType')
            .equals(POST_TYPE)
            .and((p: any) => !p.deleted && p.title === name)
            .first();

        if (!workflow) {
            return null;
        }

        // Parse meta if it's a JSON string (stored serialized in DB)
        let meta: WorkflowData | null = null;
        if (workflow.meta) {
            try {
                meta =
                    typeof workflow.meta === 'string'
                        ? JSON.parse(workflow.meta)
                        : workflow.meta;
            } catch (e) {
                console.error(
                    '[workflow-slash] Failed to parse workflow meta:',
                    e
                );
            }
        }

        return {
            id: workflow.id,
            title: workflow.title || 'Untitled Workflow',
            postType: workflow.postType,
            meta,
            created_at: workflow.created_at,
            updated_at: workflow.updated_at,
        };
    } catch (error) {
        console.error('[workflow-slash] getWorkflowByName failed:', error);
        return null;
    }
}

/**
 * Get a workflow by its ID.
 * Used when the workflow ID is stored in the editor node.
 *
 * @param id - Workflow ID to look up
 * @returns Workflow record or null if not found
 */
export async function getWorkflowById(
    id: string
): Promise<WorkflowRecord | null> {
    try {
        const { getDb } = await import('~/db/client');
        const db = getDb();

        const workflow = await db.posts.get(id);

        if (!workflow || workflow.deleted || workflow.postType !== POST_TYPE) {
            return null;
        }

        // Parse meta if it's a JSON string (stored serialized in DB)
        let meta: WorkflowData | null = null;
        if (workflow.meta) {
            try {
                meta =
                    typeof workflow.meta === 'string'
                        ? JSON.parse(workflow.meta)
                        : workflow.meta;
            } catch (e) {
                console.error(
                    '[workflow-slash] Failed to parse workflow meta:',
                    e
                );
            }
        }

        return {
            id: workflow.id,
            title: workflow.title || 'Untitled Workflow',
            postType: workflow.postType,
            meta,
            created_at: workflow.created_at,
            updated_at: workflow.updated_at,
        };
    } catch (error) {
        console.error('[workflow-slash] getWorkflowById failed:', error);
        return null;
    }
}

/**
 * List all workflow records with parsed meta.
 * Used to build registries for subflow execution.
 */
export async function listWorkflowsWithMeta(): Promise<WorkflowRecord[]> {
    try {
        const { getDb } = await import('~/db/client');
        const db = getDb();

        const workflows = await db.posts
            .where('postType')
            .equals(POST_TYPE)
            .and((p: any) => !p.deleted)
            .toArray();

        return workflows.map((workflow: any) => {
            let meta: WorkflowData | null = null;
            if (workflow.meta) {
                try {
                    meta =
                        typeof workflow.meta === 'string'
                            ? JSON.parse(workflow.meta)
                            : workflow.meta;
                } catch (e) {
                    console.error(
                        '[workflow-slash] Failed to parse workflow meta:',
                        e
                    );
                }
            }

            return {
                id: workflow.id,
                title: workflow.title || 'Untitled Workflow',
                postType: workflow.postType,
                meta,
                created_at: workflow.created_at,
                updated_at: workflow.updated_at,
            };
        });
    } catch (error) {
        console.error('[workflow-slash] listWorkflowsWithMeta failed:', error);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

export default {
    searchWorkflows,
    getWorkflowByName,
    getWorkflowById,
    listWorkflowsWithMeta,
};
