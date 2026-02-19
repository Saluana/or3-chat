import { onScopeDispose, getCurrentScope } from 'vue';
import { useToolRegistry } from '~/utils/chat/tools-public';
import { useTaskListService } from '../composables/useTaskListService';
import { useTaskAiActions } from '../composables/useTaskAiActions';
import { taskToolDefs } from './taskToolDefs';

function ok(data: Record<string, unknown>) {
    return JSON.stringify({ ok: true, data });
}

function fail(code: string, message: string) {
    return JSON.stringify({ ok: false, error: { code, message } });
}

export function registerTaskTools() {
    const registry = useToolRegistry();
    const service = useTaskListService();
    const ai = useTaskAiActions();

    const handlers: Record<string, (args: any) => Promise<string>> = {
        async or3_tasks_add_item(args) {
            if (!args?.title) return fail('invalid_args', 'title is required');
            const task = await service.addTask(args.listId, { title: args.title, notes: args.notes });
            return ok({ taskId: task.id });
        },
        async or3_tasks_remove_item(args) {
            await service.removeTask(args.listId, args.taskId);
            return ok({ removed: true, taskId: args.taskId });
        },
        async or3_tasks_update_item(args) {
            const task = await service.updateTask(args.listId, args.taskId, args);
            return ok({ taskId: task.id, status: task.status });
        },
        async or3_tasks_reorganize(args) {
            await service.reorderTasks(args.listId, args.orderedTaskIds);
            return ok({ reordered: true });
        },
        async or3_tasks_create_subtask(args) {
            const subtask = await service.addSubtask(args.listId, args.taskId, args.title);
            return ok({ subtaskId: subtask.id });
        },
        async or3_tasks_remove_subtask(args) {
            await service.removeSubtask(args.listId, args.taskId, args.subtaskId);
            return ok({ removed: true, subtaskId: args.subtaskId });
        },
        async or3_tasks_sort_by_difficulty(args) {
            const post = await (globalThis as any).__or3PanePluginApi?.posts?.get({ id: args.listId });
            if (!post?.ok) return fail('not_found', 'list not found');
            const meta = service.readMeta(post.post.meta);
            const analysis = await ai.analyzeDifficulty(meta.tasks);
            for (const rating of analysis.ratings) {
                await service.updateTask(args.listId, rating.task_id, {
                    difficulty_score: rating.score,
                    difficulty_reason: rating.reason,
                });
            }
            await service.sortByDifficulty(args.listId, args.mode);
            return ok({ mode: args.mode, fallback: Boolean(analysis.fallbackNotice) });
        },
    };

    taskToolDefs.forEach((def) => {
        registry.registerTool(def as any, async (args) => {
            try {
                const fn = handlers[def.function.name];
                if (!fn) return fail('unknown_tool', `No handler for ${def.function.name}`);
                return await fn(args);
            } catch (error) {
                return fail('tool_error', error instanceof Error ? error.message : 'Tool execution failed');
            }
        });
    });

    const cleanup = () => taskToolDefs.forEach((def) => registry.unregisterTool(def.function.name));
    if (getCurrentScope()) onScopeDispose(cleanup);
    if (import.meta.hot) import.meta.hot.dispose(cleanup);
    return cleanup;
}
