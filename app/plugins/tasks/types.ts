export type TaskLabel = 'work' | 'home' | 'health' | 'uncategorized';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type SortMode = 'manual' | 'hardest' | 'easiest';
export type LabelSource = 'ai' | 'manual';

export interface TaskSubtask {
    id: string;
    title: string;
    done: boolean;
    order: number;
    created_at: number;
    updated_at: number;
}

export interface TaskItem {
    id: string;
    title: string;
    notes: string;
    status: TaskStatus;
    order: number;
    due_at: number | null;
    due_notified_at?: number | null;
    label: TaskLabel;
    label_source: LabelSource;
    difficulty_score: number | null;
    difficulty_reason: string | null;
    subtasks: TaskSubtask[];
    created_at: number;
    updated_at: number;
}

export interface TaskListMetaV1 {
    schema_version: 1;
    sort_mode: SortMode;
    tasks: TaskItem[];
    last_ai_analysis_at: number | null;
    ai_fallback_notice?: string | null;
}

export const TASK_LIST_POST_TYPE = 'or3-task-list';

export interface TaskToolResult<T = Record<string, unknown>> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}
