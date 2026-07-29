import type { ProvisionedTunnel } from './types';

interface CloudflareEnvelope<T> {
    success: boolean;
    result: T;
    errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareTunnelResult {
    id: string;
    token?: string;
}

interface CloudflareDNSResult {
    id: string;
}

export interface CloudflareConnectConfig {
    accountId: string;
    zoneId: string;
    apiToken: string;
    hostnameSuffix: string;
    localService?: string;
}

export class CloudflareTunnelProvisioner {
    readonly #config: CloudflareConnectConfig;
    readonly #fetch: typeof fetch;

    constructor(config: CloudflareConnectConfig, fetchImpl: typeof fetch = fetch) {
        this.#config = config;
        this.#fetch = fetchImpl;
    }

    async provision(environmentId: string): Promise<ProvisionedTunnel> {
        const safeId = environmentId.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const hostname = `${safeId}.${this.#config.hostnameSuffix}`;
        const tunnel = await this.#request<CloudflareTunnelResult>(
            `/accounts/${this.#config.accountId}/cfd_tunnel`,
            {
                method: 'POST',
                body: JSON.stringify({
                    name: `or3-${safeId}`,
                    config_src: 'cloudflare',
                }),
            }
        );
        let dnsRecordId = '';
        try {
            await this.#request(
                `/accounts/${this.#config.accountId}/cfd_tunnel/${tunnel.id}/configurations`,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        config: {
                            ingress: [
                                {
                                    hostname,
                                    service:
                                        this.#config.localService ??
                                        'http://127.0.0.1:9100',
                                    originRequest: {
                                        httpHostHeader: '127.0.0.1',
                                    },
                                },
                                { service: 'http_status:404' },
                            ],
                        },
                    }),
                }
            );
            const dns = await this.#request<CloudflareDNSResult>(
                `/zones/${this.#config.zoneId}/dns_records`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        type: 'CNAME',
                        name: hostname,
                        content: `${tunnel.id}.cfargotunnel.com`,
                        proxied: true,
                        ttl: 1,
                    }),
                }
            );
            dnsRecordId = dns.id;
            const token =
                tunnel.token ??
                (await this.#request<string>(
                    `/accounts/${this.#config.accountId}/cfd_tunnel/${tunnel.id}/token`,
                    { method: 'GET' }
                ));
            return {
                tunnelId: tunnel.id,
                tunnelToken: token,
                hostname,
                dnsRecordId,
            };
        } catch (error) {
            await this.revoke({
                tunnelId: tunnel.id,
                dnsRecordId,
            }).catch(() => undefined);
            throw error;
        }
    }

    async revoke(input: {
        tunnelId: string;
        dnsRecordId?: string;
    }): Promise<void> {
        if (input.dnsRecordId) {
            await this.#request(
                `/zones/${this.#config.zoneId}/dns_records/${input.dnsRecordId}`,
                { method: 'DELETE' }
            );
        }
        await this.#request(
            `/accounts/${this.#config.accountId}/cfd_tunnel/${input.tunnelId}`,
            { method: 'DELETE' }
        );
    }

    async #request<T = unknown>(
        path: string,
        init: RequestInit
    ): Promise<T> {
        const response = await this.#fetch(
            `https://api.cloudflare.com/client/v4${path}`,
            {
                ...init,
                headers: {
                    Authorization: `Bearer ${this.#config.apiToken}`,
                    'Content-Type': 'application/json',
                    ...init.headers,
                },
            }
        );
        const body = (await response.json()) as CloudflareEnvelope<T>;
        if (!response.ok || !body.success) {
            const message =
                body.errors?.map((entry) => entry.message).filter(Boolean).join('; ') ||
                `Cloudflare request failed with HTTP ${response.status}`;
            throw new Error(message);
        }
        return body.result;
    }
}
