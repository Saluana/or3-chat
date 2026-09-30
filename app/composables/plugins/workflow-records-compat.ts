/**
 * Compatibility callbacks for already-installed Workflows artifacts.
 * New packages interpret `records` themselves. Remove this adapter after those
 * artifacts have migrated; these callbacks are not an additional SDK.
 */
import { isWorkflowMessageData } from '~/utils/chat/workflow-types';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import type { createScopedRecordStore } from './trusted-production-stores';

type Records = ReturnType<typeof createScopedRecordStore>;
type Post = Awaited<ReturnType<Records['posts']['list']>>[number];
type StoredMessage = Awaited<ReturnType<Records['messages']['get']>>;
type WorkflowData = { nodes: unknown[]; edges: unknown[]; meta: Record<string, unknown> };
type ActivityMessage = { id: string; threadId: string; createdAt: number; updatedAt: number; data: WorkflowMessageData };

function decodeMeta(value: unknown): unknown {
    try { return typeof value === 'string' ? JSON.parse(value) as unknown : value; }
    catch { return null; }
}

function toWorkflow(post: Post) {
    const parsed = decodeMeta(post.meta);
    const candidate = parsed as Partial<WorkflowData> | null;
    const meta = candidate && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) &&
        candidate.meta && typeof candidate.meta === 'object' ? parsed as WorkflowData : null;
    return { id: post.id, title: post.title || 'Untitled Workflow', updated_at: post.updated_at, meta };
}

export function createLegacyWorkflowRecordAccess(records: Records) {
    const toActivity = (row: StoredMessage): ActivityMessage | undefined =>
        row && isWorkflowMessageData(row.data) ? {
            id: row.id, threadId: row.threadId, createdAt: row.createdAt, updatedAt: row.updatedAt, data: row.data,
        } : undefined;
    const searchWorkflows = async (query: string, limit = 10) => {
        const normalized = query.trim().toLowerCase();
        return (await records.posts.list())
            .filter((post) => !normalized || (post.title || '').toLowerCase().includes(normalized))
            .sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0))
            .slice(0, Math.max(0, limit))
            .map((post) => ({ id: post.id, label: post.title || 'Untitled Workflow', updatedAt: post.updated_at || post.created_at || 0 }));
    };
    return {
        searchWorkflows,
        async getWorkflowById(id: string) {
            const post = await records.posts.get(id);
            return post ? toWorkflow(post) : null;
        },
        async getWorkflowByName(name: string) {
            const post = (await records.posts.list()).find((post) => post.title === name);
            return post ? toWorkflow(post) : null;
        },
        async listWorkflowNames() {
            return (await searchWorkflows('', Number.POSITIVE_INFINITY)).map((post) => post.label);
        },
        async getMessage(id: string) {
            const row = await records.messages.get(id);
            return row && isWorkflowMessageData(row.data)
                ? { id: row.id, threadId: row.threadId, streamId: row.streamId, data: row.data } : null;
        },
        activityStore: {
            async list() {
                return (await records.messages.list()).map(toActivity)
                    .filter((row): row is ActivityMessage => row !== undefined);
            },
            async get(id: string) { return toActivity(await records.messages.get(id)); },
        },
        async reconcileInterruptedRuns() {
            const updates = (await records.messages.list()).flatMap((row) => {
                const data = row.data;
                return isWorkflowMessageData(data) && data.executionState === 'running' &&
                    !(data.background_job_id && data.background_job_status === 'streaming')
                    ? [{ id: row.id, ifClock: row.clock, ifData: data, data: { ...data, executionState: 'interrupted' }, pending: false }]
                    : [];
            });
            if (updates.length) await records.messages.updateData(updates);
        },
        async listWorkflowsWithMeta() {
            return (await records.posts.list()).map((post) => ({
                id: post.id, title: post.title || 'Untitled Workflow', meta: decodeMeta(post.meta),
            }));
        },
        async loadConversationHistory(threadId: string) {
            if (!threadId) return [];
            const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
            for (const row of await records.messages.listByThread(threadId)) {
                if (isWorkflowMessageData(row.data)) {
                    if (typeof row.data.prompt === 'string' && row.data.prompt) history.push({ role: 'user', content: row.data.prompt });
                    if (typeof row.data.finalOutput === 'string' && row.data.finalOutput) history.push({ role: 'assistant', content: row.data.finalOutput });
                } else if (row.content && (row.role === 'user' || row.role === 'assistant' || row.role === 'system')) {
                    history.push({ role: row.role, content: row.content });
                }
            }
            return history;
        },
    };
}
