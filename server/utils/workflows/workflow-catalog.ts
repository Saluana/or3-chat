/**
 * @module server/utils/workflows/workflow-catalog
 *
 * Purpose:
 * Resolve canonical workflow definitions from the active sync backend.
 *
 * Behavior:
 * - Pulls `posts` changes via the active sync gateway adapter.
 * - Maintains a short-lived per-workspace cache to avoid full rescans.
 * - Returns canonical workflow metadata for background execution.
 */

import type { H3Event } from 'h3';
import type { WorkflowData } from 'or3-workflow-core';
import { getActiveSyncGatewayAdapter } from '../../sync/gateway/registry';

const WORKFLOW_POST_TYPE = 'workflow-entry';
const CACHE_TTL_MS = 30_000;
const PULL_LIMIT = 500;
const MAX_PULL_PAGES = 200;

type WorkflowPostPayload = Record<string, unknown>;

type WorkspaceWorkflowCache = {
    cursor: number;
    hydrated: boolean;
    expiresAt: number;
    posts: Map<string, WorkflowPostPayload>;
};

const workspaceCaches = new Map<string, WorkspaceWorkflowCache>();

export class WorkflowCatalogError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = 'WorkflowCatalogError';
    }
}

export interface ResolveCanonicalWorkflowParams {
    workspaceId: string;
    workflowId: string;
    expectedUpdatedAt?: number;
    expectedVersion?: string;
}

export interface CanonicalWorkflowRecord {
    workflowId: string;
    workflowName: string;
    workflowUpdatedAt?: number;
    workflowVersion?: string;
    workflow: WorkflowData;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return undefined;
}

function getWorkspaceCache(workspaceId: string): WorkspaceWorkflowCache {
    let cache = workspaceCaches.get(workspaceId);
    if (!cache) {
        cache = {
            cursor: 0,
            hydrated: false,
            expiresAt: 0,
            posts: new Map<string, WorkflowPostPayload>(),
        };
        workspaceCaches.set(workspaceId, cache);
    }
    return cache;
}

function applyPostChange(
    posts: Map<string, WorkflowPostPayload>,
    change: {
        tableName: string;
        pk: string;
        op: 'put' | 'delete';
        payload?: unknown;
    }
): void {
    if (change.tableName !== 'posts') return;

    if (change.op === 'delete') {
        posts.delete(change.pk);
        return;
    }

    const payload = asRecord(change.payload);
    if (!payload) {
        posts.delete(change.pk);
        return;
    }

    const postType = asString(payload.post_type ?? payload.postType);
    const deleted = payload.deleted === true;
    if (postType !== WORKFLOW_POST_TYPE || deleted) {
        posts.delete(change.pk);
        return;
    }

    posts.set(change.pk, payload);
}

async function refreshWorkspaceCache(
    event: H3Event,
    workspaceId: string
): Promise<WorkspaceWorkflowCache> {
    const adapter = getActiveSyncGatewayAdapter();
    if (!adapter) {
        throw new WorkflowCatalogError('Sync adapter not configured', 500);
    }

    const now = Date.now();
    const cache = getWorkspaceCache(workspaceId);
    const shouldFullRefresh = !cache.hydrated || cache.expiresAt <= now;

    let cursor = shouldFullRefresh ? 0 : cache.cursor;
    if (shouldFullRefresh) {
        cache.posts.clear();
    }

    let hasMore = true;
    let pages = 0;
    while (hasMore) {
        pages += 1;
        if (pages > MAX_PULL_PAGES) {
            throw new WorkflowCatalogError(
                `Workflow catalog exceeded ${MAX_PULL_PAGES} pull pages`,
                503
            );
        }

        const result = await adapter.pull(event, {
            scope: { workspaceId },
            cursor,
            limit: PULL_LIMIT,
            tables: ['posts'],
        });

        for (const change of result.changes) {
            applyPostChange(cache.posts, change);
        }

        cursor = result.nextCursor;
        hasMore = result.hasMore;
    }

    cache.cursor = cursor;
    cache.hydrated = true;
    cache.expiresAt = now + CACHE_TTL_MS;
    return cache;
}

function resolveWorkflowVersion(workflow: WorkflowData): string | undefined {
    const meta = asRecord(workflow.meta);
    return asString(meta?.version);
}

function stableSerialize(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(
            ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
        );
        return `{${entries
            .map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`)
            .join(',')}}`;
    }
    return JSON.stringify(String(value));
}

export function workflowsMatch(
    incomingWorkflow: unknown,
    canonicalWorkflow: WorkflowData
): boolean {
    return stableSerialize(incomingWorkflow) === stableSerialize(canonicalWorkflow);
}

export async function resolveCanonicalWorkflow(
    event: H3Event,
    params: ResolveCanonicalWorkflowParams
): Promise<CanonicalWorkflowRecord> {
    const cache = await refreshWorkspaceCache(event, params.workspaceId);
    const payload = cache.posts.get(params.workflowId);
    if (!payload) {
        throw new WorkflowCatalogError(
            `Workflow "${params.workflowId}" not found`,
            404
        );
    }

    const workflowUpdatedAt = asNumber(payload.updated_at ?? payload.updatedAt);
    if (
        typeof params.expectedUpdatedAt === 'number' &&
        typeof workflowUpdatedAt === 'number' &&
        workflowUpdatedAt < params.expectedUpdatedAt
    ) {
        throw new WorkflowCatalogError(
            'Workflow is stale on server. Sync and retry.',
            409
        );
    }

    const rawMeta = payload.meta;
    let workflowMeta: unknown = rawMeta;
    if (typeof workflowMeta === 'string') {
        try {
            workflowMeta = JSON.parse(workflowMeta);
        } catch {
            throw new WorkflowCatalogError(
                `Workflow "${params.workflowId}" metadata is not valid JSON`,
                422
            );
        }
    }

    const workflowRecord = asRecord(workflowMeta);
    if (!workflowRecord) {
        throw new WorkflowCatalogError(
            `Workflow "${params.workflowId}" metadata is missing`,
            422
        );
    }

    const workflow = workflowRecord as unknown as WorkflowData;
    const workflowVersion = resolveWorkflowVersion(workflow);
    if (
        params.expectedVersion &&
        workflowVersion &&
        workflowVersion !== params.expectedVersion
    ) {
        throw new WorkflowCatalogError(
            'Workflow version mismatch. Refresh and retry.',
            409
        );
    }

    const workflowName =
        asString(payload.title) ||
        asString(asRecord(workflow.meta)?.name) ||
        'Workflow';

    return {
        workflowId: params.workflowId,
        workflowName,
        workflowUpdatedAt,
        workflowVersion,
        workflow,
    };
}
