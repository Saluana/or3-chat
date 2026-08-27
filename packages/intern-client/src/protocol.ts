export type UnknownRecord = Record<string, unknown>;

export class InternProtocolError extends Error {
    readonly code = 'protocol';
    readonly path: string;

    constructor(path: string, message: string) {
        super(`${path}: ${message}`);
        this.name = 'InternProtocolError';
        this.path = path;
    }
}

export interface InternHealth extends UnknownRecord {
    status: string;
    runtimeAvailable: boolean;
    jobRegistryAvailable: boolean;
    approvalBrokerAvailable: boolean;
    processId: number;
    startedAt: string;
}

export interface InternReadiness extends UnknownRecord {
    status: string;
    ready: boolean;
    summary?: UnknownRecord;
    findings?: unknown[];
}

export interface InternCapabilities extends UnknownRecord {
    runtimeProfile: string;
    hosted: boolean;
    hostId: string;
    approvalBroker: UnknownRecord;
    approvals: Record<string, string>;
    execAvailable: boolean;
    sandboxEnabled: boolean;
    sandboxRequired: boolean;
    networkPolicy: UnknownRecord;
}

export interface InternRunner extends UnknownRecord {
    id: string;
    display_name: string;
    status: string;
    auth_status: string;
    supports: UnknownRecord;
    chat_capabilities?: UnknownRecord;
}

export interface InternRunnerList extends UnknownRecord {
    runners: InternRunner[];
    default_runner?: string;
}

export interface InternSession extends UnknownRecord {
    id: string;
    app_session_key: string;
    runner_id: string;
    continuation_mode: string;
    created_at: number;
    updated_at: number;
    native_session_ref?: string;
    model?: string;
    mode?: string;
    isolation?: string;
    cwd?: string;
    max_turns?: number;
    meta?: unknown;
}

export interface InternSessionList extends UnknownRecord {
    sessions: InternSession[];
}

export interface InternTurn extends UnknownRecord {
    id: string;
    session_id: string;
    sequence: number;
    status: string;
    continuation_mode: string;
    requested_at: number;
    started_at?: number;
    completed_at?: number;
    user_message?: string;
    final_text?: string;
    error?: string;
    runner_run_id?: string;
    runner_job_id?: string;
    user_message_id?: number;
    assistant_message_id?: number;
    model?: string;
    mode?: string;
    isolation?: string;
    cwd?: string;
}

export interface InternEvent extends UnknownRecord {
    id: number;
    turn_id: string;
    seq: number;
    ts: number;
    type: string;
    stream?: string;
    text?: string;
    job_id?: string;
    payload?: unknown;
}

export interface InternApprovalDecision extends UnknownRecord {
    request_id: number;
    status?: string;
    token?: string;
    allowlist_id?: number;
    session_key?: string;
}

export interface InternTurnList extends UnknownRecord {
    turns: InternTurn[];
}

export interface InternEventList extends UnknownRecord {
    events: InternEvent[];
}

export interface InternStartedTurn extends UnknownRecord {
    session_id: string;
    turn_id: string;
    job_id: string;
    status: string;
}

export interface InternActionAcknowledgement extends UnknownRecord {
    status: string;
}

export interface InternTurnDecision extends UnknownRecord {
    status: string;
    decision: string;
    route?: string;
    approval_id?: number;
    native_continued?: boolean;
    fallback_to_token?: boolean;
    allowlist_session?: boolean;
    allowlist_id?: number;
    token?: string;
}

export interface InternArtifact extends UnknownRecord {
    id: string;
    mime: string;
    size_bytes: number;
    offset: number;
    read_bytes: number;
    truncated: boolean;
    content: string;
}

export interface InternApproval extends UnknownRecord {
    id: string | number;
    type: string;
    status: string;
    requested_at: number;
    expires_at?: number;
    resolved_at?: number;
    preview?: string;
}

export interface InternApprovalList extends UnknownRecord {
    items: InternApproval[];
}

export interface InternPairResult extends UnknownRecord {
    certificate: UnknownRecord;
    certificate_hash: string;
    device: UnknownRecord;
}

export interface CreateInternSessionInput {
    app_session_key: string;
    runner_id: string;
    continuation_mode?: string;
    model?: string;
    mode?: string;
    isolation?: string;
    cwd?: string;
    max_turns?: number;
    approval_autopilot?: boolean;
}

export interface StartInternTurnInput {
    user_message: string;
    attachments?: UnknownRecord[];
    continuation_mode?: string;
    model?: string;
    mode?: string;
    isolation?: string;
    cwd?: string;
    max_turns?: number;
    timeout_seconds?: number;
    meta?: UnknownRecord;
    thinking_level?: string;
    approval_token?: string;
    approval_autopilot?: boolean;
    runner_permission?: {
        runner_id: string;
        kind: string;
        access: string;
        target_path?: string;
    };
}

