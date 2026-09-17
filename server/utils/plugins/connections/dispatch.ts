/**
 * Approved-operation dispatch for plugin connections.
 *
 * Every step is a refusal path: ownership and reference are already resolved by
 * the service, then this module intersects the **release's** approved operations,
 * destinations and scopes (the signed package policy) with the stored connection
 * scopes and the acting user's permissions, requires a host-minted approval for
 * risky operations, and only then attaches the credential. Redirects are never
 * followed; responses are projected and scrubbed before plugin code sees them.
 *
 * "The provider supports this operation" is never sufficient on its own.
 */

import {
    EXCLUDED_PATH_FRAGMENTS,
    FORBIDDEN_REQUEST_HEADERS,
    HOST_INJECTABLE_CREDENTIAL_HEADERS,
    SECRET_SHAPED_BODY_KEYS,
    SENSITIVE_RESPONSE_HEADERS,
    operationRequiresApproval,
    type ApprovedConnectionOperation,
    type ConnectionDispatchDecision,
    type ConnectionDispatchPolicy,
    type ConnectionFailureCode,
    type ConnectionOperationClassification,
    type ConnectionProviderDescriptor,
    type RedactedResponse,
} from '~~/shared/plugins/connections/contracts';
import {
    checkActionApproval,
    type PluginActionKind,
} from '~~/shared/plugins/authority/action-approval';

export type ConnectionTransportRequest = {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly timeoutMs: number;
    /** Ceiling the transport enforces while it reads the response. */
    readonly maxResponseBytes: number;
    readonly redirect: 'manual';
    readonly signal?: AbortSignal;
};

export type ConnectionTransportResponse = {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
};

export type ConnectionTransport = (
    request: ConnectionTransportRequest
) => Promise<ConnectionTransportResponse>;

export type DispatchOutcome =
    | {
          readonly status: 'ok';
          readonly operationId: string;
          readonly response: RedactedResponse;
          readonly redirected: false;
      }
    | {
          readonly status: 'failed';
          readonly operationId: string;
          readonly code: ConnectionFailureCode;
          readonly message: string;
          readonly response?: RedactedResponse;
      }
    | {
          readonly status: 'denied';
          readonly operationId: string;
          readonly code: Extract<ConnectionDispatchDecision, { status: 'denied' }>['code'];
          readonly message: string;
      };

const MAX_REDIRECT_HOPS = 0;
const DEFAULT_TIMEOUT_MS = 10_000;
/** Bounded recursion for arbitrary provider JSON. */
const MAX_REDACTION_DEPTH = 8;
const MAX_REDACTION_NODES = 2_000;

/** Map a provider-declared risk onto the host approval vocabulary. */
export function approvalKindFor(
    classification: ConnectionOperationClassification
): PluginActionKind {
    switch (classification) {
        case 'commercial':
            return 'purchase';
        case 'destructive':
            return 'destructive';
        case 'access-changing':
            return 'credential-change';
        case 'external':
            return 'external-write';
        case 'read':
        default:
            return 'read';
    }
}

/** Effective classification: explicit when declared, else read-only ⇒ read. */
export function operationClassification(
    operation: ApprovedConnectionOperation
): ConnectionOperationClassification {
    return operation.classification ?? (operation.readOnly ? 'read' : 'external');
}

function normaliseHeaders(
    headers: Readonly<Record<string, string>> | undefined
): Record<string, string> {
    const normalised: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
        normalised[key.toLowerCase()] = value;
    }
    return normalised;
}

