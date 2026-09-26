import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
    clearHostActivationsForTests,
    registerHostActivation,
    resolveHostActivation,
} from '../../../utils/plugins/isolation/activation-registry';
import { getRetainedSelectionAuthority } from '../../../utils/plugins/setup/selection-authority-registry';

/**
 * The mint route is the only way a portable bridge gets an identity. These
 * tests pin the gate: the handle is registered only for an installed, enabled,
 * usable plugin whose current package has a current approved review, and the
 * record carries the server-resolved digest and grants rather than anything the
 * caller sent.
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

const listInstalledExtensionsMock = vi.fn();
vi.mock('../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: listInstalledExtensionsMock as any,
}));

const getEnabledPluginsMock = vi.fn();
const getPluginGrantReviewMock = vi.fn();
vi.mock('../../../admin/plugins/workspace-plugin-store', () => ({
    getEnabledPlugins: getEnabledPluginsMock as any,
    getPluginGrantReview: getPluginGrantReviewMock as any,
}));

vi.mock('../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({ id: 'store' }),
}));

vi.mock('../../../admin/extensions/paths', () => ({
    EXTENSIONS_BASE_DIR: '/extensions',
}));

const checkPluginAccessMock = vi.fn();
vi.mock('../../../utils/plugins/access/require-plugin-access', () => ({
    checkPluginAccess: checkPluginAccessMock as any,
}));

const resolvePluginPackageMock = vi.fn();
vi.mock('../../../utils/plugins/setup/discovery', () => ({
    resolvePluginPackage: resolvePluginPackageMock as any,
}));

const packageGrantCandidateMock = vi.fn();
const readPackageManifestMock = vi.fn();
vi.mock('../../../admin/plugins/package-operation-support', () => ({
    packageGrantCandidate: packageGrantCandidateMock as any,
    readPackageManifest: readPackageManifestMock as any,
}));

const handler = (await import('../isolation/activation.post')).default as (
    event: H3Event
) => Promise<unknown>;

const DIGEST = `sha256-${'a'.repeat(64)}`;

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as unknown as H3Event;
}

async function expectStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
    await expect(promise).rejects.toMatchObject({ statusCode });
}

describe('POST /api/plugins/isolation/activation', () => {
    beforeEach(() => {
        clearHostActivationsForTests();
        mutationMock.mockReset();
        requireSessionMock.mockReset();
        requireCanMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user_1' },
            workspace: { id: 'ws_1' },
        });
        readBodyMock.mockReset().mockResolvedValue({ pluginId: 'example.plugin' });
        listInstalledExtensionsMock.mockReset().mockResolvedValue([
            { kind: 'plugin', id: 'example.plugin', path: '/extensions/example' },
        ]);
        getEnabledPluginsMock.mockReset().mockResolvedValue(['example.plugin']);
        checkPluginAccessMock
            .mockReset()
            .mockResolvedValue({ decision: { allowed: true, reasons: [] } });
        resolvePluginPackageMock.mockReset().mockResolvedValue({
            pluginId: 'example.plugin',
            path: '/extensions/example',
            source: 'package',
            digest: DIGEST,
        });
        readPackageManifestMock.mockReset().mockResolvedValue({
            kind: 'plugin',
            id: 'example.plugin',
            access: undefined,
        });
        packageGrantCandidateMock.mockReset().mockResolvedValue({
            requestedGrants: ['network.http'],
            releaseId: null,
            packageDigest: DIGEST,
            authoritySha256: null,
            authority: null,
        });
        getPluginGrantReviewMock.mockReset().mockResolvedValue({
            requestedGrants: ['network.http'],
            approvedGrants: ['network.http'],
            revision: 'g1',
            status: 'current',
            authoritySha256: null,
            packageDigest: DIGEST,
        });
        configMock.mockReset().mockReturnValue({ auth: { enabled: true }, admin: {} });
    });

    it('runs the mutation guard before reading anything else', async () => {
        mutationMock.mockImplementation(() => {
            throw Object.assign(new Error('Missing mutation intent'), { statusCode: 403 });
        });
        await expectStatus(handler(makeEvent()), 403);
        expect(readBodyMock).not.toHaveBeenCalled();
    });

    it('requires an authenticated workspace session', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: false,
            user: null,
            workspace: null,
        });
        requireSessionMock.mockImplementation(() => {
            throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
        });
        await expectStatus(handler(makeEvent()), 401);
    });

    it('refuses an uninstalled, disabled or access-denied plugin', async () => {
        resolvePluginPackageMock.mockResolvedValueOnce(null);
        await expectStatus(handler(makeEvent()), 404);

        getEnabledPluginsMock.mockResolvedValueOnce([]);
        await expectStatus(handler(makeEvent()), 403);

        checkPluginAccessMock.mockResolvedValueOnce({
            decision: { allowed: false, reasons: ['role-not-allowed'] },
        });
        await expectStatus(handler(makeEvent()), 403);
    });

    it('refuses when no selected package is recorded', async () => {
        resolvePluginPackageMock.mockResolvedValue(null);
        await expectStatus(handler(makeEvent()), 404);
    });

    it('refuses a package whose approved review is not current', async () => {
        getPluginGrantReviewMock.mockResolvedValue({
            requestedGrants: ['network.http'],
            approvedGrants: [],
            revision: 'g1',
            status: 'stale',
            reason: 'authority-expanded',
        });
        await expectStatus(handler(makeEvent()), 403);
        await expect(handler(makeEvent())).rejects.toMatchObject({
            data: { code: 'grant-review-unresolved' },
        });
    });

    it('mints a handle sealed to the server-resolved digest and grants', async () => {
        const response = (await handler(makeEvent())) as {
            ok: boolean;
            activation: {
                activationId: string;
                generation: number;
                pluginId: string;
                packageDigest: string | null;
                approvedGrants: readonly string[];
            };
        };

        expect(response.ok).toBe(true);
        expect(response.activation).toMatchObject({
            pluginId: 'example.plugin',
            packageDigest: DIGEST,
            approvedGrants: ['network.http'],
        });
        expect(response.activation.generation).toBeGreaterThan(0);

        // The handle resolves to a sealed record, and its live selection
        // authority was minted with it at the same server generation.
        const resolved = resolveHostActivation(response.activation.activationId);
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
            expect(resolved.record.workspaceId).toBe('ws_1');
            expect(resolved.record.userId).toBe('user_1');
            expect(resolved.record.packageDigest).toBe(DIGEST);
        }
        expect(
            getRetainedSelectionAuthority(
                'example.plugin',
                'ws_1',
                response.activation.generation
            )
        ).not.toBeNull();
    });

    it('releases selection authority when an activation expires', () => {
        let now = 1_000;
        const expired = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: {
                requestedGrants: ['network.http'],
                approvedGrants: ['network.http'],
                revision: 'g1',
                status: 'current',
                authoritySha256: null,
                packageDigest: DIGEST,
            },
            ttlMs: 10,
            now: () => now,
        });
        expect(
            getRetainedSelectionAuthority('example.plugin', 'ws_1', expired.generation)
        ).not.toBeNull();

        now = 1_011;
        expect(resolveHostActivation(expired.activationId, { now: () => now })).toMatchObject({
            ok: false,
            code: 'activation-expired',
        });
        expect(
            getRetainedSelectionAuthority('example.plugin', 'ws_1', expired.generation)
        ).toBeNull();
    });
});
