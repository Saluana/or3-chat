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
    status: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';
    user_code_display: string;
    host: StoredConnectHost;
    credential_ciphertext?: string;
    expires_at: number;
}

export interface ConnectEnvironmentRecord {
    id: string;
    name: string;
    hostname: string;
    tunnel_id: string;
    dns_record_id: string;
    access_credential_ciphertext: string;
    status: 'active' | 'revoked' | 'error';
}

export interface ConnectAccessCredential {
    controlToken: string;
}

export interface ConnectCredential {
    accountId: string;
    environmentId: string;
    environmentName: string;
    controlToken: string;
    tunnel: {
        token: string;
        hostname: string;
    };
}

export interface ProvisionedTunnel {
    tunnelId: string;
    tunnelToken: string;
    hostname: string;
    dnsRecordId: string;
}
