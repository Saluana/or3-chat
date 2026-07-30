import type { ProvisionedTunnel } from '../types';

export interface ConnectRelayProvisionInput {
    environmentId: string;
    tunnelSecret: string;
    hostname?: string;
    tunnelId?: string;
    dnsRecordId?: string;
}

export interface ConnectRelayProvisionProgress {
    hostname?: string;
    tunnelId?: string;
    dnsRecordId?: string;
}

export interface ConnectRelayRevokeProgress {
    tunnelDeleted?: boolean;
    dnsDeleted?: boolean;
}

export interface ConnectRelay {
    provision(
        input: ConnectRelayProvisionInput,
        onProgress?: (
            progress: ConnectRelayProvisionProgress
        ) => Promise<void>
    ): Promise<ProvisionedTunnel>;
    revoke(input: {
        tunnelId: string;
        dnsRecordId?: string;
    }, onProgress?: (
        progress: ConnectRelayRevokeProgress
    ) => Promise<void>): Promise<void>;
}

export interface ConnectRelayRegistryItem {
    id: string;
    order?: number;
    create: () => ConnectRelay;
}