export interface InternApprovalInput {
    note?: string;
    allow_session?: boolean;
    allowlist?: boolean;
}

export interface InternPairInput {
    rendezvous_id: string;
    pairing_secret: string;
    proposal: UnknownRecord;
    trust_level: string;
    expires_at?: number;
}

export type InternTurnDecisionAction = 'approve' | 'reject' | 'cancel';
export type InternApprovalDecisionAction = 'approve' | 'deny' | 'cancel';

function record(value: unknown, path: string): UnknownRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new InternProtocolError(path, 'expected an object');
    }
    return value as UnknownRecord;
}

function stringAt(
    input: UnknownRecord,
    key: string,
    path: string
): string {
    const value = input[key];
    if (typeof value !== 'string') {
        throw new InternProtocolError(`${path}.${key}`, 'expected a string');
    }
    return value;
}

function numberAt(
    input: UnknownRecord,
    key: string,
    path: string
): number {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new InternProtocolError(`${path}.${key}`, 'expected a finite number');
    }
    return value;
}

function booleanAt(
    input: UnknownRecord,
    key: string,
    path: string
): boolean {
    const value = input[key];
    if (typeof value !== 'boolean') {
        throw new InternProtocolError(`${path}.${key}`, 'expected a boolean');
    }
    return value;
}

function optionalString(
    input: UnknownRecord,
    key: string,
    path: string
): string | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new InternProtocolError(`${path}.${key}`, 'expected a string');
    }
    return value;
}

function optionalNumber(
    input: UnknownRecord,
    key: string,
    path: string
): number | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new InternProtocolError(`${path}.${key}`, 'expected a finite number');
    }
    return value;
}

function optionalBoolean(
    input: UnknownRecord,
    key: string,
    path: string
): boolean | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        throw new InternProtocolError(`${path}.${key}`, 'expected a boolean');
    }
    return value;
}

export function parseInternRecord(
    value: unknown,
    path = 'response'
): UnknownRecord {
    return { ...record(value, path) };
}

export function parseInternHealth(value: unknown): InternHealth {
    const input = record(value, 'health');
    return {
        ...input,
        status: stringAt(input, 'status', 'health'),
        runtimeAvailable: booleanAt(input, 'runtimeAvailable', 'health'),
        jobRegistryAvailable: booleanAt(
            input,
            'jobRegistryAvailable',
            'health'
        ),
        approvalBrokerAvailable: booleanAt(
            input,
            'approvalBrokerAvailable',
            'health'
        ),
        processId: numberAt(input, 'processId', 'health'),
        startedAt: stringAt(input, 'startedAt', 'health'),
    };
}

export function parseInternReadiness(value: unknown): InternReadiness {
    const input = record(value, 'readiness');
    const findings = input.findings;
    if (findings !== undefined && !Array.isArray(findings)) {
        throw new InternProtocolError(
            'readiness.findings',
            'expected an array'
        );
    }
    return {
        ...input,
        status: stringAt(input, 'status', 'readiness'),
        ready: booleanAt(input, 'ready', 'readiness'),
        summary:
            input.summary === undefined
                ? undefined
                : record(input.summary, 'readiness.summary'),
        findings,
    };
}

export function parseInternCapabilities(
    value: unknown
): InternCapabilities {
    const input = record(value, 'capabilities');
    const approvalInput = record(input.approvals, 'capabilities.approvals');
    const approvals: Record<string, string> = {};
    for (const [key, item] of Object.entries(approvalInput)) {
        if (typeof item !== 'string') {
            throw new InternProtocolError(
                `capabilities.approvals.${key}`,
                'expected a string'
            );
        }
        approvals[key] = item;
    }
    return {
        ...input,
        runtimeProfile: stringAt(input, 'runtimeProfile', 'capabilities'),
        hosted: booleanAt(input, 'hosted', 'capabilities'),
        hostId: stringAt(input, 'hostId', 'capabilities'),
        approvalBroker: record(
            input.approvalBroker,
            'capabilities.approvalBroker'
        ),
        approvals,
        execAvailable: booleanAt(input, 'execAvailable', 'capabilities'),
        sandboxEnabled: booleanAt(input, 'sandboxEnabled', 'capabilities'),
        sandboxRequired: booleanAt(input, 'sandboxRequired', 'capabilities'),
        networkPolicy: record(
            input.networkPolicy,
            'capabilities.networkPolicy'
        ),
    };
}

