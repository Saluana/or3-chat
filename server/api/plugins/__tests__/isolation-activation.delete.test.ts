import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    clearHostActivationsForTests,
    registerHostActivation,
    resolveHostActivation,
} from '../../../utils/plugins/isolation/activation-registry';

/**
 * Teardown tests for the portable activation endpoint.
 *
 * DELETE revokes the caller's own handle. The workspace may already have
 * changed (teardown after a switch revokes the previous workspace's handle
 * from the new one), but another user's handle is never revocable here.
 */

vi.mock('h3', () => ({
    createError: (input: { statusCode?: number; statusMessage?: string; message?: string }) =>
        Object.assign(new Error(input.statusMessage ?? input.message ?? 'error'), {
            statusCode: input.statusCode,
            data: (input as { data?: unknown }).data,
        }),
    defineEventHandler: (handler: unknown) => handler,
}));

const configMock = vi.fn();
vi.mock('#imports', () => ({
    useRuntimeConfig: () => configMock(),
}));

const mutationMock = vi.fn();
vi.mock('../../../utils/plugins/connections/api-context', () => ({
    requirePluginMutation: mutationMock as any,
}));

const requireSessionMock = vi.fn();
const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireSession: requireSessionMock as any,
    requireCan: requireCanMock as any,
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const readBodyMock = vi.fn();
vi.mock('../../../utils/security/limited-json-body', () => ({
    readLimitedJsonBody: readBodyMock as any,
}));

const handler = (await import('../isolation/activation.delete')).default as (
    event: H3Event
) => Promise<unknown>;

function grants(): PluginGrantReviewSnapshot {
    return {
        requestedGrants: ['network.http'],
        approvedGrants: ['network.http'],
        revision: 'g1',
        status: 'current',
        authoritySha256: null,
        packageDigest: null,
    };
}

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as unknown as H3Event;
}

describe('DELETE /api/plugins/isolation/activation', () => {
    beforeEach(() => {
        mutationMock.mockReset();
        requireSessionMock.mockReset();
        requireCanMock.mockReset();
        clearHostActivationsForTests();
        configMock.mockReset().mockReturnValue({ auth: { enabled: true } });
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user_1' },
            workspace: { id: 'ws_1' },
        });
        readBodyMock.mockReset().mockResolvedValue({});
    });

    it('revokes the caller own handle', async () => {
        const record = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: null,
            grants: grants(),
        });
        readBodyMock.mockResolvedValue({ activationId: record.activationId });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            alreadyRevoked: false,
        });
        expect(resolveHostActivation(record.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
    });

    it('revokes the caller own handle from another workspace after a switch', async () => {
        const record = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: null,
            grants: grants(),
        });
        // The session already moved on; the stale handle still belongs to
        // this user, so teardown must succeed rather than strand it.
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user_1' },
            workspace: { id: 'ws_2' },
        });
        readBodyMock.mockResolvedValue({ activationId: record.activationId });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            alreadyRevoked: false,
        });
        expect(resolveHostActivation(record.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
    });

    it('refuses another user handle', async () => {
        const record = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_2',
            packageDigest: null,
            grants: grants(),
        });
        readBodyMock.mockResolvedValue({ activationId: record.activationId });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 403,
            data: { code: 'activation-session-mismatch' },
        });
        expect(resolveHostActivation(record.activationId).ok).toBe(true);
    });

    it('is idempotent for unknown and already-revoked handles', async () => {
        readBodyMock.mockResolvedValue({ activationId: 'act_forged' });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        const record = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: null,
            grants: grants(),
        });
        readBodyMock.mockResolvedValue({ activationId: record.activationId });
        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            alreadyRevoked: false,
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            alreadyRevoked: true,
        });
    });
});
