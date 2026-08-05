import type {
    ConnectAuthorizationRecord,
    ConnectEnvironmentRecord,
    StoredConnectHost,
} from '../types';

export interface CreateConnectAuthorizationInput {
    deviceCodeHash: string;
    /** Purpose-separated, server-keyed HMAC; never a raw or fast phrase hash. */
    userCodeHash: string;
    host: StoredConnectHost;
    expiresAt: number;
    now: number;
}

export interface ConnectEnvironmentScope {
    userId: string;
    workspaceId: string;
}

export type ConnectEnvironmentLimitScope = 'account' | 'workspace';

export interface ConnectEnvironmentLimitPolicy {
    scope: ConnectEnvironmentLimitScope;
    maxActiveEnvironments: number;
}

/**
 * Product policy: the configured computer cap is shared by all workspaces
 * owned by an account. Workspace binding still scopes discovery and control.
 */
export const CONNECT_ENVIRONMENT_LIMIT_SCOPE = 'account' as const;
export const CONNECT_CREDENTIAL_REDELIVERY_MS = 60_000;
export const CONNECT_LIFECYCLE_CLAIM_MS = 2 * 60_000;
export const CONNECT_PROVISIONING_DEADLINE_MS = 15 * 60_000;
export const CONNECT_ACTIVATION_DEADLINE_MS = 30 * 60_000;
export const CONNECT_LIFECYCLE_RETRY_BASE_MS = 5_000;
export const CONNECT_LIFECYCLE_RETRY_MAX_MS = 5 * 60_000;
export const CONNECT_AUTHORIZATION_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const CONNECT_REVOKED_ENVIRONMENT_RETENTION_MS =
    30 * 24 * 60 * 60_000;
export const CONNECT_RETENTION_BATCH_SIZE = 100;

export interface ApproveConnectAuthorizationInput {
    authorizationId: string;
    userId: string;
    workspaceId: string;
    environment: {
        id: string;
        name: string;
        platform: string;
        architecture: string;
        driver?: import('../types').ConnectDriver;
        runtime?: import('../types').ConnectRuntime;
        base_path?: '/' | '/or3/';
        host_id?: string;
        signing_public_key?: string;
        noise_public_key?: string;
        hostname: string;
        tunnel_id: string;
        dns_record_id: string;
        control_token_hash: string;
        access_credential_ciphertext: string;
    };
    credentialCiphertext: string;
    limitPolicy: ConnectEnvironmentLimitPolicy;
    now: number;
}

export interface ReserveConnectAuthorizationInput {
    authorizationId: string;
    userId: string;
    workspaceId: string;
    environment: {
        id: string;
        name: string;
        platform: string;
        architecture: string;
        driver?: import('../types').ConnectDriver;
        runtime?: import('../types').ConnectRuntime;
        base_path?: '/' | '/or3/';
        host_id?: string;
        signing_public_key?: string;
        noise_public_key?: string;
        control_token_hash: string;
        access_credential_ciphertext: string;
        tunnel_secret_ciphertext: string;
    };
    limitPolicy: ConnectEnvironmentLimitPolicy;
    claimToken: string;
    claimUntil: number;
    provisioningDeadlineAt: number;
    activationDeadlineAt: number;
    authorizationExpiresAt: number;
    now: number;
}

export interface ConnectEnvironmentRelayProgress {
    hostname?: string;
    tunnelId?: string;
    dnsRecordId?: string;
    relayAuthenticator?: string;
}

export interface BeginConnectEnvironmentRevocationInput {
    environmentId: string;
    scope: ConnectEnvironmentScope;
    claimToken: string;
    claimUntil: number;
    now: number;
}

export interface ConnectEnvironmentLifecycleClaim {
    claimed: boolean;
    environment: ConnectEnvironmentRecord;
}

export interface PurgeConnectRecordsInput {
    authorizationUpdatedBefore: number;
    revokedEnvironmentUpdatedBefore: number;
    batchSize: number;
}

