import { describe, expect, it, vi } from 'vitest';
import { CloudflareTunnelProvisioner } from '../cloudflare';

describe('CloudflareTunnelProvisioner', () => {
    it('creates a locally managed tunnel credential and DNS record', async () => {
        const requests: Array<{ url: string; init: RequestInit }> = [];
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            requests.push({ url, init: init ?? {} });
            if (url.endsWith('/zones/zone-1')) {
                return Response.json({
                    success: true,
                    result: {
                        id: 'zone-1',
                        name: 'connect.or3.test',
                        account: { id: 'account-1' },
                    },
                });
            }
            if (url.endsWith('/cfd_tunnel')) {
                return Response.json({
                    success: true,
                    result: { id: 'tunnel-1', account_tag: 'account-1' },
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
        expect(result).toMatchObject({
            tunnelId: 'tunnel-1',
            accountTag: 'account-1',
            hostname: 'env-abc123.connect.or3.test',
            dnsRecordId: 'dns-1',
        });
        expect(result.tunnelSecret).toMatch(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/);
        const tunnelCreate = requests.find((request) =>
            request.url.endsWith('/cfd_tunnel')
        );
        expect(JSON.parse(String(tunnelCreate?.init.body))).toMatchObject({
            config_src: 'local',
            tunnel_secret: result.tunnelSecret,
        });
        expect(
            requests.some((request) => request.url.endsWith('/configurations'))
        ).toBe(false);
    });

    it('deletes a partially-created tunnel if provisioning fails', async () => {
        const deleted: string[] = [];
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/zones/zone-1')) {
                return Response.json({
                    success: true,
                    result: {
                        id: 'zone-1',
                        name: 'connect.or3.test',
                        account: { id: 'account-1' },
                    },
                });
            }
            if (init?.method === 'DELETE') {
                deleted.push(url);
                return Response.json({ success: true, result: {} });
            }
            if (url.endsWith('/cfd_tunnel')) {
                return Response.json({
                    success: true,
                    result: { id: 'tunnel-1', account_tag: 'account-1' },
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

    it('reuses deterministic tunnel and DNS identities after a lost response', async () => {
        const methods: string[] = [];
        const progress: unknown[] = [];
        const fetchMock = vi.fn(
            async (
                input: string | URL | Request,
                init?: RequestInit
            ) => {
                const url = String(input);
                methods.push(`${init?.method ?? 'GET'} ${url}`);
                if (url.endsWith('/zones/zone-1')) {
                    return Response.json({
                        success: true,
                        result: {
                            id: 'zone-1',
                            name: 'connect.or3.test',
                            account: { id: 'account-1' },
                        },
                    });
                }
                if (url.includes('/cfd_tunnel?')) {
                    return Response.json({
                        success: true,
                        result: [
                            {
                                id: 'tunnel-existing',
                                name: 'or3-env-resume',
                                account_tag: 'account-1',
                            },
                        ],
                    });
                }
                if (url.includes('/dns_records?')) {
                    return Response.json({
                        success: true,
                        result: [
                            {
                                id: 'dns-existing',
                                name: 'env-resume.connect.or3.test',
                                content:
                                    'tunnel-existing.cfargotunnel.com',
                            },
                        ],
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
            }
        );
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
            },
            fetchMock as unknown as typeof fetch
        );

        await expect(
            provisioner.provision(
                {
                    environmentId: 'env-resume',
                    tunnelSecret: 'persisted-tunnel-secret',
                },
                async (step) => {
                    progress.push(step);
                }
            )
        ).resolves.toMatchObject({
            tunnelId: 'tunnel-existing',
            dnsRecordId: 'dns-existing',
            tunnelSecret: 'persisted-tunnel-secret',
        });
        expect(methods.some((entry) => entry.startsWith('POST '))).toBe(
            false
        );
        expect(progress).toEqual([
            {
                hostname: 'env-resume.connect.or3.test',
                tunnelId: 'tunnel-existing',
            },
            {
                hostname: 'env-resume.connect.or3.test',
                tunnelId: 'tunnel-existing',
                dnsRecordId: 'dns-existing',
            },
        ]);
    });

    it('persists the tunnel before a DNS failure and leaves it for reconciliation', async () => {
        const deleted: string[] = [];
        const progress: unknown[] = [];
        const fetchMock = vi.fn(
            async (
                input: string | URL | Request,
                init?: RequestInit
            ) => {
                const url = String(input);
                if (url.endsWith('/zones/zone-1')) {
                    return Response.json({
                        success: true,
                        result: {
                            id: 'zone-1',
                            name: 'connect.or3.test',
                            account: { id: 'account-1' },
                        },
                    });
                }
                if (url.includes('/cfd_tunnel?')) {
                    return Response.json({
                        success: true,
                        result: [],
                    });
                }
                if (url.endsWith('/cfd_tunnel')) {
                    return Response.json({
                        success: true,
                        result: {
                            id: 'tunnel-created',
                            account_tag: 'account-1',
                        },
                    });
                }
                if (url.includes('/dns_records?')) {
                    return Response.json({
                        success: true,
                        result: [],
                    });
                }
                if (url.endsWith('/dns_records')) {
                    return Response.json(
                        {
                            success: false,
                            result: null,
                            errors: [{ message: 'dns unavailable' }],
                        },
                        { status: 503 }
                    );
                }
                if (init?.method === 'DELETE') {
                    deleted.push(url);
                    return Response.json({ success: true, result: {} });
                }
                throw new Error(`Unexpected request: ${url}`);
            }
        );
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
            },
            fetchMock as unknown as typeof fetch
        );

        await expect(
            provisioner.provision(
                {
                    environmentId: 'env-progress',
                    tunnelSecret: 'persisted-tunnel-secret',
                },
                async (step) => {
                    progress.push(step);
                }
            )
        ).rejects.toThrow('dns unavailable');
        expect(progress).toEqual([
            {
                hostname: 'env-progress.connect.or3.test',
                tunnelId: 'tunnel-created',
            },
        ]);
        expect(deleted).toEqual([]);
    });

    it('discovers the account and longest matching zone from the hostname', async () => {
        const requests: string[] = [];
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            requests.push(url);
            if (url.includes('/zones?')) {
                return Response.json({
                    success: true,
                    result: [
                        {
                            id: 'parent-zone',
                            name: 'example.com',
                            account: { id: 'account-1' },
                        },
                        {
                            id: 'specific-zone',
                            name: 'connect.example.com',
                            account: { id: 'account-1' },
                        },
                    ],
                });
            }
            if (url.endsWith('/cfd_tunnel')) {
                return Response.json({
                    success: true,
                    result: { id: 'tunnel-1', account_tag: 'account-1' },
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
                apiToken: 'api-secret',
                hostnameSuffix: 'hosts.connect.example.com',
            },
            fetchMock as unknown as typeof fetch
        );

        await provisioner.provision('env-one');

        expect(
            requests.some((url) =>
                url.includes('/accounts/account-1/cfd_tunnel')
            )
        ).toBe(true);
        expect(
            requests.some((url) =>
                url.includes('/zones/specific-zone/dns_records')
            )
        ).toBe(true);
    });

    it('rejects configured account and zone IDs that do not belong together', async () => {
        const fetchMock = vi.fn(async () =>
            Response.json({
                success: true,
                result: {
                    id: 'zone-1',
                    name: 'connect.or3.test',
                    account: { id: 'different-account' },
                },
            })
        );
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
            'do not belong together'
        );
    });

    it('treats missing cleanup resources as already revoked', async () => {
        const deleted: string[] = [];
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/zones/zone-1')) {
                return Response.json({
                    success: true,
                    result: {
                        id: 'zone-1',
                        name: 'connect.or3.test',
                        account: { id: 'account-1' },
                    },
                });
            }
            if (init?.method === 'DELETE') {
                deleted.push(url);
                return Response.json(
                    { success: false, result: null, errors: [{ message: 'not found' }] },
                    { status: 404 }
                );
            }
            throw new Error(`Unexpected request: ${url}`);
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

        await expect(
            provisioner.revoke({
                tunnelId: 'tunnel-1',
                dnsRecordId: 'dns-1',
            })
        ).resolves.toBeUndefined();
        expect(deleted).toHaveLength(2);
    });

    it('still attempts tunnel cleanup when DNS cleanup fails', async () => {
        const deleted: string[] = [];
        const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/zones/zone-1')) {
                return Response.json({
                    success: true,
                    result: {
                        id: 'zone-1',
                        name: 'connect.or3.test',
                        account: { id: 'account-1' },
                    },
                });
            }
            if (init?.method === 'DELETE') {
                deleted.push(url);
                if (url.includes('/dns_records/')) {
                    return Response.json(
                        {
                            success: false,
                            result: null,
                            errors: [{ message: 'dns cleanup failed' }],
                        },
                        { status: 500 }
                    );
                }
                return Response.json({ success: true, result: {} });
            }
            throw new Error(`Unexpected request: ${url}`);
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

        await expect(
            provisioner.revoke({
                tunnelId: 'tunnel-1',
                dnsRecordId: 'dns-1',
            })
        ).rejects.toThrow('did not fully complete');
        expect(deleted.length).toBeGreaterThanOrEqual(2);
        expect(deleted.some((url) => url.endsWith('/tunnel-1'))).toBe(true);
    });

    it('retries only safe transient calls and emits request correlation IDs', async () => {
        const requestIds: string[] = [];
        let zoneAttempts = 0;
        const fetchMock = vi.fn(
            async (
                input: string | URL | Request,
                init?: RequestInit
            ) => {
                const url = String(input);
                const headers = new Headers(init?.headers);
                requestIds.push(headers.get('x-or3-request-id') ?? '');
                if (url.endsWith('/zones/zone-1')) {
                    zoneAttempts += 1;
                    if (zoneAttempts === 1) {
                        return Response.json(
                            {
                                success: false,
                                result: null,
                                errors: [{ message: 'provider unavailable' }],
                            },
                            { status: 503 }
                        );
                    }
                    return Response.json({
                        success: true,
                        result: {
                            id: 'zone-1',
                            name: 'connect.or3.test',
                            account: { id: 'account-1' },
                        },
                    });
                }
                if (url.endsWith('/cfd_tunnel')) {
                    return Response.json({
                        success: true,
                        result: {
                            id: 'tunnel-1',
                            account_tag: 'account-1',
                        },
                    });
                }
                if (url.endsWith('/dns_records')) {
                    return Response.json({
                        success: true,
                        result: { id: 'dns-1' },
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
            }
        );
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
                maxSafeRetries: 1,
            },
            fetchMock as unknown as typeof fetch
        );

        await expect(provisioner.provision('env-one')).resolves.toMatchObject({
            tunnelId: 'tunnel-1',
            dnsRecordId: 'dns-1',
        });
        expect(zoneAttempts).toBe(2);
        expect(requestIds.every((value) => value.length > 0)).toBe(true);
        expect(new Set(requestIds).size).toBe(requestIds.length);
    });

    it('bounds stalled Cloudflare requests with a phase-specific deadline', async () => {
        const fetchMock = vi.fn(
            async (
                _input: string | URL | Request,
                init?: RequestInit
            ) =>
                await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(init.signal?.reason),
                        { once: true }
                    );
                })
        );
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
                requestTimeoutMs: 100,
                maxSafeRetries: 0,
            },
            fetchMock as unknown as typeof fetch
        );

        await expect(provisioner.provision('env-one')).rejects.toThrow(
            'Cloudflare GET request timed out after 100ms'
        );
    });

    it('caps concurrent provider calls without serializing callers permanently', async () => {
        let active = 0;
        let peakActive = 0;
        let tunnelCounter = 0;
        const fetchMock = vi.fn(
            async (
                input: string | URL | Request,
                _init?: RequestInit
            ) => {
                active += 1;
                peakActive = Math.max(peakActive, active);
                await new Promise((resolvePromise) =>
                    setTimeout(resolvePromise, 5)
                );
                active -= 1;
                const url = String(input);
                if (url.endsWith('/zones/zone-1')) {
                    return Response.json({
                        success: true,
                        result: {
                            id: 'zone-1',
                            name: 'connect.or3.test',
                            account: { id: 'account-1' },
                        },
                    });
                }
                if (url.endsWith('/cfd_tunnel')) {
                    tunnelCounter += 1;
                    return Response.json({
                        success: true,
                        result: {
                            id: `tunnel-${tunnelCounter}`,
                            account_tag: 'account-1',
                        },
                    });
                }
                if (url.endsWith('/dns_records')) {
                    return Response.json({
                        success: true,
                        result: { id: `dns-${tunnelCounter}` },
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
            }
        );
        const provisioner = new CloudflareTunnelProvisioner(
            {
                accountId: 'account-1',
                zoneId: 'zone-1',
                apiToken: 'api-secret',
                hostnameSuffix: 'connect.or3.test',
                maxConcurrency: 1,
            },
            fetchMock as unknown as typeof fetch
        );

        await expect(
            Promise.all([
                provisioner.provision('env-one'),
                provisioner.provision('env-two'),
            ])
        ).resolves.toHaveLength(2);
        expect(peakActive).toBe(1);
    });
});
