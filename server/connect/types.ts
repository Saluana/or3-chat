export interface ConnectHostMetadata {
    name: string;
    platform: string;
    architecture: string;
    internVersion: string;
    hostId?: string;
    signingPublicKey?: string;
    noisePublicKey?: string;
}

export interface StoredConnectHost {
    name: string;
    platform: string;
    architecture: string;
    intern_version: string;
    host_id?: string;
    signing_public_key?: string;
    noise_public_key?: string;
}

export interface ConnectAuthorizationRecord {
    _id: string;
    status:
        | 'pending'
        | 'provisioning'
        | 'approved'
        | 'delivering'
        | 'denied'
        | 'consumed'
        | 'expired';
    host: StoredConnectHost;
    approved_user_id?: string;
    approved_workspace_id?: string;
    environment_id?: string;
    credential_ciphertext?: string;
    expires_at: number;
}

export interface ConnectEnvironmentRecord {
    id: string;
    user_id?: string;
    workspace_id?: string;
    name: string;
    platform?: string;
    architecture?: string;
    host_id?: string;
    signing_public_key?: string;
    noise_public_key?: string;
    hostname: string;
    tunnel_id: string;
    dns_record_id: string;
    relay_authenticator?: string;
    control_token_hash?: string;
    access_credential_ciphertext: string;
    tunnel_secret_ciphertext?: string;
    authorization_id?: string;
    status: 'provisioning' | 'active' | 'revoking' | 'revoked' | 'error';
    lifecycle_attempts?: number;
    lifecycle_next_attempt_at?: number;
    lifecycle_claim_token?: string;
    lifecycle_claimed_until?: number;
    provisioning_deadline_at?: number;
    activation_deadline_at?: number;
    activation_claimed_at?: number;
    lifecycle_error?: string;
}

export interface ConnectAccessCredential {
    controlToken: string;
}

export interface ConnectCredential {
    accountId: string;
    workspaceId: string;
    environmentId: string;
    environmentName: string;
    namespace: string;
    controlToken: string;
    tunnel: {
        accountTag: string;
        tunnelId: string;
        tunnelSecret: string;
        hostname: string;
    };
}

export interface ProvisionedTunnel {
    tunnelId: string;
    accountTag: string;
    tunnelSecret: string;
    hostname: string;
    dnsRecordId: string;
}
