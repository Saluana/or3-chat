import {
    InternClientError,
    InternUnavailableError,
} from './errors';
import {
    parseInternActionAcknowledgement,
    parseInternApprovalDecision,
    parseInternApprovalList,
    parseInternArtifact,
    parseInternCapabilities,
    parseInternEvent,
    parseInternEventList,
    parseInternHealth,
    parseInternPairResult,
    parseInternReadiness,
    parseInternRecord,
    parseInternRunnerList,
    parseInternSession,
    parseInternSessionList,
    parseInternStartedTurn,
    parseInternTurn,
    parseInternTurnDecision,
    parseInternTurnList,
    type CreateInternSessionInput,
    type InternActionAcknowledgement,
    type InternApprovalDecision,
    type InternApprovalDecisionAction,
    type InternApprovalInput,
    type InternApprovalList,
    type InternArtifact,
    type InternCapabilities,
    type InternEvent,
    type InternEventList,
    type InternHealth,
    type InternPairInput,
    type InternPairResult,
    type InternReadiness,
    type InternRunner,
    type InternRunnerList,
    type InternSession,
    type InternSessionList,
    type InternStartedTurn,
    type InternTurn,
    type InternTurnDecision,
    type InternTurnDecisionAction,
    type InternTurnList,
    type StartInternTurnInput,
    type UnknownRecord,
} from './protocol';
import type { InternSseEvent } from './sse';
import {
    createInternTransport,
    type InternRequestOptions,
    type InternStreamOptions,
    type InternTransport,
    type InternTransportOptions,
} from './transport';

export type InternCallOptions = Omit<
    InternRequestOptions<never>,
    | 'method'
    | 'body'
    | 'responseType'
    | 'acceptedStatuses'
    | 'parse'
>;

export interface InternCapabilitiesInput {
    channel?: string;
    trigger?: string;
}

export interface InternTurnListInput {
    limit?: number;
}

export interface InternSessionListInput {
    appSessionKeyPrefix?: string;
    limit?: number;
}

export interface InternEventListInput {
    afterSeq?: number;
    limit?: number;
}

export interface InternArtifactInput {
    sessionKey: string;
    offset?: number;
    maxBytes?: number;
}

export interface InternApprovalListInput {
    status?: string;
    type?: string;
}

export interface InternTurnStreamOptions
    extends Omit<
        InternStreamOptions<UnknownRecord>,
        'method' | 'body' | 'resume' | 'isTerminal'
    > {
    afterSeq?: number;
}

export type InternTurnStreamEvent = InternSseEvent<
    InternEvent | UnknownRecord
>;

export interface InternClient {
    readonly transport: InternTransport;
    health(options?: InternCallOptions): Promise<InternHealth>;
    readiness(options?: InternCallOptions): Promise<InternReadiness>;
    capabilities(
        input?: InternCapabilitiesInput,
        options?: InternCallOptions
    ): Promise<InternCapabilities>;
    appBootstrap(options?: InternCallOptions): Promise<UnknownRecord>;
    listRunners(options?: InternCallOptions): Promise<InternRunnerList>;
    requireRunner(
        runnerId: string,
        options?: InternCallOptions
    ): Promise<InternRunner>;
    listSessions(
        input?: InternSessionListInput,
        options?: InternCallOptions
    ): Promise<InternSessionList>;
    createSession(
        input: CreateInternSessionInput,
        options?: InternCallOptions
    ): Promise<InternSession>;
    getSession(
        sessionId: string,
        options?: InternCallOptions
    ): Promise<InternSession>;
    listTurns(
        sessionId: string,
        input?: InternTurnListInput,
        options?: InternCallOptions
    ): Promise<InternTurnList>;
    startTurn(
        sessionId: string,
        input: StartInternTurnInput,
        options?: InternCallOptions
    ): Promise<InternStartedTurn>;
    getTurn(
        sessionId: string,
        turnId: string,
        options?: InternCallOptions
    ): Promise<InternTurn>;
    listTurnEvents(
        sessionId: string,
        turnId: string,
        input?: InternEventListInput,
        options?: InternCallOptions
    ): Promise<InternEventList>;
    streamTurn(
        sessionId: string,
        turnId: string,
        options?: InternTurnStreamOptions
    ): AsyncIterable<InternTurnStreamEvent>;
    abortTurn(
        sessionId: string,
        turnId: string,
        options?: InternCallOptions
    ): Promise<InternActionAcknowledgement>;
    decideTurn(
        sessionId: string,
        turnId: string,
        decision: InternTurnDecisionAction,
        input?: InternApprovalInput,
        options?: InternCallOptions
    ): Promise<InternTurnDecision>;
    readArtifact(
        artifactId: string,
        input: InternArtifactInput,
        options?: InternCallOptions
    ): Promise<InternArtifact>;
    listApprovals(
        input?: InternApprovalListInput,
        options?: InternCallOptions
    ): Promise<InternApprovalList>;
    decideApproval(
        requestId: string | number,
        decision: InternApprovalDecisionAction,
        input?: InternApprovalInput,
        options?: InternCallOptions
    ): Promise<InternApprovalDecision>;
    pair(
        input: InternPairInput,
        options?: InternCallOptions
    ): Promise<InternPairResult>;
}

