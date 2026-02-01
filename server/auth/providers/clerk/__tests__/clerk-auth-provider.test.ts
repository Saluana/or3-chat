import { describe, it, expect, vi } from 'vitest';
import type { H3Event } from 'h3';
import { clerkAuthProvider } from '../clerk-auth-provider';

vi.mock('@clerk/nuxt/server', () => ({
    clerkClient: vi.fn(() => ({
        users: {
            getUser: vi.fn(),
        },
    })),
}));

describe('clerkAuthProvider', () => {
    it('returns null (or throws in dev) when auth context is missing', async () => {
        const event = { context: {}, node: { req: { headers: {} } } } as H3Event;

        if (import.meta.dev) {
            await expect(clerkAuthProvider.getSession(event)).rejects.toThrow(
                'Clerk auth context missing'
            );
        } else {
            await expect(clerkAuthProvider.getSession(event)).resolves.toBeNull();
        }
    });
});
