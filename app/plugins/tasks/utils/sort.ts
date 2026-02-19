import type { TaskItem } from '../types';

export function taskTieBreakComparator(a: TaskItem, b: TaskItem): number {
    if (a.order !== b.order) return a.order - b.order;
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return a.id.localeCompare(b.id);
}

export function normalizeOrder(tasks: TaskItem[]): TaskItem[] {
    return [...tasks]
        .sort(taskTieBreakComparator)
        .map((task, index) => ({ ...task, order: index + 1 }));
}
