import type { PanePluginApi } from '~/plugins/pane-plugin-api.client';
import {
    TASK_LIST_POST_TYPE,
    type TaskItem,
    type TaskLabel,
    type TaskListMetaV1,
    type TaskSubtask,
    type SortMode,
} from '../types';
import { normalizeOrder, taskTieBreakComparator } from '../utils/sort';

function now() {
    return Date.now();
}

function makeId(prefix: string) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function defaultMeta(): TaskListMetaV1 {
    return {
        schema_version: 1,
        sort_mode: 'manual',
        tasks: [],
        last_ai_analysis_at: null,
        ai_fallback_notice: null,
    };
}

function normalizeDueAt(dueAt: number | null | undefined): number | null {
    if (dueAt === null || dueAt === undefined) return null;
    if (!Number.isFinite(dueAt)) return null;
    return Math.max(0, Math.floor(dueAt));
}

export function inferLocalLabel(title: string): TaskLabel {
    const value = title.toLowerCase();
    if (/meeting|project|client|deploy|ticket|email/.test(value)) return 'work';
    if (/kitchen|clean|laundry|home|groceries|cook/.test(value)) return 'home';
    if (/workout|gym|run|health|doctor|meditate|sleep/.test(value)) return 'health';
    return 'uncategorized';
}

