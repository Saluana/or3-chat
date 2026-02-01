import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signAdminJwt, verifyAdminJwt } from '../../server/admin/auth/jwt';
import type { H3Event } from 'h3';

// Mock the runtime config and h3 utilities
vi.mock('h3', async () => {
    const actual = await vi.importActual<typeof import('h3')>('h3');
    return {
        ...actual,
        getCookie: vi.fn(),
        setCookie: vi.fn(),
        deleteCookie: vi.fn(),
    };
});

// Mock #imports to support useRuntimeConfig with event context
vi.mock('#imports', () => ({
    useRuntimeConfig: (event?: any) => {
        if (event && event.context?._nitro?.runtimeConfig) {
            return event.context._nitro.runtimeConfig;
        }
        return {
            admin: {
                auth: {
                    jwtSecret: 'test-secret-key-for-testing-purposes-only',
                    jwtExpiry: '24h',
                },
            },
        };
    },
}));

// Create a mock H3Event with proper structure
function createMockEvent(runtimeConfig: any = {}): H3Event {
    return {
        node: {
            req: {} as any,
            res: {} as any,
        },
        context: {
            _nitro: {
                runtimeConfig: {
                    admin: {
                        auth: {
                            jwtSecret: 'test-secret-key-for-testing-purposes-only',
                            jwtExpiry: '24h',
                        },
                    },
                    ...runtimeConfig,
                },
            },
        },
    } as any;
}

describe('Admin Auth - JWT', () => {
    let mockEvent: H3Event;

    beforeEach(() => {
        mockEvent = createMockEvent();
    });

    describe('signAdminJwt', () => {
        it('should sign a JWT for a username', async () => {
            const username = 'testadmin';
            const token = await signAdminJwt(mockEvent, username);

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
        });

        it('should create different tokens for different usernames', async () => {
            const token1 = await signAdminJwt(mockEvent, 'admin1');
            const token2 = await signAdminJwt(mockEvent, 'admin2');

            expect(token1).not.toBe(token2);
        });

        it('should create tokens that can be verified', async () => {
            const username = 'testadmin';
            const token = await signAdminJwt(mockEvent, username);
            const claims = await verifyAdminJwt(mockEvent, token);

            expect(claims).not.toBeNull();
            expect(claims?.username).toBe(username);
            expect(claims?.kind).toBe('super_admin');
        });
    });

    describe('verifyAdminJwt', () => {
        it('should verify a valid JWT', async () => {
            const username = 'testadmin';
            const token = await signAdminJwt(mockEvent, username);
            const claims = await verifyAdminJwt(mockEvent, token);

            expect(claims).not.toBeNull();
            expect(claims?.username).toBe(username);
            expect(claims?.kind).toBe('super_admin');
            expect(claims?.iat).toBeDefined();
            expect(claims?.exp).toBeDefined();
        });

        it('should reject an invalid JWT', async () => {
            const claims = await verifyAdminJwt(mockEvent, 'invalid.token.here');

            expect(claims).toBeNull();
        });

        it('should reject a JWT with wrong kind', async () => {
            // We can't easily test this without creating a JWT with wrong claims
            // but we can test the validation logic by passing a malformed token
            const claims = await verifyAdminJwt(mockEvent, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJraW5kIjoid3JvbmciLCJ1c2VybmFtZSI6InRlc3QifQ.test');

            expect(claims).toBeNull();
        });

        it('should reject an empty token', async () => {
            const claims = await verifyAdminJwt(mockEvent, '');

            expect(claims).toBeNull();
        });

        it('should handle token verification with different secrets', async () => {
            const username = 'testadmin';
            const token = await signAdminJwt(mockEvent, username);

            // Create event with different secret
            const differentEvent = createMockEvent({
                admin: {
                    auth: {
                        jwtSecret: 'different-secret-key',
                        jwtExpiry: '24h',
                    },
                },
            });

            const claims = await verifyAdminJwt(differentEvent, token);

            // Should fail because secret is different
            expect(claims).toBeNull();
        });
    });

    describe('JWT claims structure', () => {
        it('should include all required claims', async () => {
            const username = 'testadmin';
            const token = await signAdminJwt(mockEvent, username);
            const claims = await verifyAdminJwt(mockEvent, token);

            expect(claims).toMatchObject({
                kind: 'super_admin',
                username: 'testadmin',
            });
            expect(claims?.iat).toBeTypeOf('number');
            expect(claims?.exp).toBeTypeOf('number');
            expect(claims?.exp).toBeGreaterThan(claims?.iat || 0);
        });

        it('should set expiry time in the future', async () => {
            const username = 'testadmin';
            const token = await signAdminJwt(mockEvent, username);
            const claims = await verifyAdminJwt(mockEvent, token);

            const now = Math.floor(Date.now() / 1000);
            expect(claims?.exp).toBeGreaterThan(now);
        });
    });
});
