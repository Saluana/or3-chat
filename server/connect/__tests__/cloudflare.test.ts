import { describe, expect, it, vi } from 'vitest';
import { CloudflareTunnelProvisioner } from '../cloudflare';

describe('CloudflareTunnelProvisioner', () => {
    it('creates a remotely managed tunnel, loopback ingress, and DNS record', async () => {
        const requests: Array<{ url: string; init: RequestInit }> = [];
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            requests.push({ url, init: init ?? {} });
            if (url.endsWith('/cfd_tunnel')) {
                return Response.json({
                    success: true,
                    result: { id: 'tunnel-1', token: 'tunnel-secret' },
                });
            }
            if (url.endsWith('/dns_records')) {
                return Response.json({
                    success: true,
                    result: { id: 'dns-1' },
                });
            }
            return Response.json({ success: true, result: {} });
        });
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
            },
            fetchMock as unknown as typeof fetch
        );
        const result = await provisioner.provision('env-ABC_123');
        expect(result).toEqual({
            tunnelId: 'tunnel-1',
            tunnelToken: 'tunnel-secret',
            hostname: 'env-abc123.connect.or3.test',
            dnsRecordId: 'dns-1',
        });
        const configuration = requests.find((request) =>
            request.url.endsWith('/configurations')
        );
        expect(configuration).toBeTruthy();
        expect(String(configuration?.init.body)).toContain(
            'http://127.0.0.1:9100'
        );
        expect(String(configuration?.init.body)).not.toContain('api-secret');
    });

    it('deletes a partially-created tunnel if provisioning fails', async () => {
        const deleted: string[] = [];
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (init?.method === 'DELETE') {
                deleted.push(url);
                return Response.json({ success: true, result: {} });
            }
            if (url.endsWith('/cfd_tunnel')) {
                return Response.json({
                    success: true,
                    result: { id: 'tunnel-1', token: 'token' },
                });
            }
            return Response.json(
                {
                    success: false,
                    result: null,
                    errors: [{ message: 'configuration failed' }],
                },
                { status: 400 }
            );
        });
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
            },
            fetchMock as unknown as typeof fetch
        );
        await expect(provisioner.provision('env-one')).rejects.toThrow(
            'configuration failed'
        );
        expect(deleted.some((url) => url.endsWith('/tunnel-1'))).toBe(true);
    });
});
