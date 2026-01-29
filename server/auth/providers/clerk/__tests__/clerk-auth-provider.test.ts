/**
 * Unit tests for Clerk auth provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clerkAuthProvider } from '../clerk-auth-provider';
import type { H3Event } from 'h3';

// Mock Clerk client
const mockClerkClient = vi.fn();
vi.mock('@clerk/nuxt/server', () => ({
    clerkClient: mockClerkClient,
}));

// Mock provider IDs
vi.mock('~~/shared/cloud/provider-ids', () => ({
    CLERK_PROVIDER_ID: 'clerk',
}));

// Helper to create mock H3 event
function createMockEvent(authContext: {
    userId: string | null;
    sessionClaims?: { exp?: number; [key: string]: unknown };
}): H3Event {
    return {
        context: {
            auth: () => authContext,
        },
    } as unknown as H3Event;
}

describe('clerkAuthProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getSession() - basic auth checks', () => {
        it('returns null when userId is missing', async () => {
            const event = createMockEvent({ userId: null });
            const session = await clerkAuthProvider.getSession(event);
            expect(session).toBeNull();
        });

        it('returns null when userId is null', async () => {
            const event = createMockEvent({ 
                userId: null,
                sessionClaims: { exp: Date.now() / 1000 + 3600 },
            });
            const session = await clerkAuthProvider.getSession(event);
            expect(session).toBeNull();
        });
    });

    describe('getSession() - session expiry validation', () => {
        it('throws when exp claim is missing', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: {},
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Invalid or missing session expiry claim');
        });

        it('throws when exp is undefined', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: undefined },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Invalid or missing session expiry claim');
        });

        it('throws when exp is 0', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: 0 },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Invalid or missing session expiry claim');
        });

        it('throws when exp is negative', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: -3600 },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Invalid or missing session expiry claim');
        });

        it('throws when exp is not a number', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: '1234567890' as unknown as number },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Invalid or missing session expiry claim');
        });
    });

    describe('getSession() - email validation', () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;

        it('throws when user has no email addresses', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: 'John',
                        username: 'john_doe',
                        emailAddresses: [],
                        primaryEmailAddressId: null,
                    }),
                },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('User has no verified primary email address');
        });

        it('throws when primaryEmailAddressId does not match any email', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: 'John',
                        username: 'john_doe',
                        emailAddresses: [
                            { id: 'email_456', emailAddress: 'john@example.com' },
                        ],
                        primaryEmailAddressId: 'email_789', // Mismatch
                    }),
                },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('User has no verified primary email address');
        });

        it('throws when primary email has no emailAddress field', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: 'John',
                        username: 'john_doe',
                        emailAddresses: [
                            { id: 'email_456', emailAddress: null },
                        ],
                        primaryEmailAddressId: 'email_456',
                    }),
                },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('User has no verified primary email address');
        });
    });

    describe('getSession() - successful session creation', () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;

        it('returns valid session with all fields populated', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { 
                    exp: futureExp,
                    sub: 'user_123',
                    iat: futureExp - 3600,
                },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: 'John',
                        lastName: 'Doe',
                        username: 'john_doe',
                        emailAddresses: [
                            { id: 'email_456', emailAddress: 'john@example.com' },
                        ],
                        primaryEmailAddressId: 'email_456',
                    }),
                },
            });

            const session = await clerkAuthProvider.getSession(event);

            expect(session).toBeDefined();
            expect(session?.provider).toBe('clerk');
            expect(session?.user.id).toBe('user_123');
            expect(session?.user.email).toBe('john@example.com');
            expect(session?.user.displayName).toBe('John');
            expect(session?.expiresAt.getTime()).toBe(futureExp * 1000);
            expect(session?.claims).toEqual({
                exp: futureExp,
                sub: 'user_123',
                iat: futureExp - 3600,
            });
        });

        it('uses username as displayName when firstName is missing', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: null,
                        username: 'john_doe',
                        emailAddresses: [
                            { id: 'email_456', emailAddress: 'john@example.com' },
                        ],
                        primaryEmailAddressId: 'email_456',
                    }),
                },
            });

            const session = await clerkAuthProvider.getSession(event);

            expect(session?.user.displayName).toBe('john_doe');
        });

        it('uses email as displayName when firstName and username are missing', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: null,
                        username: null,
                        emailAddresses: [
                            { id: 'email_456', emailAddress: 'john@example.com' },
                        ],
                        primaryEmailAddressId: 'email_456',
                    }),
                },
            });

            const session = await clerkAuthProvider.getSession(event);

            expect(session?.user.displayName).toBe('john@example.com');
        });

        it('correctly calculates expiry timestamp', async () => {
            const now = Math.floor(Date.now() / 1000);
            const expirySeconds = now + 7200; // 2 hours from now

            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: expirySeconds },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockResolvedValue({
                        id: 'user_123',
                        firstName: 'John',
                        username: 'john_doe',
                        emailAddresses: [
                            { id: 'email_456', emailAddress: 'john@example.com' },
                        ],
                        primaryEmailAddressId: 'email_456',
                    }),
                },
            });

            const session = await clerkAuthProvider.getSession(event);

            expect(session?.expiresAt.getTime()).toBe(expirySeconds * 1000);
            expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });
    });

    describe('getSession() - Clerk API failures', () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;

        it('throws when Clerk API returns error', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockRejectedValue(new Error('Clerk API error')),
                },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Clerk API error');
        });

        it('throws when Clerk API times out', async () => {
            const event = createMockEvent({
                userId: 'user_123',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockRejectedValue(new Error('Request timeout')),
                },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('Request timeout');
        });

        it('throws when Clerk returns 404 for user', async () => {
            const event = createMockEvent({
                userId: 'user_nonexistent',
                sessionClaims: { exp: futureExp },
            });

            mockClerkClient.mockReturnValue({
                users: {
                    getUser: vi.fn().mockRejectedValue(new Error('User not found')),
                },
            });

            await expect(clerkAuthProvider.getSession(event))
                .rejects
                .toThrow('User not found');
        });
    });

    describe('provider metadata', () => {
        it('has correct provider name', () => {
            expect(clerkAuthProvider.name).toBe('clerk');
        });
    });
});