function isExcludedPath(path: string): boolean {
    const lower = path.toLowerCase();
    return EXCLUDED_PATH_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Segment-bounded path match: an approved prefix `/api/v1/models` accepts
 * `/api/v1/models` and `/api/v1/models/123`, never `/api/v1/models-anything`.
 */
export function pathMatchesApprovedPrefix(path: string, prefix: string): boolean {
    if (path === prefix) return true;
    const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return path.startsWith(base);
}

/** Release-approved operations for one provider, from the signed package policy. */
function approvedOperationsFor(
    policy: ConnectionDispatchPolicy | null | undefined,
    providerId: string
): { operations: Set<string>; scopes: Set<string>; declared: boolean } {
    if (!policy) return { operations: new Set(), scopes: new Set(), declared: false };
    const entries = policy.connections.filter((entry) => entry.provider === providerId);
    const operations = new Set<string>();
    const scopes = new Set<string>();
    for (const entry of entries) {
        for (const operation of entry.operations) operations.add(operation);
        for (const scope of entry.scopes) scopes.add(scope);
    }
    return { operations, scopes, declared: entries.length > 0 };
}

/** Choose and validate the operation, destination, method, scopes and approval. */
export function decideConnectionDispatch(input: {
    readonly provider: ConnectionProviderDescriptor;
    readonly operationId: string;
    readonly url: string;
    readonly method: string;
    readonly requestedHeaders?: Readonly<Record<string, string>>;
    readonly grantedScopes: readonly string[];
    /** Approved connection authority of the release, when available. */
    readonly policy?: ConnectionDispatchPolicy | null;
    /** Host-minted approval, when the operation requires one. */
    readonly approval?: unknown;
    readonly pluginId?: string;
    readonly workspaceId?: string;
    readonly generation?: number;
    readonly now?: () => number;
}): ConnectionDispatchDecision {
    const operation = input.provider.operations.find(
        (candidate) => candidate.id === input.operationId
    );
    if (!operation) {
        return {
            status: 'denied',
            code: 'operation-unknown',
            message: `Provider ${input.provider.id} does not declare operation ${input.operationId}`,
        };
    }

    // A capability-governed operation (for example a paid model completion) is
    // refused here so the generic path cannot become an alternate AI client.
    if (operation.governedBy) {
        return {
            status: 'denied',
            code: 'operation-not-approved',
            message: `Operation ${operation.id} is governed by ${operation.governedBy}; call that host capability instead`,
        };
    }

    // Release-approved operation intersection.
    const approved = approvedOperationsFor(input.policy, input.provider.id);
    if (approved.declared && !approved.operations.has(operation.id)) {
        return {
            status: 'denied',
            code: 'operation-not-approved',
            message: `Release does not approve operation ${operation.id} for provider ${input.provider.id}`,
        };
    }

    const method = input.method.toUpperCase();
    if (operation.method !== method) {
        return {
            status: 'denied',
            code: 'method-not-approved',
            message: `Operation ${operation.id} only allows ${operation.method}`,
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(input.url);
    } catch {
        return {
            status: 'denied',
            code: 'destination-mismatch',
            message: 'Request URL is not absolute',
        };
    }
    if (parsed.protocol !== 'https:') {
        return {
            status: 'denied',
            code: 'destination-mismatch',
            message: 'Connections only dispatch over HTTPS',
        };
    }
    // Exact origin: an alternate port is a different destination, even with the
    // same hostname.
    if (parsed.origin !== `https://${operation.host}`) {
        return {
            status: 'denied',
            code: 'destination-mismatch',
            message: `Operation ${operation.id} may only call https://${operation.host}`,
        };
    }
    if (parsed.username || parsed.password) {
        return {
            status: 'denied',
            code: 'destination-mismatch',
            message: 'Credentials in the URL are not allowed',
        };
    }
    if (!pathMatchesApprovedPrefix(parsed.pathname, operation.pathPrefix)) {
        return {
            status: 'denied',
            code: 'path-not-approved',
            message: `Operation ${operation.id} may only call ${operation.pathPrefix}`,
        };
    }
    if (isExcludedPath(parsed.pathname)) {
        return {
            status: 'denied',
            code: 'excluded-endpoint',
            message: 'Credential, debug and echo endpoints are excluded',
        };
    }

    // Declared destination intersection, when the release declares any.
    if (input.policy && input.policy.destinations.length > 0) {
        const destination = input.policy.destinations.find((entry) =>
            entry.hosts.includes(operation.host)
        );
        if (!destination) {
            return {
                status: 'denied',
                code: 'destination-mismatch',
                message: `Release does not approve destination ${operation.host}`,
            };
        }
        if (!destination.methods.includes(method)) {
            return {
                status: 'denied',
                code: 'method-not-approved',
                message: `Release does not approve ${method} for ${operation.host}`,
            };
        }
    }

    for (const scope of operation.scopes) {
        if (!input.grantedScopes.includes(scope)) {
            return {
                status: 'denied',
                code: 'scope-missing',
                message: `Connection is missing scope ${scope}`,
            };
        }
        if (approved.declared && !approved.scopes.has(scope)) {
            return {
                status: 'denied',
                code: 'scope-missing',
                message: `Release does not approve scope ${scope} for provider ${input.provider.id}`,
            };
        }
    }

    const headers = normaliseHeaders(input.requestedHeaders);
    for (const name of Object.keys(headers)) {
        if ((FORBIDDEN_REQUEST_HEADERS as readonly string[]).includes(name)) {
            return {
                status: 'denied',
                code: 'forbidden-header',
                message: `Header ${name} is controlled by the host`,
            };
        }
    }

    // Risk gate runs before the credential is decrypted or attached.
    const classification = operationClassification(operation);
    if (operationRequiresApproval(classification)) {
        const decision = checkActionApproval({
            kind: approvalKindFor(classification),
            pluginId: input.pluginId ?? '',
            workspaceId: input.workspaceId ?? '',
            generation: input.generation ?? -1,
            target: `${input.provider.id}:${operation.id}`,
            approval: input.approval,
            ...(input.now === undefined ? {} : { now: input.now }),
        });
        if (decision.status !== 'allowed') {
            return {
                status: 'denied',
                code: 'approval-required',
                message: decision.message,
            };
        }
    }

    return {
        status: 'allowed',
        operation,
        url: parsed.toString(),
        headers: { ...headers, accept: headers.accept ?? 'application/json' },
    };
}

/** Recursive, bounded secret inspection of arbitrary provider JSON. */
function findSecretShapedField(
    value: unknown,
    depth: number,
    nodes: { count: number }
): string | null {
    if (nodes.count > MAX_REDACTION_NODES || depth > MAX_REDACTION_DEPTH) {
        // Out of budget for inspection: refuse rather than pass unexamined data.
        return 'response nesting exceeds the inspection budget';
    }
    if (value === null || typeof value !== 'object') return null;
    nodes.count += 1;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findSecretShapedField(item, depth + 1, nodes);
            if (found) return found;
        }
        return null;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if ((SECRET_SHAPED_BODY_KEYS as readonly string[]).includes(key.toLowerCase())) {
            return key;
        }
        const found = findSecretShapedField(item, depth + 1, nodes);
        if (found) return found;
    }
    return null;
}

