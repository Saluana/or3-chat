import { onScopeDispose, getCurrentScope } from 'vue';
import { z } from 'zod';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { TASK_LIST_POST_TYPE } from '../types';
import { useTaskListService } from '../composables/useTaskListService';
import { useTaskAiActions } from '../composables/useTaskAiActions';
import {
    buildTaskListSearchDocs,
    createTaskListSearchIndex,
    searchTaskListIndex,
} from '../utils/search';
import { taskToolDefs } from './taskToolDefs';

function ok(data: Record<string, unknown>) {
    return JSON.stringify({ ok: true, data });
}

function fail(code: string, message: string) {
    return JSON.stringify({ ok: false, error: { code, message } });
}

const createListArgsSchema = z.object({
    title: z.string().trim().min(1),
});

const updateListArgsSchema = z.object({
    listId: z.string().trim().min(1),
    title: z.string().trim().min(1),
});

const deleteListArgsSchema = z.object({
    listId: z.string().trim().min(1),
});

const addItemArgsSchema = z.object({
    listId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    notes: z.string().optional(),
});

const removeItemArgsSchema = z.object({
    listId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
});

const updateItemArgsSchema = z
    .object({
        listId: z.string().trim().min(1),
        taskId: z.string().trim().min(1),
        title: z.string().optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        due_at: z.number().finite().nullable().optional(),
    })
    .refine((value) => value.title !== undefined || value.status !== undefined || value.due_at !== undefined, {
        message: 'At least one update field is required',
    });

const reorganizeArgsSchema = z.object({
    listId: z.string().trim().min(1),
    orderedTaskIds: z.array(z.string().trim().min(1)),
});

const createSubtaskArgsSchema = z.object({
    listId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    title: z.string().trim().min(1),
});

const completeSubtaskArgsSchema = z.object({
    listId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    subtaskId: z.string().trim().min(1),
    done: z.boolean().optional(),
});

const removeSubtaskArgsSchema = z.object({
    listId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    subtaskId: z.string().trim().min(1),
});

const sortByDifficultyArgsSchema = z.object({
    listId: z.string().trim().min(1),
    mode: z.enum(['hardest', 'easiest']),
});

const searchListsArgsSchema = z.object({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(20).optional(),
});

function parseArgs<T>(schema: z.ZodType<T>, args: unknown): T {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid args');
    }
    return parsed.data;
}

function matchesSearch(task: {
    title?: string;
    notes?: string;
    subtasks?: Array<{ title?: string }>;
}, queryLower: string): boolean {
    if (!queryLower) return true;
    if ((task.title || '').toLowerCase().includes(queryLower)) return true;
    if ((task.notes || '').toLowerCase().includes(queryLower)) return true;
    return (
        Array.isArray(task.subtasks) &&
        task.subtasks.some((subtask) =>
            (subtask.title || '').toLowerCase().includes(queryLower)
        )
    );
}