export function useTaskListService(api?: PanePluginApi | null) {
    const paneApi =
        api ??
        (globalThis as { __or3PanePluginApi?: PanePluginApi }).__or3PanePluginApi ??
        null;

    async function assertPost(listId: string) {
        if (!paneApi?.posts) throw new Error('Posts API unavailable');
        const result = await paneApi.posts.get({ id: listId });
        if (!result.ok) throw new Error(result.message);
        return result.post;
    }

    function readMeta(meta: unknown): TaskListMetaV1 {
        if (!meta || typeof meta !== 'object') return defaultMeta();
        const record = meta as Partial<TaskListMetaV1>;
        return {
            schema_version: 1,
            sort_mode: (record.sort_mode as SortMode) ?? 'manual',
            tasks: Array.isArray(record.tasks) ? (record.tasks as TaskItem[]) : [],
            last_ai_analysis_at:
                typeof record.last_ai_analysis_at === 'number' ? record.last_ai_analysis_at : null,
            ai_fallback_notice:
                typeof record.ai_fallback_notice === 'string' ? record.ai_fallback_notice : null,
        };
    }

    async function updateMetaAtomic(
        listId: string,
        updater: (meta: TaskListMetaV1) => TaskListMetaV1
    ): Promise<TaskListMetaV1> {
        const post = await assertPost(listId);
        const previous = readMeta(post.meta);
        const next = updater(structuredClone(previous));
        const result = await paneApi!.posts.update({
            id: listId,
            patch: { meta: next },
            source: 'tasks-pane:meta-update',
        });
        if (!result.ok) throw new Error(result.message);
        return next;
    }

    async function loadOrCreateDefaultList(): Promise<{ id: string; title: string; meta: TaskListMetaV1 }> {
        if (!paneApi?.posts) throw new Error('Posts API unavailable');
        const result = await paneApi.posts.listByType({ postType: TASK_LIST_POST_TYPE, limit: 1 });
        if (result.ok && result.posts.length > 0) {
            const post = result.posts[0];
            if (!post) throw new Error('Task list not found');
            return { id: post.id, title: post.title || 'My Tasks', meta: readMeta(post.meta) };
        }
        const created = await paneApi.posts.create({
            postType: TASK_LIST_POST_TYPE,
            title: 'My Tasks',
            meta: defaultMeta(),
            source: 'tasks-pane:create-default-list',
        });
        if (!created.ok) throw new Error(created.message);
        return { id: created.id, title: 'My Tasks', meta: defaultMeta() };
    }

    async function createList(title: string) {
        if (!paneApi?.posts) throw new Error('Posts API unavailable');
        const created = await paneApi.posts.create({
            postType: TASK_LIST_POST_TYPE,
            title: title.trim() || 'Untitled Tasks',
            meta: defaultMeta(),
            source: 'tasks-pane:create-list',
        });
        if (!created.ok) throw new Error(created.message);
        return created.id;
    }

    async function renameList(listId: string, title: string) {
        if (!paneApi?.posts) throw new Error('Posts API unavailable');
        const nextTitle = title.trim();
        if (!nextTitle) throw new Error('Title is required');
        const result = await paneApi.posts.update({
            id: listId,
            patch: { title: nextTitle },
            source: 'tasks-pane:rename-list',
        });
        if (!result.ok) throw new Error(result.message);
    }

    async function deleteList(listId: string) {
        if (!paneApi?.posts) throw new Error('Posts API unavailable');
        const result = await paneApi.posts.delete({
            id: listId,
            source: 'tasks-pane:delete-list',
        });
        if (!result.ok) throw new Error(result.message);
    }

    async function addTask(
        listId: string,
        input: { title: string; notes?: string; due_at?: number | null }
    ): Promise<TaskItem> {
        const timestamp = now();
        let created!: TaskItem;
        await updateMetaAtomic(listId, (meta) => {
            const nextOrder = meta.tasks.length + 1;
            created = {
                id: makeId('task'),
                title: input.title.trim(),
                notes: input.notes?.trim() ?? '',
                status: 'todo',
                order: nextOrder,
                due_at: normalizeDueAt(input.due_at),
                due_notified_at: null,
                label: inferLocalLabel(input.title),
                label_source: 'ai',
                difficulty_score: null,
                difficulty_reason: null,
                subtasks: [],
                created_at: timestamp,
                updated_at: timestamp,
            };
            meta.tasks.push(created);
            return meta;
        });
        return created;
    }

    async function updateTask(
        listId: string,
        taskId: string,
        patch: Partial<TaskItem>
    ): Promise<TaskItem> {
        const timestamp = now();
        let updated: TaskItem | null = null;
        await updateMetaAtomic(listId, (meta) => {
            meta.tasks = meta.tasks.map((task) => {
                if (task.id !== taskId) return task;
                const dueAt = normalizeDueAt(
                    patch.due_at === undefined ? task.due_at : patch.due_at
                );
                const status = patch.status ?? task.status;
                const label =
                    patch.title && task.label_source !== 'manual'
                        ? inferLocalLabel(patch.title)
                        : task.label;
                const dueNotifiedAt = patch.due_notified_at ?? task.due_notified_at ?? null;

                updated = {
                    ...task,
                    ...patch,
                    status,
                    due_at: dueAt,
                    due_notified_at: dueNotifiedAt,
                    label,
                    updated_at: timestamp,
                };
                return updated as TaskItem;
            });
            return meta;
        });
        if (!updated) throw new Error('Task not found');
        return updated;
    }

    async function removeTask(listId: string, taskId: string) {
        await updateMetaAtomic(listId, (meta) => {
            meta.tasks = normalizeOrder(meta.tasks.filter((task) => task.id !== taskId));
            return meta;
        });
    }

    async function addSubtask(listId: string, taskId: string, title: string): Promise<TaskSubtask> {
        const timestamp = now();
        let created: TaskSubtask | null = null;
        await updateMetaAtomic(listId, (meta) => {
            meta.tasks = meta.tasks.map((task) => {
                if (task.id !== taskId) return task;
                created = {
                    id: makeId('subtask'),
                    title: title.trim(),
                    done: false,
                    order: task.subtasks.length + 1,
                    created_at: timestamp,
                    updated_at: timestamp,
                };
                return { ...task, subtasks: [...task.subtasks, created!] };
            });
            return meta;
        });
        if (!created) throw new Error('Task not found');
        return created;
    }

    async function removeSubtask(listId: string, taskId: string, subtaskId: string) {
        await updateMetaAtomic(listId, (meta) => {
            meta.tasks = meta.tasks.map((task) => {
                if (task.id !== taskId) return task;
                const next = task.subtasks
                    .filter((subtask) => subtask.id !== subtaskId)
                    .map((subtask, index) => ({ ...subtask, order: index + 1 }));
                return { ...task, subtasks: next };
            });
            return meta;
        });
    }

    async function toggleSubtask(listId: string, taskId: string, subtaskId: string) {
        const timestamp = now();
        let foundTask = false;
        let foundSubtask = false;

        await updateMetaAtomic(listId, (meta) => {
            meta.tasks = meta.tasks.map((task) => {
                if (task.id !== taskId) return task;
                foundTask = true;

                const subtasks = task.subtasks.map((subtask) => {
                    if (subtask.id !== subtaskId) return subtask;
                    foundSubtask = true;
                    return {
                        ...subtask,
                        done: !subtask.done,
                        updated_at: timestamp,
                    };
                });

                return { ...task, subtasks, updated_at: timestamp };
            });

            return meta;
        });

        if (!foundTask) throw new Error('Task not found');
        if (!foundSubtask) throw new Error('Subtask not found');
    }

    async function setSubtaskDone(
        listId: string,
        taskId: string,
        subtaskId: string,
        done: boolean
    ) {
        const timestamp = now();
        let foundTask = false;
        let foundSubtask = false;

        await updateMetaAtomic(listId, (meta) => {
            meta.tasks = meta.tasks.map((task) => {
                if (task.id !== taskId) return task;
                foundTask = true;

                const subtasks = task.subtasks.map((subtask) => {
                    if (subtask.id !== subtaskId) return subtask;
                    foundSubtask = true;
                    if (subtask.done === done) return subtask;
                    return {
                        ...subtask,
                        done,
                        updated_at: timestamp,
                    };
                });

                return { ...task, subtasks, updated_at: timestamp };
            });

            return meta;
        });

        if (!foundTask) throw new Error('Task not found');
        if (!foundSubtask) throw new Error('Subtask not found');
    }

    async function reorderTasks(listId: string, orderedTaskIds: string[]) {
        await updateMetaAtomic(listId, (meta) => {
            const allIds = new Set(meta.tasks.map((task) => task.id));
            if (orderedTaskIds.length !== meta.tasks.length) throw new Error('Reorder ids length mismatch');
            for (const id of orderedTaskIds) {
                if (!allIds.has(id)) throw new Error(`Unknown task id: ${id}`);
            }
            const byId = new Map(meta.tasks.map((task) => [task.id, task]));
            meta.tasks = orderedTaskIds.map((id, index) => ({ ...byId.get(id)!, order: index + 1 }));
            return meta;
        });
    }

    async function rescheduleTask(listId: string, taskId: string, dueAt: number | null) {
        await updateTask(listId, taskId, { due_at: normalizeDueAt(dueAt) });
    }

    async function sortByDifficulty(listId: string, mode: 'hardest' | 'easiest') {
        await updateMetaAtomic(listId, (meta) => {
            const direction = mode === 'hardest' ? -1 : 1;
            meta.tasks = [...meta.tasks]
                .sort((a, b) => {
                    const sa = a.difficulty_score ?? 0;
                    const sb = b.difficulty_score ?? 0;
                    if (sa !== sb) return (sa - sb) * direction;
                    return taskTieBreakComparator(a, b);
                })
                .map((task, index) => ({ ...task, order: index + 1 }));
            meta.sort_mode = mode;
            return meta;
        });
    }

    return {
        defaultMeta,
        normalizeDueAt,
        readMeta,
        updateMetaAtomic,
        createList,
        renameList,
        deleteList,
        loadOrCreateDefaultList,
        addTask,
        updateTask,
        removeTask,
        addSubtask,
        toggleSubtask,
        setSubtaskDone,
        removeSubtask,
        reorderTasks,
        rescheduleTask,
        sortByDifficulty,
    };
}