/** Drop every key the operation did not allow-list (top-level projection). */
function projectFields(
    value: unknown,
    allowed: readonly string[] | undefined
): unknown {
    if (!allowed || allowed.length === 0) return value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const projected: Record<string, unknown> = {};
    for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            projected[key] = (value as Record<string, unknown>)[key];
        }
    }
    return projected;
}

/** Replace occurrences of the live credential with a placeholder. */
function scrubCredential(value: unknown, credential: string, depth = 0): unknown {
    if (depth > MAX_REDACTION_DEPTH) return value;
    if (typeof value === 'string') {
        if (credential.length < 8 || !value.includes(credential)) return value;
        return value.split(credential).join('[redacted]');
    }
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map((item) => scrubCredential(item, credential, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = scrubCredential(item, credential, depth + 1);
    }
    return out;
}

/**
 * Redact a provider response: allowlist headers, project the body onto the
 * operation's declared fields, recursively refuse credential-shaped keys, and
 * scrub any occurrence of the live credential from diagnostic text.
 */
export function redactConnectionResponse(input: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly maxResponseBytes: number;
    /** Credential in play, so an echo of it can never reach the plugin. */
    readonly credential?: string;
    /** Header names the operation may expose; anything else is dropped. */
    readonly allowedHeaders?: readonly string[];
    /** Top-level body fields the operation may expose. */
    readonly allowedFields?: readonly string[];
}): { readonly ok: true; readonly response: RedactedResponse } | { readonly ok: false; readonly code: ConnectionFailureCode; readonly message: string } {
    if (Buffer.byteLength(input.body, 'utf8') > input.maxResponseBytes) {
        return {
            ok: false,
            code: 'response-too-large',
            message: `Provider response exceeds ${input.maxResponseBytes} bytes`,
        };
    }

    const removedHeaders: string[] = [];
    const headers: Record<string, string> = {};
    const allowlist = input.allowedHeaders?.map((name) => name.toLowerCase());
    for (const [key, value] of Object.entries(input.headers)) {
        const lower = key.toLowerCase();
        // Sensitive headers are always dropped; an allowlist narrows further.
        if ((SENSITIVE_RESPONSE_HEADERS as readonly string[]).includes(lower)) {
            removedHeaders.push(lower);
            continue;
        }
        if (allowlist) {
            if (!allowlist.includes(lower)) {
                removedHeaders.push(lower);
                continue;
            }
        } else if (lower.startsWith('x-')) {
            // Without a declared allowlist, diagnostic headers stay host-only.
            removedHeaders.push(lower);
            continue;
        }
        headers[lower] = input.credential
            ? String(scrubCredential(value, input.credential))
            : value;
    }

    let parsedBody: unknown = input.body;
    if (input.body.trim().length > 0) {
        try {
            parsedBody = JSON.parse(input.body) as unknown;
        } catch {
            parsedBody = input.body;
        }
    }

    if (parsedBody !== null && typeof parsedBody === 'object') {
        const secret = findSecretShapedField(parsedBody, 0, { count: 0 });
        if (secret) {
            return {
                ok: false,
                code: 'policy-denied',
                message: `Provider response contained a credential-shaped field (${secret})`,
            };
        }
        parsedBody = projectFields(parsedBody, input.allowedFields);
    }

    if (input.credential) {
        parsedBody = scrubCredential(parsedBody, input.credential);
    }

    return {
        ok: true,
        response: {
            status: input.status,
            headers,
            body: parsedBody,
            removedHeaders,
        },
    };
}

