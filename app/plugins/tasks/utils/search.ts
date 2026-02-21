import {
    createDb,
    buildIndex as buildOramaIndex,
    searchWithIndex,
} from '~/core/search/orama';
import type { TaskListMetaV1 } from '../types';

type OramaInstance = unknown;

export interface TaskListSearchSource {
    id: string;
    title?: string | null;
    updated_at?: number | null;
    meta?: unknown;
}

export interface TaskListSearchDoc {
    id: string;
    title: string;
    content: string;
    updated_at: number;
}

export interface TaskListSearchIndex {
    db: OramaInstance;
    docs: TaskListSearchDoc[];
    docsById: Record<string, TaskListSearchDoc>;
}

function safeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function buildTaskContent(meta: TaskListMetaV1): string {
    const chunks: string[] = [];
    for (const task of meta.tasks) {
        const parts = [
            task.title,
            task.notes,
            task.status,
            task.label,
            ...(Array.isArray(task.subtasks)
                ? task.subtasks.map((subtask) => subtask.title)
                : []),
        ]
            .map((entry) => safeText(entry))
            .filter(Boolean);
        if (parts.length > 0) {
            chunks.push(parts.join(' '));
        }
    }
    return chunks.join('\n');
}

export function buildTaskListSearchDocs(
    sources: TaskListSearchSource[],
    readMeta: (meta: unknown) => TaskListMetaV1
): TaskListSearchDoc[] {
    return sources.map((source) => {
        const title = safeText(source.title) || 'Untitled Tasks';
        const meta = readMeta(source.meta);
        return {
            id: source.id,
            title,
            content: buildTaskContent(meta),
            updated_at:
                typeof source.updated_at === 'number' &&
                Number.isFinite(source.updated_at)
                    ? source.updated_at
                    : 0,
        };
    });
}

export function computeTaskListSearchSignature(
    sources: TaskListSearchSource[]
): string {
    let latestUpdatedAt = 0;
    for (const source of sources) {
        const updatedAt =
            typeof source.updated_at === 'number' &&
            Number.isFinite(source.updated_at)
                ? source.updated_at
                : 0;
        if (updatedAt > latestUpdatedAt) latestUpdatedAt = updatedAt;
    }
    return `${sources.length}:${latestUpdatedAt}`;
}

export async function createTaskListSearchIndex(
    docs: TaskListSearchDoc[]
): Promise<TaskListSearchIndex | null> {
    if (import.meta.server) return null;
    const db = await createDb({
        id: 'string',
        title: 'string',
        content: 'string',
        updated_at: 'number',
    });
    if (!db) return null;
    if (docs.length > 0) {
        await buildOramaIndex(db, docs);
    }
    return {
        db,
        docs,
        docsById: Object.fromEntries(docs.map((doc) => [doc.id, doc])),
    };
}

function uniqueIds(ids: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

export function substringTaskListSearch(
    docs: TaskListSearchDoc[],
    query: string,
    limit: number
): string[] {
    const raw = query.trim().toLowerCase();
    if (!raw) return docs.slice(0, limit).map((doc) => doc.id);
    return docs
        .filter((doc) => {
            const title = doc.title.toLowerCase();
            const content = doc.content.toLowerCase();
            return title.includes(raw) || content.includes(raw);
        })
        .slice(0, limit)
        .map((doc) => doc.id);
}

export async function searchTaskListIndex(
    index: TaskListSearchIndex,
    query: string,
    limit = 100
): Promise<{ ids: string[]; usedFallback: boolean }> {
    const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    const raw = query.trim();
    if (!raw) {
        return {
            ids: index.docs.slice(0, normalizedLimit).map((doc) => doc.id),
            usedFallback: false,
        };
    }

    try {
        const result = await searchWithIndex(index.db, raw, normalizedLimit);
        const hits = Array.isArray(result.hits) ? result.hits : [];
        const ids = uniqueIds(
            hits
                .map((hit) => {
                    const candidate = hit as {
                        id?: unknown;
                        document?: { id?: unknown } | null;
                    };
                    const documentId = candidate.document?.id;
                    if (typeof documentId === 'string') {
                        return documentId;
                    }
                    return typeof candidate.id === 'string'
                        ? candidate.id
                        : undefined;
                })
                .filter((id): id is string => typeof id === 'string')
                .filter((id) => Boolean(index.docsById[id]))
        );

        if (ids.length > 0) {
            return { ids, usedFallback: false };
        }
    } catch {
        // fallback below
    }

    return {
        ids: substringTaskListSearch(index.docs, raw, normalizedLimit),
        usedFallback: true,
    };
}
