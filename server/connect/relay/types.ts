import type { ProvisionedTunnel } from '../types';

export interface ConnectRelay {
    provision(environmentId: string): Promise<ProvisionedTunnel>;
    revoke(input: {
        tunnelId: string;
        dnsRecordId?: string;
    }): Promise<void>;
}

export interface ConnectRelayRegistryItem {
    id: string;
    order?: number;
    create: () => ConnectRelay;
}