export function parseInternRunnerList(value: unknown): InternRunnerList {
    const input = record(value, 'runnerList');
    if (!Array.isArray(input.runners)) {
        throw new InternProtocolError('runnerList.runners', 'expected an array');
    }
    const runners = input.runners.map((item, index) => {
        const runner = record(item, `runnerList.runners[${index}]`);
        return {
            ...runner,
            id: stringAt(runner, 'id', `runnerList.runners[${index}]`),
            display_name: stringAt(
                runner,
                'display_name',
                `runnerList.runners[${index}]`
            ),
            status: stringAt(
                runner,
                'status',
                `runnerList.runners[${index}]`
            ),
            auth_status: stringAt(
                runner,
                'auth_status',
                `runnerList.runners[${index}]`
            ),
            supports: record(
                runner.supports,
                `runnerList.runners[${index}].supports`
            ),
            chat_capabilities:
                runner.chat_capabilities === undefined
                    ? undefined
                    : record(
                          runner.chat_capabilities,
                          `runnerList.runners[${index}].chat_capabilities`
                      ),
        };
    });
    return {
        ...input,
        runners,
        default_runner: optionalString(
            input,
            'default_runner',
            'runnerList'
        ),
    };
}

export function parseInternSession(value: unknown): InternSession {
    const input = record(value, 'session');
    return {
        ...input,
        id: stringAt(input, 'id', 'session'),
        app_session_key: stringAt(input, 'app_session_key', 'session'),
        runner_id: stringAt(input, 'runner_id', 'session'),
        continuation_mode: stringAt(
            input,
            'continuation_mode',
            'session'
        ),
        created_at: numberAt(input, 'created_at', 'session'),
        updated_at: numberAt(input, 'updated_at', 'session'),
        native_session_ref: optionalString(
            input,
            'native_session_ref',
            'session'
        ),
        model: optionalString(input, 'model', 'session'),
        mode: optionalString(input, 'mode', 'session'),
        isolation: optionalString(input, 'isolation', 'session'),
        cwd: optionalString(input, 'cwd', 'session'),
        max_turns: optionalNumber(input, 'max_turns', 'session'),
        meta: input.meta,
    };
}

export function parseInternSessionList(value: unknown): InternSessionList {
    const input = record(value, 'sessionList');
    if (!Array.isArray(input.sessions)) {
        throw new InternProtocolError(
            'sessionList.sessions',
            'expected an array'
        );
    }
    return {
        ...input,
        sessions: input.sessions.map(parseInternSession),
    };
}

export function parseInternTurn(value: unknown): InternTurn {
    const input = record(value, 'turn');
    return {
        ...input,
        id: stringAt(input, 'id', 'turn'),
        session_id: stringAt(input, 'session_id', 'turn'),
        sequence: numberAt(input, 'sequence', 'turn'),
        status: stringAt(input, 'status', 'turn'),
        continuation_mode: stringAt(input, 'continuation_mode', 'turn'),
        requested_at: numberAt(input, 'requested_at', 'turn'),
        started_at: optionalNumber(input, 'started_at', 'turn'),
        completed_at: optionalNumber(input, 'completed_at', 'turn'),
        user_message: optionalString(input, 'user_message', 'turn'),
        final_text: optionalString(input, 'final_text', 'turn'),
        error: optionalString(input, 'error', 'turn'),
        runner_run_id: optionalString(input, 'runner_run_id', 'turn'),
        runner_job_id: optionalString(input, 'runner_job_id', 'turn'),
        user_message_id: optionalNumber(input, 'user_message_id', 'turn'),
        assistant_message_id: optionalNumber(
            input,
            'assistant_message_id',
            'turn'
        ),
        model: optionalString(input, 'model', 'turn'),
        mode: optionalString(input, 'mode', 'turn'),
        isolation: optionalString(input, 'isolation', 'turn'),
        cwd: optionalString(input, 'cwd', 'turn'),
    };
}

export function parseInternEvent(value: unknown): InternEvent {
    const input = record(value, 'event');
    return {
        ...input,
        id: numberAt(input, 'id', 'event'),
        turn_id: stringAt(input, 'turn_id', 'event'),
        seq: numberAt(input, 'seq', 'event'),
        ts: numberAt(input, 'ts', 'event'),
        type: stringAt(input, 'type', 'event'),
        stream: optionalString(input, 'stream', 'event'),
        text: optionalString(input, 'text', 'event'),
        job_id: optionalString(input, 'job_id', 'event'),
        payload: input.payload,
    };
}

