import { useRuntimeConfig } from '#imports';
import { CloudflareTunnelProvisioner } from '../connect/cloudflare';
import { registerConnectRelay } from '../connect/relay/registry';

const CLOUDFLARE_RELAY_ID = 'cloudflare';

interface ConnectCloudflareRuntimeConfig {
    connect?: {
        enabled?: boolean;
        relayProvider?: string;
        cloudflare?: {
            accountId?: string;
            zoneId?: string;
            apiToken?: string;
            hostnameSuffix?: string;
        };
    };
}

export default defineNitroPlugin(() => {
    const runtime = useRuntimeConfig() as ConnectCloudflareRuntimeConfig;
    if (
        runtime.connect?.enabled !== true ||
        runtime.connect.relayProvider !== CLOUDFLARE_RELAY_ID
    ) {
        return;
    }

    registerConnectRelay({
        id: CLOUDFLARE_RELAY_ID,
        order: 100,
        create: () => {
            const cloudflare = runtime.connect?.cloudflare;
            const accountId = cloudflare?.accountId?.trim() ?? '';
            const zoneId = cloudflare?.zoneId?.trim() ?? '';
            const apiToken = cloudflare?.apiToken?.trim() ?? '';
            const hostnameSuffix =
                cloudflare?.hostnameSuffix?.trim() ?? '';
            if (!apiToken || !hostnameSuffix) {
                throw new Error(
                    'The Cloudflare Connect relay is not fully configured.'
                );
            }
            return new CloudflareTunnelProvisioner({
                accountId: accountId || undefined,
                zoneId: zoneId || undefined,
                apiToken,
                hostnameSuffix,
            });
        },
    });
});