export function registerTaskTools() {
    const registry = useToolRegistry();
    const service = useTaskListService();
    const ai = useTaskAiActions();

    const handlers: Record<string, (args: unknown) => Promise<string>> = {
        async or3_tasks_create_list(args) {
            const parsed = parseArgs(createListArgsSchema, args);
            const listId = await service.createList(parsed.title);
            return ok({ listId, title: parsed.title });
        },
        async or3_tasks_update_list(args) {
            const parsed = parseArgs(updateListArgsSchema, args);
            await service.renameList(parsed.listId, parsed.title);
            return ok({ listId: parsed.listId, title: parsed.title });
        },
        async or3_tasks_delete_list(args) {
            const parsed = parseArgs(deleteListArgsSchema, args);
            await service.deleteList(parsed.listId);
            return ok({ deleted: true, listId: parsed.listId });
        },
        async or3_tasks_add_item(args) {
            const parsed = parseArgs(addItemArgsSchema, args);
            const task = await service.addTask(parsed.listId, {
                title: parsed.title,
                notes: parsed.notes,
            });
            return ok({ taskId: task.id });
        },
        async or3_tasks_remove_item(args) {
            const parsed = parseArgs(removeItemArgsSchema, args);
            await service.removeTask(parsed.listId, parsed.taskId);
            return ok({ removed: true, taskId: parsed.taskId });
        },
        async or3_tasks_update_item(args) {
            const parsed = parseArgs(updateItemArgsSchema, args);
            const task = await service.updateTask(parsed.listId, parsed.taskId, {
                title: parsed.title,
                status: parsed.status,
                due_at: parsed.due_at,
            });
            return ok({ taskId: task.id, status: task.status });
        },
        async or3_tasks_reorganize(args) {
            const parsed = parseArgs(reorganizeArgsSchema, args);
            await service.reorderTasks(parsed.listId, parsed.orderedTaskIds);
            return ok({ reordered: true });
        },
        async or3_tasks_create_subtask(args) {
            const parsed = parseArgs(createSubtaskArgsSchema, args);
            const subtask = await service.addSubtask(parsed.listId, parsed.taskId, parsed.title);
            return ok({ subtaskId: subtask.id });
        },
        async or3_tasks_complete_subtask(args) {
            const parsed = parseArgs(completeSubtaskArgsSchema, args);
            const done = parsed.done ?? true;
            await service.setSubtaskDone(parsed.listId, parsed.taskId, parsed.subtaskId, done);
            return ok({ subtaskId: parsed.subtaskId, done });
        },
        async or3_tasks_remove_subtask(args) {
            const parsed = parseArgs(removeSubtaskArgsSchema, args);
            await service.removeSubtask(parsed.listId, parsed.taskId, parsed.subtaskId);
            return ok({ removed: true, subtaskId: parsed.subtaskId });
        },
        async or3_tasks_sort_by_difficulty(args) {
            const parsed = parseArgs(sortByDifficultyArgsSchema, args);
            const post = await (globalThis as any).__or3PanePluginApi?.posts?.get({ id: parsed.listId });
            if (!post?.ok) return fail('not_found', 'list not found');
            const meta = service.readMeta(post.post.meta);
            const analysis = await ai.analyzeDifficulty(meta.tasks);
            for (const rating of analysis.ratings) {
                await service.updateTask(parsed.listId, rating.task_id, {
                    difficulty_score: rating.score,
                    difficulty_reason: rating.reason,
                });
            }
            await service.sortByDifficulty(parsed.listId, parsed.mode);
            return ok({ mode: parsed.mode, fallback: Boolean(analysis.fallbackNotice) });
        },
        async or3_tasks_search_lists(args) {
            const parsed = parseArgs(searchListsArgsSchema, args);
            const queryLower = parsed.query.toLowerCase();
            const postApi = (globalThis as any).__or3PanePluginApi?.posts;
            if (!postApi) {
                return fail('unavailable', 'Posts API unavailable');
            }

            const listResponse = await postApi.listByType({
                postType: TASK_LIST_POST_TYPE,
                limit: 200,
            });
            if (!listResponse?.ok || !Array.isArray(listResponse.posts)) {
                return fail('tool_error', listResponse?.message || 'Failed to load task lists');
            }

            const docs = buildTaskListSearchDocs(
                listResponse.posts,
                service.readMeta
            );
            const index = await createTaskListSearchIndex(docs);
            if (!index) {
                return fail('unavailable', 'Task search index is unavailable');
            }

            const { ids, usedFallback } = await searchTaskListIndex(
                index,
                parsed.query,
                parsed.limit ?? 8
            );

            const postById = new Map(
                listResponse.posts.map((post: any) => [post.id, post])
            );

            const lists = ids
                .map((id) => postById.get(id))
                .filter((post: any) => Boolean(post))
                .map((post: any) => {
                    const meta = service.readMeta(post.meta);
                    const matchingTasks = meta.tasks.filter((task) =>
                        matchesSearch(task, queryLower)
                    );
                    const previewTasks = (matchingTasks.length > 0
                        ? matchingTasks
                        : meta.tasks
                    )
                        .slice(0, 8)
                        .map((task) => ({
                            id: task.id,
                            title: task.title,
                            status: task.status,
                            label: task.label,
                            due_at: task.due_at,
                            notes: task.notes || undefined,
                            subtasks: task.subtasks.slice(0, 6).map((subtask) => ({
                                id: subtask.id,
                                title: subtask.title,
                                done: subtask.done,
                            })),
                        }));

                    return {
                        listId: post.id,
                        title: post.title || 'Untitled Tasks',
                        taskCount: meta.tasks.length,
                        matchedTaskCount: matchingTasks.length,
                        tasks: previewTasks,
                    };
                });

            return ok({
                query: parsed.query,
                usedFallback,
                total: lists.length,
                lists,
            });
        },
    };

    taskToolDefs.forEach((def) => {
        registry.registerTool(
            def as any,
            async (args) => {
                try {
                    const fn = handlers[def.function.name];
                    if (!fn) {
                        return fail(
                            'unknown_tool',
                            `No handler for ${def.function.name}`
                        );
                    }
                    return await fn(args);
                } catch (error) {
                    if (error instanceof Error && /invalid|required|At least one update field/i.test(error.message)) {
                        return fail('invalid_args', error.message);
                    }
                    return fail(
                        'tool_error',
                        error instanceof Error
                            ? error.message
                            : 'Tool execution failed'
                    );
                }
            },
            { runtime: 'client' }
        );
    });

    const cleanup = () => taskToolDefs.forEach((def) => registry.unregisterTool(def.function.name));
    if (getCurrentScope()) onScopeDispose(cleanup);
    if (import.meta.hot) import.meta.hot.dispose(cleanup);
    return cleanup;
}
