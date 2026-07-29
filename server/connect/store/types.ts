import type {
    ConnectAuthorizationRecord,
    ConnectEnvironmentRecord,
    StoredConnectHost,
} from '../types';

export interface CreateConnectAuthorizationInput {
    deviceCodeHash: string;
    userCodeHash: string;
    userCodeDisplay: string;
    host: StoredConnectHost;
    expiresAt: number;
    now: number;
}

export interface ApproveConnectAuthorizationInput {
    authorizationId: string;
    userId: string;
    workspaceId: string;
    environment: {
        id: string;
        name: string;
        platform: string;
        architecture: string;
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
    maxActiveEnvironments: number;
    now: number;
}

/**
 * Provider-neutral persistence contract for OR3 Connect.
 *
 * Implementations must preserve the single-use polling and atomic approval
 * semantics described by these methods. Product behavior, encryption, tunnel
 * provisioning, and authorization remain in OR3 Chat.
 */
export interface ConnectStore {
    createAuthorization(
        input: CreateConnectAuthorizationInput
    ): Promise<void>;
    getAuthorizationByDeviceHash(
        deviceCodeHash: string,
        now: number
    ): Promise<ConnectAuthorizationRecord | null>;
    getAuthorizationByUserHash(
        userCodeHash: string,
        now: number
    ): Promise<ConnectAuthorizationRecord | null>;
    approveAuthorization(
        input: ApproveConnectAuthorizationInput
    ): Promise<{ environment_id: string }>;
    denyAuthorization(authorizationId: string, now: number): Promise<boolean>;
    getEnvironmentByControlTokenHash(
        controlTokenHash: string
    ): Promise<ConnectEnvironmentRecord | null>;
    listEnvironmentsForUser(
        userId: string
    ): Promise<ConnectEnvironmentRecord[]>;
    revokeEnvironment(environmentId: string, now: number): Promise<boolean>;
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
