/**
 * @module shared/plugins/connections/contracts
 *
 * Purpose:
 * Versioned contract for host connections: how a plugin declares the connection
 * it needs, what the host may execute against it, and how credentials are kept
 * out of plugin reach.
 *
 * Behavior:
 * - A plugin only ever holds an opaque reference (`orc_<id>_r<revision>`); the
 *   secret is decrypted inside the host at dispatch time.
 * - Operations are an explicit allowlist: exact host, method and path prefix,
 *   declared scopes and a response size ceiling.
 * - A revision changes whenever the credential changes, invalidating any
 *   previously successful test evidence.
 *
 * Constraints:
 * - No raw credential in settings, storage, logs, errors, diagnostics or
 *   marketplace payloads.
 * - No generic HTTP proxy: an operation must be declared by a provider.
 *
 * Non-Goals:
 * - Provider transports (server-side implementations own those).
 * - Runtime grant enforcement (see `grant-review`).
 */

import type { Sha256 } from '../runtime-descriptor';

/** Opaque handle a plugin may store and pass back to the host. */
export type ConnectionRef = string;

export const CONNECTION_REF_PATTERN = /^orc_[A-Za-z0-9]{1,32}_r[0-9]{1,9}$/;

/** How a credential is delivered to the provider. */
export type ConnectionMechanism = 'server' | 'browser-pkce';

/**
 * How risky an operation is. Anything other than `read` requires a host-minted
 * approval before the credential is used, and the risk is declared by the
 * provider rather than inferred from the plugin's request.
 */
export type ConnectionOperationClassification =
    | 'read'
    | 'external'
    | 'commercial'
    | 'destructive'
    | 'access-changing';

/** Approvals never apply to a plain read. */
export function operationRequiresApproval(
    classification: ConnectionOperationClassification
): boolean {
    return classification !== 'read';
}

export interface ApprovedConnectionOperation {
    readonly id: string;
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** Exact hostname; no wildcards and no scheme-relative values. */
    readonly host: string;
    /** Path prefix the operation may call, e.g. `/v1/`. */
    readonly pathPrefix: string;
    readonly scopes: readonly string[];
    /** Non-idempotent operations are never used as setup tests. */
    readonly idempotent: boolean;
    readonly readOnly: boolean;
    readonly maxResponseBytes: number;
    readonly description: string;
    /** Declared risk; defaults to `read` only for read-only operations. */
    readonly classification?: ConnectionOperationClassification;
    /**
     * When set, generic connection dispatch refuses this operation and the named
     * host capability owns it (for example `ai.complete`). A provider operation
     * that spends money must not be reachable through two different policies.
     */
    readonly governedBy?: string;
    /** Top-level response fields the plugin may see; other keys are dropped. */
    readonly responseFields?: readonly string[];
}

/**
 * The release's approved connection authority, read from the package's own
 * signed policy descriptor. Generic dispatch intersects this with the stored
 * connection scopes, so "the provider supports it" is never enough.
 */
export interface ConnectionDispatchPolicy {
    readonly connections: readonly {
        readonly id: string;
        readonly provider: string;
        readonly scopes: readonly string[];
        readonly operations: readonly string[];
        readonly externalCost?: string;
    }[];
    readonly destinations: readonly {
        readonly id: string;
        readonly hosts: readonly string[];
        readonly methods: readonly string[];
        readonly scopes: readonly string[];
    }[];
}

export interface ConnectionProviderDescriptor {
    readonly id: string;
    readonly label: string;
    readonly mechanism: ConnectionMechanism;
    readonly scopes: readonly string[];
    /** Host-controlled header the credential is injected into. */
    readonly credentialHeader?: (typeof HOST_INJECTABLE_CREDENTIAL_HEADERS)[number];
    /** Scheme prefix such as `Bearer `; never supplied by a plugin. */
    readonly credentialPrefix?: string;
    readonly operations: readonly ApprovedConnectionOperation[];
    /**
     * Response headers the provider may expose to plugin code. Without an
     * allowlist only non-diagnostic headers survive.
     */
    readonly responseHeaders?: readonly string[];
    /** Callback domains the provider uses, disclosed even when unsupported. */
    readonly callbackDomains: readonly string[];
    /** External costs the user pays the provider directly, if any. */
    readonly externalCost?: string;
    /** Mechanisms/callbacks this build does not support. */
    readonly unsupported?: readonly string[];
}

/** A connection requirement declared by a package (`or3.setup.json`). */
export interface ConnectionRequirement {
    readonly id: string;
    readonly label: string;
    readonly providerId: string;
    readonly required: boolean;
    readonly mechanism: ConnectionMechanism;
    readonly scopes: readonly string[];
    readonly operationIds: readonly string[];
    readonly description?: string;
}

/** Public (secret-free) projection of a stored connection. */
export interface PluginConnectionView {
    readonly id: string;
    readonly ref: ConnectionRef;
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly providerId: string;
    readonly slotId?: string;
    readonly label: string;
    readonly scopes: readonly string[];
    readonly revision: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly lastTest?: ConnectionTestEvidence;
}