function pathId(value: string | number, label: string): string {
    const normalized = String(value).trim();
    if (!normalized) {
        throw new InternClientError(
            'validation_failed',
            `${label} is required.`
        );
    }
    return encodeURIComponent(normalized);
}

function queryPath(
    path: string,
    values: Record<string, string | number | boolean | undefined>
): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== '') {
            query.set(key, String(value));
        }
    }
    const encoded = query.toString();
    return encoded ? `${path}?${encoded}` : path;
}

function positiveInteger(
    value: number | undefined,
    label: string
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new InternClientError(
            'validation_failed',
            `${label} must be a positive integer.`
        );
    }
    return value;
}

function boundedPositiveInteger(
    value: number | undefined,
    label: string,
    maximum: number
): number | undefined {
    const normalized = positiveInteger(value, label);
    if (normalized !== undefined && normalized > maximum) {
        throw new InternClientError(
            'validation_failed',
            `${label} must not exceed ${maximum}.`
        );
    }
    return normalized;
}

function appSessionKeyPrefix(
    value: string | undefined
): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (
        !normalized ||
        new TextEncoder().encode(normalized).byteLength > 256 ||
        /[\0\r\n]/.test(normalized)
    ) {
        throw new InternClientError(
            'validation_failed',
            'App session key prefix is invalid.'
        );
    }
    return normalized;
}

function nonNegativeInteger(
    value: number | undefined,
    label: string
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new InternClientError(
            'validation_failed',
            `${label} must be a non-negative integer.`
        );
    }
    return value;
}

function sessionPath(sessionId: string): string {
    return `/internal/v1/runner-chat/sessions/${pathId(
        sessionId,
        'Session ID'
    )}`;
}

function turnPath(sessionId: string, turnId: string): string {
    return `${sessionPath(sessionId)}/turns/${pathId(turnId, 'Turn ID')}`;
}

function parseTurnStreamEvent(
    event: InternSseEvent<UnknownRecord>
): InternTurnStreamEvent {
    if (event.json === undefined) {
        return event as InternTurnStreamEvent;
    }
    let json: InternEvent | UnknownRecord;
    if (
        typeof event.json.turn_id === 'string' &&
        typeof event.json.seq === 'number'
    ) {
        json = parseInternEvent(event.json);
    } else {
        json = parseInternRecord(event.json, 'streamEvent');
    }
    return { ...event, json };
}

export function findInternRunner(
    list: InternRunnerList,
    runnerId: string
): InternRunner {
    const normalized = runnerId.trim();
    const runner = list.runners.find((item) => item.id === normalized);
    if (!runner) {
        throw new InternUnavailableError(
            `Runner ${normalized || '(missing)'} is not advertised by the selected host.`,
            { capability: `runner:${normalized || 'unknown'}` }
        );
    }
    return runner;
}