export function parseInternApprovalDecision(
    value: unknown
): InternApprovalDecision {
    const input = record(value, 'approvalDecision');
    return {
        ...input,
        request_id: numberAt(input, 'request_id', 'approvalDecision'),
        status: optionalString(input, 'status', 'approvalDecision'),
        token: optionalString(input, 'token', 'approvalDecision'),
        allowlist_id: optionalNumber(
            input,
            'allowlist_id',
            'approvalDecision'
        ),
        session_key: optionalString(
            input,
            'session_key',
            'approvalDecision'
        ),
    };
}

export function parseInternTurnList(value: unknown): InternTurnList {
    const input = record(value, 'turnList');
    if (!Array.isArray(input.turns)) {
        throw new InternProtocolError('turnList.turns', 'expected an array');
    }
    return {
        ...input,
        turns: input.turns.map(parseInternTurn),
    };
}

export function parseInternEventList(value: unknown): InternEventList {
    const input = record(value, 'eventList');
    if (!Array.isArray(input.events)) {
        throw new InternProtocolError('eventList.events', 'expected an array');
    }
    return {
        ...input,
        events: input.events.map(parseInternEvent),
    };
}

export function parseInternStartedTurn(value: unknown): InternStartedTurn {
    const input = record(value, 'startedTurn');
    return {
        ...input,
        session_id: stringAt(input, 'session_id', 'startedTurn'),
        turn_id: stringAt(input, 'turn_id', 'startedTurn'),
        job_id: stringAt(input, 'job_id', 'startedTurn'),
        status: stringAt(input, 'status', 'startedTurn'),
    };
}

export function parseInternActionAcknowledgement(
    value: unknown
): InternActionAcknowledgement {
    const input = record(value, 'action');
    return {
        ...input,
        status: stringAt(input, 'status', 'action'),
    };
}

export function parseInternTurnDecision(value: unknown): InternTurnDecision {
    const input = record(value, 'turnDecision');
    return {
        ...input,
        status: stringAt(input, 'status', 'turnDecision'),
        decision: stringAt(input, 'decision', 'turnDecision'),
        route: optionalString(input, 'route', 'turnDecision'),
        approval_id: optionalNumber(input, 'approval_id', 'turnDecision'),
        native_continued: optionalBoolean(
            input,
            'native_continued',
            'turnDecision'
        ),
        fallback_to_token: optionalBoolean(
            input,
            'fallback_to_token',
            'turnDecision'
        ),
        allowlist_session: optionalBoolean(
            input,
            'allowlist_session',
            'turnDecision'
        ),
        allowlist_id: optionalNumber(
            input,
            'allowlist_id',
            'turnDecision'
        ),
        token: optionalString(input, 'token', 'turnDecision'),
    };
}

export function parseInternArtifact(value: unknown): InternArtifact {
    const input = record(value, 'artifact');
    return {
        ...input,
        id: stringAt(input, 'id', 'artifact'),
        mime: stringAt(input, 'mime', 'artifact'),
        size_bytes: numberAt(input, 'size_bytes', 'artifact'),
        offset: numberAt(input, 'offset', 'artifact'),
        read_bytes: numberAt(input, 'read_bytes', 'artifact'),
        truncated: booleanAt(input, 'truncated', 'artifact'),
        content: stringAt(input, 'content', 'artifact'),
    };
}

function parseInternApproval(value: unknown, index: number): InternApproval {
    const path = `approvalList.items[${index}]`;
    const input = record(value, path);
    const id = input.id;
    if (
        (typeof id !== 'string' && typeof id !== 'number') ||
        (typeof id === 'number' && !Number.isFinite(id))
    ) {
        throw new InternProtocolError(`${path}.id`, 'expected an ID');
    }
    return {
        ...input,
        id,
        type: stringAt(input, 'type', path),
        status: stringAt(input, 'status', path),
        requested_at: numberAt(input, 'requested_at', path),
        expires_at: optionalNumber(input, 'expires_at', path),
        resolved_at: optionalNumber(input, 'resolved_at', path),
        preview: optionalString(input, 'preview', path),
    };
}

export function parseInternApprovalList(value: unknown): InternApprovalList {
    const input = record(value, 'approvalList');
    if (!Array.isArray(input.items)) {
        throw new InternProtocolError(
            'approvalList.items',
            'expected an array'
        );
    }
    return {
        ...input,
        items: input.items.map(parseInternApproval),
    };
}

export function parseInternPairResult(value: unknown): InternPairResult {
    const input = record(value, 'pairResult');
    return {
        ...input,
        certificate: record(input.certificate, 'pairResult.certificate'),
        certificate_hash: stringAt(
            input,
            'certificate_hash',
            'pairResult'
        ),
        device: record(input.device, 'pairResult.device'),
    };
}