export interface StoredPluginConnection {
    readonly id: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly pluginId: string;
    readonly providerId: string;
    /**
     * Declared connection slot from the package policy this credential is bound
     * to. The stored id is generated by the host, so the symbolic slot in
     * `or3.setup.json` is meaningless without this binding.
     */
    readonly slotId?: string;
    readonly label: string;
    readonly scopes: readonly string[];
    readonly revision: number;
    /** AES-256-GCM payload; the key lives outside the database. */
    readonly secretCiphertext: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export type ConnectionFailureCode =
    | 'bad-credentials'
    | 'insufficient-scope'
    | 'network-failure'
    | 'rate-limit'
    | 'provider-outage'
    | 'deadline-exceeded'
    | 'response-too-large'
    | 'policy-denied'
    | 'unknown';

/**
 * A connection update that cannot reassign identity. The owner, workspace,
 * plugin, provider and id are deliberately absent: a retry after a conflict must
 * never be able to move one owner's record to another.
 */
export interface PluginConnectionUpdate {
    readonly id: string;
    /** Revision the caller read; the write is refused when it has moved. */
    readonly expectedRevision: number;
    readonly revision: number;
    readonly updatedAt: number;
    readonly secretCiphertext: string;
    readonly scopes?: readonly string[];
    readonly label?: string;
}

export interface ConnectionTestEvidence {
    readonly connectionId: string;
    readonly revision: number;
    readonly operationId: string;
    readonly ok: boolean;
    readonly code?: ConnectionFailureCode;
    readonly checkedAt: number;
    readonly detail?: string;
}

export type ConnectionResolution =
    | {
          readonly status: 'resolved';
          readonly connection: StoredPluginConnection;
          readonly provider: ConnectionProviderDescriptor;
      }
    | {
          readonly status: 'denied';
          readonly code:
              | 'reference-malformed'
              | 'reference-unknown'
              | 'reference-foreign'
              | 'reference-stale'
              | 'provider-unknown'
              | 'secret-unavailable';
          readonly message: string;
      };

export type ConnectionDispatchDecision =
    | {
          readonly status: 'allowed';
          readonly operation: ApprovedConnectionOperation;
          readonly url: string;
          /** Headers the host will send; credentials are injected last. */
          readonly headers: Readonly<Record<string, string>>;
      }
    | {
          readonly status: 'denied';
          readonly code:
              | 'operation-unknown'
              | 'operation-not-approved'
              | 'destination-mismatch'
              | 'path-not-approved'
              | 'method-not-approved'
              | 'scope-missing'
              | 'forbidden-header'
              | 'excluded-endpoint'
              | 'rate-limited'
              | 'approval-required'
              | 'owner-mismatch';
          readonly message: string;
      };

/** Response headers that must never reach plugin code. */
export const SENSITIVE_RESPONSE_HEADERS = [
    'set-cookie',
    'set-cookie2',
    'authorization',
    'proxy-authenticate',
    'proxy-authorization',
    'www-authenticate',
    'x-api-key',
    'x-auth-token',
    'x-amz-security-token',
    'x-goog-iam-authorization-token',
] as const;

/**
 * Request headers a plugin may never influence. Credential injection happens
 * after this check, so a plugin cannot override or observe them.
 */
export const FORBIDDEN_REQUEST_HEADERS = [
    'authorization',
    'api-key',
    'x-api-key',
    'x-auth-token',
    'cookie',
    'host',
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
    'proxy-authorization',
    'proxy-connection',
    'connection',
    'transfer-encoding',
    'content-length',
    'upgrade',
] as const;

/**
 * Path fragments that look like credential/debug/echo endpoints. These are
 * refused even when the provider lists a matching operation.
 */
export const EXCLUDED_PATH_FRAGMENTS = [
    '/debug',
    '/echo',
    '/token',
    '/tokens',
    '/oauth/callback',
    '/credentials',
    '/secrets',
    '/.env',
    '/actuator',
    '/_debug',
] as const;

/**
 * Headers a plugin may never set but the host may inject during an approved
 * dispatch (after every other check has passed).
 */
export const HOST_INJECTABLE_CREDENTIAL_HEADERS = ['authorization', 'x-api-key'] as const;

export interface RedactedResponse {
    readonly status: number;
    /** Allowlisted, non-sensitive headers. */
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
    /** Headers removed before the plugin sees the response. */
    readonly removedHeaders: readonly string[];
}

export function connectionRefFor(id: string, revision: number): ConnectionRef {
    return `orc_${id}_r${revision}`;
}

export function parseConnectionRef(ref: string): { id: string; revision: number } | null {
    if (!CONNECTION_REF_PATTERN.test(ref)) return null;
    const match = /^orc_([A-Za-z0-9]{1,32})_r([0-9]{1,9})$/.exec(ref);
    if (!match) return null;
    return { id: match[1]!, revision: Number(match[2]!) };
}

/** Response bodies that look like they carry a secret are refused, not patched. */
export const SECRET_SHAPED_BODY_KEYS = [
    'access_token',
    'refresh_token',
    'client_secret',
    'private_key',
    'password',
    'api_key',
    'apiKey',
] as const;

export type ConnectionSecretDigest = Sha256;