export interface PurgeConnectRecordsResult {
    authorizations: number;
    environments: number;
}

/**
 * Provider-neutral persistence contract for OR3 Connect.
 *
 * Implementations must preserve atomic approval and bounded, idempotent
 * credential redelivery semantics. Product behavior, encryption, tunnel
 * provisioning, and authorization remain in OR3 Chat.
 */
export interface ConnectStore {
    createAuthorization(
        input: CreateConnectAuthorizationInput
    ): Promise<void>;
    getAuthorizationByDeviceHash(
        deviceCodeHash: string,
        now: number,
        redeliveryWindowMs: number
    ): Promise<ConnectAuthorizationRecord | null>;
    getAuthorizationByUserHash(
        userCodeHash: string,
        now: number
    ): Promise<ConnectAuthorizationRecord | null>;
    approveAuthorization(
        input: ApproveConnectAuthorizationInput
    ): Promise<{ environment_id: string }>;
    reserveAuthorization(
        input: ReserveConnectAuthorizationInput
    ): Promise<ConnectEnvironmentRecord>;
    claimNextEnvironmentLifecycle(
        claimToken: string,
        now: number,
        claimUntil: number
    ): Promise<ConnectEnvironmentRecord | null>;
    saveEnvironmentRelayProgress(
        environmentId: string,
        expectedStatus: 'provisioning' | 'revoking',
        claimToken: string,
        progress: ConnectEnvironmentRelayProgress,
        now: number
    ): Promise<boolean>;
    completeEnvironmentProvisioning(
        environmentId: string,
        claimToken: string,
        credentialCiphertext: string,
        now: number
    ): Promise<boolean>;
    beginEnvironmentRevocation(
        input: BeginConnectEnvironmentRevocationInput
    ): Promise<ConnectEnvironmentLifecycleClaim | null>;
    abandonEnvironmentProvisioning(
        environmentId: string,
        claimToken: string,
        now: number
    ): Promise<ConnectEnvironmentRecord | null>;
    completeEnvironmentRevocation(
        environmentId: string,
        claimToken: string,
        now: number
    ): Promise<boolean>;
    recordEnvironmentLifecycleFailure(
        environmentId: string,
        expectedStatus: 'provisioning' | 'revoking',
        claimToken: string,
        errorMessage: string,
        nextAttemptAt: number,
        now: number
    ): Promise<boolean>;
    denyAuthorization(authorizationId: string, now: number): Promise<boolean>;
    getEnvironmentByControlTokenHash(
        controlTokenHash: string,
        scope: ConnectEnvironmentScope
    ): Promise<ConnectEnvironmentRecord | null>;
    listEnvironments(
        scope: ConnectEnvironmentScope
    ): Promise<ConnectEnvironmentRecord[]>;
    revokeEnvironment(
        environmentId: string,
        scope: ConnectEnvironmentScope,
        now: number
    ): Promise<boolean>;
    purgeConnectRecords(
        input: PurgeConnectRecordsInput
    ): Promise<PurgeConnectRecordsResult>;
    rotateAuthorizationCredential(
        authorizationId: string,
        expectedCiphertext: string,
        replacementCiphertext: string,
        now: number
    ): Promise<boolean>;
    rotateEnvironmentCredential(
        environmentId: string,
        purpose: 'access' | 'tunnel',
        expectedCiphertext: string,
        replacementCiphertext: string,
        now: number
    ): Promise<boolean>;
}

export type ConnectStoreErrorCode =
    | 'authorization_unavailable'
    | 'environment_limit_reached'
    | 'conflict';

export class ConnectStoreError extends Error {
    readonly code: ConnectStoreErrorCode;

    constructor(code: ConnectStoreErrorCode, message: string) {
        super(message);
        this.name = 'ConnectStoreError';
        this.code = code;
    }
}

export interface ConnectStoreRegistryItem {
    id: string;
    order?: number;
    create: () => ConnectStore;
}
