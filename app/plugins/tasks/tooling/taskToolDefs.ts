import { defineTool } from '~/utils/chat/tools-public';

const listIdArg = { type: 'string', description: 'Task list post id' };

export const taskToolDefs = [
    defineTool({
        type: 'function' as const,
        function: {
            name: 'or3_tasks_add_item',
            description: 'Add an item to a task list',
            parameters: {
                type: 'object' as const,
                properties: { listId: listIdArg, title: { type: 'string' }, notes: { type: 'string' } },
                required: ['listId', 'title'],
            },
        },
        ui: { label: 'Tasks: add', icon: 'pixelarticons:plus', defaultEnabled: true, category: 'Tasks' },
    }),
    defineTool({ type: 'function' as const, function: { name: 'or3_tasks_remove_item', description: 'Remove a task item', parameters: { type: 'object' as const, properties: { listId: listIdArg, taskId: { type: 'string' } }, required: ['listId', 'taskId'] } }, ui: { label: 'Tasks: remove', icon: 'pixelarticons:trash', defaultEnabled: true, category: 'Tasks' } }),
    defineTool({ type: 'function' as const, function: { name: 'or3_tasks_update_item', description: 'Update task fields', parameters: { type: 'object' as const, properties: { listId: listIdArg, taskId: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] }, due_at: { type: 'number' } }, required: ['listId', 'taskId'] } }, ui: { label: 'Tasks: update', icon: 'pixelarticons:edit', defaultEnabled: true, category: 'Tasks' } }),
    defineTool({ type: 'function' as const, function: { name: 'or3_tasks_reorganize', description: 'Reorder tasks by id list', parameters: { type: 'object' as const, properties: { listId: listIdArg, orderedTaskIds: { type: 'array', items: { type: 'string' } } }, required: ['listId', 'orderedTaskIds'] } }, ui: { label: 'Tasks: reorganize', icon: 'pixelarticons:sort', defaultEnabled: true, category: 'Tasks' } }),
    defineTool({ type: 'function' as const, function: { name: 'or3_tasks_create_subtask', description: 'Create subtask under task', parameters: { type: 'object' as const, properties: { listId: listIdArg, taskId: { type: 'string' }, title: { type: 'string' } }, required: ['listId', 'taskId', 'title'] } }, ui: { label: 'Tasks: subtask add', icon: 'pixelarticons:plus-box', defaultEnabled: true, category: 'Tasks' } }),
    defineTool({ type: 'function' as const, function: { name: 'or3_tasks_remove_subtask', description: 'Remove subtask from task', parameters: { type: 'object' as const, properties: { listId: listIdArg, taskId: { type: 'string' }, subtaskId: { type: 'string' } }, required: ['listId', 'taskId', 'subtaskId'] } }, ui: { label: 'Tasks: subtask remove', icon: 'pixelarticons:minus-box', defaultEnabled: true, category: 'Tasks' } }),
    defineTool({ type: 'function' as const, function: { name: 'or3_tasks_sort_by_difficulty', description: 'Sort tasks by AI difficulty', parameters: { type: 'object' as const, properties: { listId: listIdArg, mode: { type: 'string', enum: ['hardest', 'easiest'] } }, required: ['listId', 'mode'] } }, ui: { label: 'Tasks: difficulty sort', icon: 'pixelarticons:chart-bar', defaultEnabled: true, category: 'Tasks' } }),
] as const;
