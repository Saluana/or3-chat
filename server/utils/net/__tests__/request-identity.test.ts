/**
 * @module server/utils/net/__tests__/request-identity.test
 *
 * Purpose:
 * Verify proxy-safe request identity utilities.
 *
 * Behavior:
 * - Uses socket address when proxy trust is disabled.
 * - Parses forwarded headers when proxy trust is enabled.
 * - Fails closed to null for missing or invalid forwarded values.
 *
 * Non-Goals:
 * - Comprehensive IP format validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock h3 module
const mockHeaders: Record<string, string | string[]> = {};

vi.mock('h3', () => ({
    getHeader: vi.fn((event: any, name: string) => {
        // Support both direct headers access and event structure
        const headers = event.node?.req?.headers || event.headers || {};
        const value = headers[name.toLowerCase()];
        if (Array.isArray(value)) return value[0];
        return value;
    }),
}));

// Import after mock
import {
    getClientIp,
    getProxyRequestHost,
    getProxyRequestProtocol,
    type ProxyTrustConfig,
} from '../request-identity';

describe('request-identity utilities', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getClientIp', () => {
        it('should use socket address when trustProxy is false', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-forwarded-for': '203.0.113.1, 198.51.100.1',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: false };
            const ip = getClientIp(event as any, config);

            expect(ip).toBe('192.168.1.100');
        });

        it('should parse X-Forwarded-For when trustProxy is true', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-forwarded-for': '203.0.113.1, 198.51.100.1',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const ip = getClientIp(event as any, config);

            // Should take the first IP (client)
            expect(ip).toBe('203.0.113.1');
        });

        it('should parse X-Real-Ip when configured', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-real-ip': '203.0.113.5',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { 
                trustProxy: true, 
                forwardedForHeader: 'x-real-ip' 
            };
            const ip = getClientIp(event as any, config);

            expect(ip).toBe('203.0.113.5');
        });

        it('should return null for invalid X-Forwarded-For', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-forwarded-for': 'not-an-ip',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const ip = getClientIp(event as any, config);

            expect(ip).toBeNull();
        });

        it('should return null when X-Forwarded-For is missing and trustProxy is true', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {},
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const ip = getClientIp(event as any, config);

            expect(ip).toBeNull();
        });

        it('should handle IPv6 addresses in X-Forwarded-For', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-forwarded-for': '2001:db8::1, 198.51.100.1',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const ip = getClientIp(event as any, config);

            expect(ip).toBe('2001:db8::1');
        });

        it('should return null when socket address is missing and trustProxy is false', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {},
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: false };
            const ip = getClientIp(event as any, config);

            expect(ip).toBeNull();
        });

        it('should handle X-Forwarded-For with multiple spaces', () => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-forwarded-for': '  203.0.113.1  ,  198.51.100.1  ',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const ip = getClientIp(event as any, config);

            expect(ip).toBe('203.0.113.1');
        });

        it.each([
            '999.999.999.999',
            '203.0.113',
            '203.0.113.1:443',
            '::::',
            '2001:db8::1.example',
        ])('should reject malformed forwarded client IP %s', (forwardedFor) => {
            const event = {
                node: {
                    req: {
                        socket: { remoteAddress: '192.168.1.100' },
                        headers: {
                            'x-forwarded-for': forwardedFor,
                        },
                    },
                },
            };

            expect(
                getClientIp(event as any, { trustProxy: true })
            ).toBeNull();
        });
    });

    describe('getRequestHost', () => {
        it('should use Host header when trustProxy is false', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            'host': 'example.com',
                            'x-forwarded-host': 'forwarded.example.com',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: false };
            const host = getProxyRequestHost(event as any, config);

            expect(host).toBe('example.com');
        });

        it('should use X-Forwarded-Host when trustProxy is true', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            'host': 'example.com',
                            'x-forwarded-host': 'forwarded.example.com',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const host = getProxyRequestHost(event as any, config);

            expect(host).toBe('forwarded.example.com');
        });

        it('should return null when forwarded host missing and trustProxy true', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            'host': 'example.com',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const host = getProxyRequestHost(event as any, config);

            // When trustProxy is true, we fail closed if forwarded host is missing
            expect(host).toBeNull();
        });

        it('should return null when forwarded host is empty and trustProxy is true', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            'host': 'example.com',
                            'x-forwarded-host': '',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: true };
            const host = getProxyRequestHost(event as any, config);

            expect(host).toBeNull();
        });

        it('should return null when no host headers present', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {},
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: false };
            const host = getProxyRequestHost(event as any, config);

            expect(host).toBeNull();
        });

        it('should lowercase host names', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            'host': 'EXAMPLE.COM',
                        },
                    },
                },
            };

            const config: ProxyTrustConfig = { trustProxy: false };
            const host = getProxyRequestHost(event as any, config);

            expect(host).toBe('example.com');
        });

        it.each([
            'admin.example.com:443@evil.example',
            'admin.example.com/path',
            'admin.example.com?next=evil.example',
            'admin.example.com#evil.example',
            'admin.example.com\\@evil.example',
            'admin.example.com:',
            '[::1',
        ])('should reject malformed forwarded host %s', (forwardedHost) => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            host: 'internal.local',
                            'x-forwarded-host': forwardedHost,
                        },
                    },
                },
            };

            expect(
                getProxyRequestHost(event as any, { trustProxy: true })
            ).toBeNull();
        });

        it('should accept the first well-formed forwarded host in a proxy list', () => {
            const event = {
                node: {
                    req: {
                        socket: {},
                        headers: {
                            host: 'internal.local',
                            'x-forwarded-host':
                                'Admin.Example.com:443, internal.local',
                        },
                    },
                },
            };

            expect(
                getProxyRequestHost(event as any, { trustProxy: true })
            ).toBe('admin.example.com:443');
        });
    });

    describe('getProxyRequestProtocol', () => {
        it('ignores a spoofed forwarded protocol when proxy trust is disabled', () => {
            const event = {
                node: {
                    req: {
                        socket: { encrypted: false },
                        headers: { 'x-forwarded-proto': 'https' },
                    },
                },
            };

            expect(
                getProxyRequestProtocol(event as any, { trustProxy: false })
            ).toBe('http');
        });

        it('uses the first protocol in a trusted proxy chain', () => {
            const event = {
                node: {
                    req: {
                        socket: { encrypted: false },
                        headers: { 'x-forwarded-proto': 'HTTPS, http' },
                    },
                },
            };

            expect(
                getProxyRequestProtocol(event as any, { trustProxy: true })
            ).toBe('https');
        });

        it.each([undefined, '', 'ftp', 'https http'])(
            'fails closed for missing or malformed trusted protocol %s',
            (forwardedProto) => {
                const headers: Record<string, string> = {};
                if (forwardedProto !== undefined) {
                    headers['x-forwarded-proto'] = forwardedProto;
                }
                const event = {
                    node: {
                        req: {
                            socket: { encrypted: false },
                            headers,
                        },
                    },
                };

                expect(
                    getProxyRequestProtocol(event as any, { trustProxy: true })
                ).toBeNull();
            }
        );
    });
});
