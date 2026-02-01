/**
 * Unit tests for proxy-safe request identity utilities
 * Tests:
 * - trustProxy=false => socket address
 * - trustProxy=true => parses X-Forwarded-For first entry
 * - invalid forwarded values => null
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
import { getClientIp, getProxyRequestHost, type ProxyTrustConfig } from '../request-identity';

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
    });
});