export function requireInternRunner(
    list: InternRunnerList,
    runnerId: string
): InternRunner {
    const runner = findInternRunner(list, runnerId);
    if (runner.status !== 'available') {
        throw new InternUnavailableError(
            `Runner ${runner.id} is advertised but is not available (${runner.status || 'unknown status'}).`,
            {
                capability: `runner:${runner.id}`,
                details: {
                    runnerId: runner.id,
                    status: runner.status,
                    authStatus: runner.auth_status,
                },
            }
        );
    }
    return runner;
}

export function createInternClient(
    options: InternTransportOptions
): InternClient {
    const transport = createInternTransport(options);

    const health = (callOptions: InternCallOptions = {}) =>
        transport.request('/internal/v1/health', {
            ...callOptions,
            method: 'GET',
            parse: parseInternHealth,
        });

    const readiness = (callOptions: InternCallOptions = {}) =>
        transport.request('/internal/v1/readiness', {
            ...callOptions,
            method: 'GET',
            acceptedStatuses: [503],
            parse: parseInternReadiness,
        });

    const capabilities = (
        input: InternCapabilitiesInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            queryPath('/internal/v1/capabilities', {
                channel: input.channel,
                trigger: input.trigger,
            }),
            {
                ...callOptions,
                method: 'GET',
                parse: parseInternCapabilities,
            }
        );

    const appBootstrap = (callOptions: InternCallOptions = {}) =>
        transport.request('/internal/v1/app/bootstrap', {
            ...callOptions,
            method: 'GET',
            parse: (value) => parseInternRecord(value, 'appBootstrap'),
        });

    const listRunners = (callOptions: InternCallOptions = {}) =>
        transport.request('/internal/v1/chat-runners', {
            ...callOptions,
            method: 'GET',
            parse: parseInternRunnerList,
        });

    const requireRunner = async (
        runnerId: string,
        callOptions: InternCallOptions = {}
    ) => requireInternRunner(await listRunners(callOptions), runnerId);

    const listSessions = async (
        input: InternSessionListInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            queryPath('/internal/v1/runner-chat/sessions', {
                app_session_key_prefix: appSessionKeyPrefix(
                    input.appSessionKeyPrefix
                ),
                limit: boundedPositiveInteger(
                    input.limit,
                    'Session limit',
                    100
                ),
            }),
            {
                ...callOptions,
                method: 'GET',
                parse: parseInternSessionList,
            }
        );

    const createSession = (
        input: CreateInternSessionInput,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request('/internal/v1/runner-chat/sessions', {
            ...callOptions,
            method: 'POST',
            body: input,
            parse: parseInternSession,
        });

    const getSession = async (
        sessionId: string,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(sessionPath(sessionId), {
            ...callOptions,
            method: 'GET',
            parse: parseInternSession,
        });

    const listTurns = async (
        sessionId: string,
        input: InternTurnListInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            queryPath(`${sessionPath(sessionId)}/turns`, {
                limit: boundedPositiveInteger(
                    input.limit,
                    'Turn limit',
                    100
                ),
            }),
            {
                ...callOptions,
                method: 'GET',
                parse: parseInternTurnList,
            }
        );

    const startTurn = async (
        sessionId: string,
        input: StartInternTurnInput,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(`${sessionPath(sessionId)}/turns`, {
            ...callOptions,
            method: 'POST',
            body: input,
            parse: parseInternStartedTurn,
        });

    const getTurn = async (
        sessionId: string,
        turnId: string,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(turnPath(sessionId, turnId), {
            ...callOptions,
            method: 'GET',
            parse: parseInternTurn,
        });

    const listTurnEvents = async (
        sessionId: string,
        turnId: string,
        input: InternEventListInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            queryPath(`${turnPath(sessionId, turnId)}/events`, {
                after_seq: nonNegativeInteger(
                    input.afterSeq,
                    'Event cursor'
                ),
                limit: boundedPositiveInteger(
                    input.limit,
                    'Event limit',
                    1000
                ),
            }),
            {
                ...callOptions,
                method: 'GET',
                parse: parseInternEventList,
            }
        );

    async function* streamTurn(
        sessionId: string,
        turnId: string,
        streamOptions: InternTurnStreamOptions = {}
    ): AsyncIterable<InternTurnStreamEvent> {
        const { afterSeq, ...transportOptions } = streamOptions;
        const stream = transport.stream<UnknownRecord>(
            `${turnPath(sessionId, turnId)}/stream`,
            {
                ...transportOptions,
                method: 'GET',
                reconnect: transportOptions.reconnect ?? true,
                dedupe: transportOptions.dedupe ?? true,
                resume: {
                    initialCursor: nonNegativeInteger(
                        afterSeq,
                        'Event cursor'
                    ),
                    queryParameter: 'after_seq',
                    cursorFromEvent: (event) => {
                        const seq = event.json?.seq;
                        return typeof seq === 'string' ||
                            typeof seq === 'number'
                            ? seq
                            : undefined;
                    },
                },
                isTerminal: (event) => event.event === 'done',
            }
        );
        for await (const event of stream) {
            yield parseTurnStreamEvent(event);
        }
    }

    const abortTurn = async (
        sessionId: string,
        turnId: string,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(`${turnPath(sessionId, turnId)}/abort`, {
            ...callOptions,
            method: 'POST',
            parse: parseInternActionAcknowledgement,
        });

    const decideTurn = async (
        sessionId: string,
        turnId: string,
        decision: InternTurnDecisionAction,
        input: InternApprovalInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            `${turnPath(sessionId, turnId)}/${decision}`,
            {
                ...callOptions,
                method: 'POST',
                body: {
                    note: input.note,
                    allow_session: input.allow_session,
                },
                parse: parseInternTurnDecision,
            }
        );

    const readArtifact = async (
        artifactId: string,
        input: InternArtifactInput,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            queryPath(
                `/internal/v1/artifacts/${pathId(
                    artifactId,
                    'Artifact ID'
                )}`,
                {
                    session_key: input.sessionKey,
                    offset: nonNegativeInteger(
                        input.offset,
                        'Artifact offset'
                    ),
                    max_bytes: positiveInteger(
                        input.maxBytes,
                        'Artifact byte limit'
                    ),
                }
            ),
            {
                ...callOptions,
                method: 'GET',
                parse: parseInternArtifact,
            }
        );

    const listApprovals = (
        input: InternApprovalListInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            queryPath('/internal/v1/approvals', {
                status: input.status,
                type: input.type,
            }),
            {
                ...callOptions,
                method: 'GET',
                parse: parseInternApprovalList,
            }
        );

    const decideApproval = async (
        requestId: string | number,
        decision: InternApprovalDecisionAction,
        input: InternApprovalInput = {},
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            `/internal/v1/approvals/${pathId(
                requestId,
                'Approval request ID'
            )}/${decision}`,
            {
                ...callOptions,
                method: 'POST',
                body:
                    decision === 'approve'
                        ? { note: input.note, allowlist: input.allowlist }
                        : { note: input.note },
                parse: parseInternApprovalDecision,
            }
        );

    const pair = (
        input: InternPairInput,
        callOptions: InternCallOptions = {}
    ) =>
        transport.request(
            '/internal/v1/secure-connections/pairing/approve',
            {
                ...callOptions,
                method: 'POST',
                body: input,
                requireAuth: false,
                parse: parseInternPairResult,
            }
        );

    return {
        transport,
        health,
        readiness,
        capabilities,
        appBootstrap,
        listRunners,
        requireRunner,
        listSessions,
        createSession,
        getSession,
        listTurns,
        startTurn,
        getTurn,
        listTurnEvents,
        streamTurn,
        abortTurn,
        decideTurn,
        readArtifact,
        listApprovals,
        decideApproval,
        pair,
    };
}
