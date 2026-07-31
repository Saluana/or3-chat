import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
    evaluateUnknownUserRegistration,
    resolveRegistrationMode,
} from '../../server/auth/registration';
import { createInviteToken } from '../../server/auth/invite-token';

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        auth: {
            invite: {
                tokenSecret: 'invite-secret',
            },
        },
    }),
}));

const mockStore = {
    getOrCreateUser: async () => ({ userId: 'u1' }),
    getOrCreateDefaultWorkspace: async () => ({ workspaceId: 'w1', workspaceName: 'W' }),
    getWorkspaceRole: async () => 'owner' as const,
    listUserWorkspaces: async () => [],
    createWorkspace: async () => ({ workspaceId: 'w1' }),
    updateWorkspace: async () => {},
    removeWorkspace: async () => {},
    setActiveWorkspace: async () => {},
    consumeInvite: async () => ({ ok: true as const, role: 'viewer' as const }),
    acceptInviteAndProvisionUser: async () => ({
        ok: true as const,
        userId: 'u1',
        workspaceId: 'w1',
        role: 'viewer' as const,
        created: true,
    }),
};

function makeEvent(): H3Event {
    return {
        node: {
            req: {
                headers: {},
            },
        },
        context: {},
    } as unknown as H3Event;
}

describe('auth registration policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves explicit registration mode', () => {
        const mode = resolveRegistrationMode({
            auth: {
                registrationMode: 'invite_only',
                autoProvision: true,
            },
        } as any);
        expect(mode).toBe('invite_only');
    });

    it('falls back to legacy autoProvision', () => {
        expect(
            resolveRegistrationMode({ auth: { autoProvision: true } } as any)
        ).toBe('open');
        expect(
            resolveRegistrationMode({ auth: { autoProvision: false } } as any)
        ).toBe('disabled');
    });

    it('allows open mode', () => {
        const decision = evaluateUnknownUserRegistration({
            event: makeEvent(),
            store: mockStore as any,
            mode: 'open',
        });
        expect(decision.allowed).toBe(true);
    });

    it('denies disabled mode', () => {
        const decision = evaluateUnknownUserRegistration({
            event: makeEvent(),
            store: mockStore as any,
            mode: 'disabled',
        });
        expect(decision).toMatchObject({ allowed: false, reason: 'disabled' });
    });

    it('requires invite for invite_only mode', () => {
        const decision = evaluateUnknownUserRegistration({
            event: makeEvent(),
            store: mockStore as any,
            mode: 'invite_only',
        });
        expect(decision).toMatchObject({ allowed: false, reason: 'invite_required' });
    });

    it('accepts valid invite token in invite_only mode', () => {
        const token = createInviteToken(
            {
                workspaceId: 'ws_1',
                email: 'test@example.com',
                exp: Math.floor(Date.now() / 1000) + 3600,
            },
            'invite-secret'
        );

        const decision = evaluateUnknownUserRegistration({
            event: makeEvent(),
            store: mockStore as any,
            mode: 'invite_only',
            inviteToken: token,
        });

        expect(decision.allowed).toBe(true);
        if (decision.allowed && decision.invite) {
            expect(decision.invite.payload.workspaceId).toBe('ws_1');
        }
    });
});
