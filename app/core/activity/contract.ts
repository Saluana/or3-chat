import { z } from 'zod';

export const ACTIVITY_TERMINAL_STATUSES = [
    'succeeded',
    'failed',
    'cancelled',
] as const;

export const ActivityRunStatusSchema = z.enum([
    'queued',
    'running',
    'waiting_approval',
    ...ACTIVITY_TERMINAL_STATUSES,
]);

export const ActivityEventTypeSchema = z.enum([
    'status',
    'message',
    'tool',
    'approval',
    'artifact',
    'error',
    'metric',
]);

export const ActivityRunActionSchema = z.enum([
    'cancel',
    'retry',
    'approve',
    'deny',
    'open-source',
]);

export type ActivityRunStatus = z.infer<typeof ActivityRunStatusSchema>;
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;
export type ActivityRunAction = z.infer<typeof ActivityRunActionSchema>;

export type ActivityRunKind =
    | 'workflow'
    | 'background-chat'
    | 'document-ai'
    | 'external-agent'
    | (string & {});

export interface ActivityArtifact {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly href?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ActivityApproval {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly status: 'pending' | 'approved' | 'denied' | 'cancelled';
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ActivityEvent {
    readonly id: string;
    readonly sourceId: string;
    readonly runId: string;
    readonly type: ActivityEventType;
    readonly occurredAt: string;
    readonly sequence?: number;
    /**
     * Events with the same key are folded into one timeline row. Message
     * payloads may use `{ text, append: true }` to coalesce stream chunks.
     */
    readonly coalesceKey?: string;
    readonly payload: Readonly<Record<string, unknown>>;
}

export interface ActivityRunSummary {
    readonly id: string;
    readonly sourceId: string;
    readonly title: string;
    readonly kind: ActivityRunKind;
    readonly status: ActivityRunStatus;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly completedAt?: string;
    readonly summary?: string;
    readonly actions: readonly ActivityRunAction[];
}

export interface ActivityRunDetail extends ActivityRunSummary {
    readonly events: readonly ActivityEvent[];
    readonly output?: string;
    readonly artifacts?: readonly ActivityArtifact[];
    readonly approvals?: readonly ActivityApproval[];
    readonly error?: string;
}

export interface ActivityListInput {
    readonly statuses?: readonly ActivityRunStatus[];
    readonly limit?: number;
}

export interface ActivitySubscriptionInput {
    readonly runId?: string;
    readonly signal?: AbortSignal;
    readonly onEvent: (event: ActivityEvent) => void;
    readonly onError?: (error: ActivityError) => void;
}

export interface ActivityActionInput {
    readonly runId: string;
    readonly action: ActivityRunAction;
    readonly payload?: Readonly<Record<string, unknown>>;
}

export type ActivityErrorCode =
    | 'invalid_input'
    | 'duplicate_id'
    | 'source_not_found'
    | 'run_not_found'
    | 'capability_unavailable'
    | 'source_failure'
    | 'stale_event';

export interface ActivityError {
    readonly code: ActivityErrorCode;
    readonly message: string;
    readonly sourceId?: string;
    readonly runId?: string;
    readonly cause?: unknown;
}

export type ActivityResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: ActivityError };

export interface ActivitySource {
    readonly id: string;
    readonly label: string;
    readonly actions?: readonly ActivityRunAction[];
    listRuns(
        input: ActivityListInput
    ): Promise<ActivityResult<readonly ActivityRunSummary[]>>;
    getRun?(
        runId: string
    ): Promise<ActivityResult<ActivityRunDetail>>;
    subscribe?(input: ActivitySubscriptionInput): void | (() => void);
    executeAction?(
        input: ActivityActionInput
    ): Promise<ActivityResult<void>>;
}

export const ActivityEventSchema = z.object({
    id: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    type: ActivityEventTypeSchema,
    occurredAt: z.string().trim().min(1),
    sequence: z.number().int().nonnegative().optional(),
    coalesceKey: z.string().trim().min(1).optional(),
    payload: z.record(z.string(), z.unknown()),
});

export const ActivityRunSummarySchema = z.object({
    id: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    kind: z.string().trim().min(1),
    status: ActivityRunStatusSchema,
    startedAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
    completedAt: z.string().trim().min(1).optional(),
    summary: z.string().optional(),
    actions: z.array(ActivityRunActionSchema),
});

export const ActivityArtifactSchema = z.object({
    id: z.string().trim().min(1),
    kind: z.string().trim().min(1),
    label: z.string().trim().min(1),
    href: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ActivityApprovalSchema = z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().optional(),
    status: z.enum(['pending', 'approved', 'denied', 'cancelled']),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ActivityRunDetailSchema = ActivityRunSummarySchema.extend({
    events: z.array(ActivityEventSchema),
    output: z.string().optional(),
    artifacts: z.array(ActivityArtifactSchema).optional(),
    approvals: z.array(ActivityApprovalSchema).optional(),
    error: z.string().optional(),
});

export const ActivitySourceIdentitySchema = z.object({
    id: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
    label: z.string().trim().min(1).max(100),
    actions: z.array(ActivityRunActionSchema).optional(),
});

export function activityOk<T>(value: T): ActivityResult<T> {
    return { ok: true, value };
}

export function activityErr(
    error: ActivityError
): ActivityResult<never> {
    return { ok: false, error: Object.freeze({ ...error }) };
}

export function isTerminalActivityStatus(
    status: ActivityRunStatus
): boolean {
    return (ACTIVITY_TERMINAL_STATUSES as readonly string[]).includes(status);
}