function classifyFailure(status: number): ConnectionFailureCode {
    if (status === 401) return 'bad-credentials';
    if (status === 403) return 'insufficient-scope';
    if (status === 429) return 'rate-limit';
    if (status >= 500) return 'provider-outage';
    return 'unknown';
}

/**
 * Execute one approved operation. The credential is injected here, after all
 * checks, and is never included in a returned value or error message.
 */
export async function dispatchApprovedConnectionOperation(input: {
    readonly provider: ConnectionProviderDescriptor;
    readonly operationId: string;
    readonly url: string;
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly grantedScopes: readonly string[];
    readonly credential: string;
    readonly credentialHeader?: string;
    readonly credentialPrefix?: string;
    readonly transport: ConnectionTransport;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** Release-approved operation/destination policy. */
    readonly policy?: ConnectionDispatchPolicy | null;
    readonly approval?: unknown;
    readonly pluginId?: string;
    readonly workspaceId?: string;
    readonly generation?: number;
    readonly now?: () => number;
}): Promise<DispatchOutcome> {
    const operation = input.provider.operations.find(
        (candidate) => candidate.id === input.operationId
    );
    const method = (input.method ?? operation?.method ?? 'GET').toUpperCase();
    const decision = decideConnectionDispatch({
        provider: input.provider,
        operationId: input.operationId,
        url: input.url,
        method,
        requestedHeaders: input.headers,
        grantedScopes: input.grantedScopes,
        ...(input.policy === undefined ? {} : { policy: input.policy }),
        ...(input.approval === undefined ? {} : { approval: input.approval }),
        ...(input.pluginId === undefined ? {} : { pluginId: input.pluginId }),
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
        ...(input.generation === undefined ? {} : { generation: input.generation }),
        ...(input.now === undefined ? {} : { now: input.now }),
    });
    if (decision.status === 'denied') {
        return {
            status: 'denied',
            operationId: input.operationId,
            code: decision.code,
            message: decision.message,
        };
    }

    const credentialHeader = (
        input.credentialHeader ??
        input.provider.credentialHeader ??
        'authorization'
    ).toLowerCase();
    if (!(HOST_INJECTABLE_CREDENTIAL_HEADERS as readonly string[]).includes(credentialHeader)) {
        // Credentials are only ever injected through a host-controlled header,
        // never an arbitrary header a plugin asked for.
        return {
            status: 'denied',
            operationId: input.operationId,
            code: 'forbidden-header',
            message: `${credentialHeader} is not a host-controlled credential header`,
        };
    }

    const credentialPrefix =
        input.credentialPrefix ?? input.provider.credentialPrefix ?? '';
    const headers: Record<string, string> = {
        ...decision.headers,
        [credentialHeader]: `${credentialPrefix}${input.credential}`,
    };

    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let transportResponse: ConnectionTransportResponse;
    try {
        transportResponse = await input.transport({
            url: decision.url,
            method,
            headers,
            ...(input.body === undefined ? {} : { body: input.body }),
            timeoutMs,
            maxResponseBytes: decision.operation.maxResponseBytes,
            redirect: 'manual',
            ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const declaredCode =
            typeof error === 'object' && error !== null && 'code' in error
                ? (error as { code?: unknown }).code
                : undefined;
        if (declaredCode === 'response-too-large') {
            return {
                status: 'failed',
                operationId: input.operationId,
                code: 'response-too-large',
                message: `Provider response exceeds ${decision.operation.maxResponseBytes} bytes`,
            };
        }
        const timeout = /timeout|timed out|aborted|deadline/i.test(message);
        return {
            status: 'failed',
            operationId: input.operationId,
            code: timeout ? 'deadline-exceeded' : 'network-failure',
            message: timeout
                ? `Provider call exceeded ${timeoutMs}ms`
                : 'Provider request failed before a response arrived',
        };
    }

    if (transportResponse.status >= 300 && transportResponse.status < 400) {
        // Redirects are never followed: the credential stays with the approved
        // destination and the caller sees a structured refusal.
        return {
            status: 'failed',
            operationId: input.operationId,
            code: 'policy-denied',
            message:
                'Provider returned a redirect; credentials are not forwarded across destinations',
        };
    }

    const redacted = redactConnectionResponse({
        status: transportResponse.status,
        headers: transportResponse.headers,
        body: transportResponse.body,
        maxResponseBytes: decision.operation.maxResponseBytes,
        credential: input.credential,
        ...(decision.operation.responseFields === undefined
            ? {}
            : { allowedFields: decision.operation.responseFields }),
        ...(input.provider.responseHeaders === undefined
            ? {}
            : { allowedHeaders: input.provider.responseHeaders }),
    });
    if (!redacted.ok) {
        return {
            status: 'failed',
            operationId: input.operationId,
            code: redacted.code,
            message: redacted.message,
        };
    }

    if (transportResponse.status >= 400) {
        return {
            status: 'failed',
            operationId: input.operationId,
            code: classifyFailure(transportResponse.status),
            message: `Provider returned ${transportResponse.status}`,
            response: redacted.response,
        };
    }

    return {
        status: 'ok',
        operationId: input.operationId,
        response: redacted.response,
        redirected: false,
    };
}

export const DISPATCH_POLICY = Object.freeze({
    maxRedirectHops: MAX_REDIRECT_HOPS,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxRedactionDepth: MAX_REDACTION_DEPTH,
    maxRedactionNodes: MAX_REDACTION_NODES,
});
