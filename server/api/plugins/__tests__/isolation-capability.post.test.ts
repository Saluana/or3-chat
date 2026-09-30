import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    clearHostActivationsForTests,
    registerHostActivation,
    revokeHostActivation,
    type HostActivationRecord,
} from '../../../utils/plugins/isolation/activation-registry';
import { getActivationAdmissionStats } from '../../../utils/plugins/isolation/activation-admission';

/**
 * Authorization tests for the portable capability endpoint (finding 1).
 *
 * The endpoint is the authenticated bridge between a sandbox and server-owned
 * capabilities. Its identity is a server-minted activation handle: plugin,
 * workspace, user, generation, package digest and grants come from the sealed
 * record, never from the request. These tests pin the refusals: the mutation
 * guard runs first, then session + workspace write, then the handle and its
 * live state (session, enabled, access, selected package), and only then the
 * capability, which is dispatched through the host RPC broker.
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

const settingsValues = new Map<string, string>();
const settingsStore = {
    get: vi.fn(async (workspaceId: string, key: string) =>
        settingsValues.get(`${workspaceId}:${key}`) ?? null
    ),
    set: vi.fn(async (workspaceId: string, key: string, value: string) => {
        settingsValues.set(`${workspaceId}:${key}`, value);
    }),
    compareAndSet: vi.fn(
        async (workspaceId: string, key: string, expected: string | null, next: string) => {
            const fullKey = `${workspaceId}:${key}`;
            const current = settingsValues.get(fullKey) ?? null;
            if (current !== expected) return false;
            settingsValues.set(fullKey, next);
            return true;
        }
    ),
};
vi.mock('../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => settingsStore,
}));

vi.mock('../../../admin/extensions/paths', () => ({
    EXTENSIONS_BASE_DIR: '/extensions',
}));

const resolvePluginPackageMock = vi.fn();
vi.mock('../../../utils/plugins/setup/discovery', () => ({
    resolvePluginPackage: resolvePluginPackageMock as any,
}));

const checkPluginAccessMock = vi.fn();
vi.mock('../../../utils/plugins/access/require-plugin-access', () => ({
    checkPluginAccess: checkPluginAccessMock as any,
}));

const packageGrantCandidateMock = vi.fn();
const readPackageManifestMock = vi.fn();
vi.mock('../../../admin/plugins/package-operation-support', () => ({
    packageGrantCandidate: packageGrantCandidateMock as any,
    readPackageManifest: readPackageManifestMock as any,
}));

const resolveConnectionServiceMock = vi.fn();
vi.mock('../../../utils/plugins/connections/resolve', () => ({
    resolveConnectionService: resolveConnectionServiceMock as any,
}));

const listProvidersMock = vi.fn((): Array<{ readonly id: string }> => []);
vi.mock('../../../utils/plugins/connections/providers/registry', () => ({
    listConnectionProviders: listProvidersMock as any,
}));

vi.mock('../../../utils/plugins/connections/transport', () => ({
    createFetchConnectionTransport: () => async () => ({ status: 200, headers: {}, body: '{}' }),
}));

const dispatchMock = vi.fn();
vi.mock('../../../utils/plugins/connections/dispatch', () => ({
    dispatchApprovedConnectionOperation: dispatchMock as any,
}));

const descriptorsMock = vi.fn(
    async (): Promise<{ setup: null; policy: unknown; problems: unknown[] }> => ({
        setup: null,
        policy: null,
        problems: [],
    })
);
const toDispatchPolicyMock = vi.fn((): unknown => null);
vi.mock('../../../utils/plugins/setup/load-descriptors', () => ({
    loadPackageDescriptors: descriptorsMock as any,
    toConnectionDispatchPolicy: toDispatchPolicyMock as any,
}));

type MockCapabilityMethod = {
    method: string;
    grant: string;
    handler: (...args: any[]) => unknown;
};
const aiFactoryMock = vi.fn(
    (_input: unknown): MockCapabilityMethod => ({
        method: 'ai.complete',
        grant: 'network.http',
        handler: async () => ({ text: 'ok' }),
    })
);
vi.mock('../../../utils/plugins/ai/plugin-invocation', () => ({
    PLUGIN_AI_COMPLETE_METHOD: 'ai.complete',
    createPluginAiCompleteMethod: aiFactoryMock as any,
}));

vi.mock('../../../utils/plugins/ai/openrouter-client', () => ({
    createOpenRouterPluginProvider: () => ({ complete: async () => ({}) }),
}));

vi.mock('../../../utils/plugins/connections/broker-binding', () => ({
    CONNECTIONS_DISPATCH_METHOD: 'connections.dispatch',
}));

const handler = (await import('../isolation/capability.post')).default as (
    event: H3Event
) => Promise<unknown>;
const { clearCapabilityGovernorsForTests } = (await import('../isolation/capability.post')) as {
    clearCapabilityGovernorsForTests: () => void;
};

const DIGEST = `sha256-${'a'.repeat(64)}`;

function grants(approved: readonly string[]): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
        authoritySha256: null,
        packageDigest: DIGEST,
    };
}

function makeEvent(
    res?: { on: (name: string, listener: () => void) => void; off: (name: string, listener: () => void) => void; writableEnded?: boolean }
): H3Event {
    return { context: {}, node: { req: { headers: {} }, ...(res ? { res } : {}) } } as unknown as H3Event;
}

/** Captures the close listener so a test can simulate a client disconnect. */
function makeCloseableEvent(): {
    event: H3Event;
    close: (writableEnded?: boolean) => void;
} {
    let listener: (() => void) | null = null;
    let writableEnded = false;
    const res = {
        on: (name: string, next: () => void) => {
            if (name === 'close') listener = next;
        },
        off: () => undefined,
        get writableEnded() {
            return writableEnded;
        },
    };
    return {
        event: makeEvent(res),
        close: (ended = false) => {
            writableEnded = ended;
            listener?.();
        },
    };
}

async function expectStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
    await expect(promise).rejects.toMatchObject({ statusCode });
}

/** Assert one refusal without calling the handler a second time. */
async function expectFailure(
    promise: Promise<unknown>,
    statusCode: number,
    code?: string
): Promise<void> {
    const error = await promise.then(
        () => {
            throw new Error('Expected the handler to refuse');
        },
        (caught: unknown) =>
            caught as { statusCode?: number; data?: { code?: string } }
    );
    expect(error.statusCode).toBe(statusCode);
    if (code !== undefined) expect(error.data?.code).toBe(code);
}

describe('POST /api/plugins/isolation/capability', () => {
    let record: HostActivationRecord;

    beforeEach(() => {
        mutationMock.mockReset();
        requireSessionMock.mockReset();
        requireCanMock.mockReset();
        clearHostActivationsForTests();
        clearCapabilityGovernorsForTests();
        settingsValues.clear();
        settingsStore.get.mockClear();
        settingsStore.set.mockClear();
        settingsStore.compareAndSet.mockClear();
        aiFactoryMock.mockReset();
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: async () => ({ text: 'ok' }),
        });
        dispatchMock.mockReset();
        resolveConnectionServiceMock.mockReset();
        listProvidersMock.mockReset();
        listProvidersMock.mockReturnValue([]);
        toDispatchPolicyMock.mockReset();
        toDispatchPolicyMock.mockReturnValue(null);
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            role: 'owner',
            user: { id: 'user_1' },
            workspace: { id: 'ws_1' },
        });
        readBodyMock.mockReset().mockResolvedValue({
            method: 'unknown.method',
            params: {},
        });
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
        getPluginGrantReviewMock.mockReset().mockResolvedValue(grants(['network.http']));
        configMock.mockReset().mockReturnValue({
            auth: { enabled: true },
            admin: {},
            openrouterApiKey: '',
        });
        record = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: grants(['network.http']),
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'unknown.method',
            params: {},
        });
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

        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user_1' },
            workspace: null,
        });
        await expectStatus(handler(makeEvent()), 401);
    });

    it('refuses an activation handle this host never minted', async () => {
        readBodyMock.mockResolvedValue({
            activationId: 'act_forged',
            method: 'ai.models',
        });
        await expectFailure(handler(makeEvent()), 403, 'activation-unknown');
    });

    it('refuses a missing handle instead of falling back to pluginId/generation', async () => {
        readBodyMock.mockResolvedValue({
            pluginId: 'example.plugin',
            generation: 99,
            method: 'ai.models',
        });
        await expectStatus(handler(makeEvent()), 400);
    });

    it('refuses an expired activation', async () => {
        const expired = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: grants(['network.http']),
            ttlMs: -1,
        });
        readBodyMock.mockResolvedValue({
            activationId: expired.activationId,
            method: 'ai.models',
        });
        await expectFailure(handler(makeEvent()), 409, 'activation-expired');
    });

    it('revokes an activation used from another session', async () => {
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
        });
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user_2' },
            workspace: { id: 'ws_1' },
        });
        await expectFailure(handler(makeEvent()), 403, 'activation-session-mismatch');

        // The handle does not survive the refusal.
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user_1' },
            workspace: { id: 'ws_1' },
        });
        await expectFailure(handler(makeEvent()), 409, 'activation-revoked');
    });

    it('revokes the activation when the plugin is disabled or its package changed', async () => {
        getEnabledPluginsMock.mockResolvedValueOnce([]);
        await expectStatus(handler(makeEvent()), 403);
        await expectStatus(handler(makeEvent()), 409);

        const second = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: grants(['network.http']),
        });
        readBodyMock.mockResolvedValue({
            activationId: second.activationId,
            method: 'ai.models',
        });
        resolvePluginPackageMock.mockResolvedValue({
            pluginId: 'example.plugin',
            path: '/extensions/example',
            source: 'package',
            digest: `sha256-${'d'.repeat(64)}`,
        });
        await expectFailure(handler(makeEvent()), 409, 'activation-stale');
        await expectFailure(handler(makeEvent()), 409, 'activation-revoked');
    });

    it('ignores a caller-supplied pluginId and generation', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        const governed = vi.fn(async (_params: unknown, _context: unknown) => ({ text: 'ok' }));
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: governed,
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            pluginId: 'other.plugin',
            generation: 999,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-forged',
        });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            result: { text: 'ok' },
        });
        expect(governed.mock.calls[0]![1]).toMatchObject({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            generation: record.generation,
        });
    });

    it('refuses a capability the sealed grant review does not approve', async () => {
        const unapproved = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: grants(['storage.read']),
        });
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            admin: {},
        });
        readBodyMock.mockResolvedValue({
            activationId: unapproved.activationId,
            method: 'ai.models',
        });
        getPluginGrantReviewMock.mockResolvedValueOnce(grants(['storage.read']));
        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 403,
            data: { rpcCode: 'grant-denied' },
        });
    });

    it('rebuilds the governed method from the durable identity ledger per activation', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        const governed = vi.fn(async (_params: unknown, _context: unknown) => ({ text: 'ok' }));
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: governed,
        });
        const second = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: grants(['network.http']),
        });

        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        await handler(makeEvent());
        readBodyMock.mockResolvedValue({
            activationId: second.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        await handler(makeEvent());

        // The governor is intentionally request-scoped; the durable settings
        // ledger, not an unbounded process map, carries identity spend forward.
        expect(aiFactoryMock).toHaveBeenCalledTimes(2);
    });

    it('refuses an unknown capability method', async () => {
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'unknown.method',
        });
        await expectStatus(handler(makeEvent()), 400);
    });

    it('refuses ai.complete without a host provider credential', async () => {
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        await expectStatus(handler(makeEvent()), 503);
        expect(aiFactoryMock).not.toHaveBeenCalled();
    });

    it('discloses the approved models with prices and limits (phase 9)', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-models',
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            result: {
                configured: true,
                models: [
                    {
                        id: 'm',
                        label: 'm',
                        priced: true,
                        promptPerMillion: 1,
                        completionPerMillion: 2,
                    },
                ],
            },
        });
    });

    it('reports an unconfigured model allowlist without refusing the disclosure', async () => {
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-models-empty',
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            result: { configured: false, models: [] },
        });
    });

    it('routes ai.complete through the governed factory with host prices', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-1',
        });
        const governed = vi.fn(async (_params: unknown, _context: unknown) => ({ text: 'ok' }));
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: governed,
        });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            result: { text: 'ok' },
        });
        expect(aiFactoryMock).toHaveBeenCalledTimes(1);
        const factoryInput = aiFactoryMock.mock.calls[0]![0] as {
            prices: Record<string, unknown>;
            allowedModels: string[];
        };
        expect(factoryInput.prices).toMatchObject({
            m: { promptPerMillion: 1, completionPerMillion: 2 },
        });
        expect(factoryInput.allowedModels).toEqual(['m']);
        expect(governed.mock.calls[0]![1]).toMatchObject({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            generation: record.generation,
        });
    });

    it('aborts an in-flight handler when the client disconnects', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        let aborted = false;
        const governed = vi.fn(
            async (_params: unknown, context: { signal: AbortSignal }) =>
                await new Promise((resolve) => {
                    context.signal.addEventListener('abort', () => {
                        aborted = true;
                        resolve({ text: 'aborted' });
                    });
                })
        );
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: governed,
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-abort',
        });

        const { event, close } = makeCloseableEvent();
        const pending = handler(event);
        await new Promise((resolve) => setTimeout(resolve, 0));
        close(false);

        await expectStatus(pending, 499);
        expect(aborted).toBe(true);
    });

    it('refuses connections.dispatch without a durable connection store', async () => {
        resolveConnectionServiceMock.mockReturnValue({
            service: {},
            storeId: 'memory',
            durable: false,
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'connections.dispatch',
            params: { ref: 'orc_a_r1', operationId: 'items.list', url: 'https://x.test/v1/' },
        });
        await expectStatus(handler(makeEvent()), 503);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('refuses connections.dispatch when the selected package has no usable policy', async () => {
        resolveConnectionServiceMock.mockReturnValue({
            service: {
                resolve: vi.fn(),
                revealCredential: vi.fn(),
            },
            storeId: 'durable',
            durable: true,
        });
        descriptorsMock.mockResolvedValue({ setup: null, policy: null, problems: [] });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'connections.dispatch',
            params: { ref: 'orc_a_r1', operationId: 'items.list', url: 'https://x.test/v1/' },
        });

        await expectStatus(handler(makeEvent()), 403);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('rejects a duplicate request ID across separate HTTP requests', async () => {
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-cross-request-dup',
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({ ok: true });

        // A second HTTP request reusing the same activation and request ID is
        // a replay, even though it gets a fresh broker.
        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 400,
            data: { rpcCode: 'replay' },
        });
    });

    it('rejects a reused request ID with a different method as a replay', async () => {
        readBodyMock.mockResolvedValueOnce({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-reused-id',
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({ ok: true });

        // The same ID must never silently become a different side effect.
        readBodyMock.mockResolvedValueOnce({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-reused-id',
        });
        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 400,
            data: { rpcCode: 'replay' },
        });
    });

    it('allows the same request ID under different activations', async () => {
        const second = registerHostActivation({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            packageDigest: DIGEST,
            grants: grants(['network.http']),
        });
        readBodyMock.mockResolvedValueOnce({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-shared-id',
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({ ok: true });

        readBodyMock.mockResolvedValueOnce({
            activationId: second.activationId,
            method: 'ai.models',
            requestId: 'rpc-shared-id',
        });
        await expect(handler(makeEvent())).resolves.toMatchObject({ ok: true });
    });

    it('enforces the concurrency ceiling across simultaneous requests', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: async () => {
                await gate;
                return { text: 'ok' };
            },
        });
        let callIndex = 0;
        readBodyMock.mockImplementation(async () => {
            callIndex += 1;
            return {
                activationId: record.activationId,
                method: 'ai.complete',
                params: { model: 'm', prompt: 'p' },
                requestId: `rpc-concurrent-${callIndex}`,
            };
        });

        const pending = Array.from({ length: 9 }, () =>
            handler(makeEvent()).then(
                (result) => ({ ok: true as const, result }),
                (error: unknown) => ({ ok: false as const, error })
            )
        );
        // Let every request reach the blocking handler before releasing.
        await new Promise((resolve) => setTimeout(resolve, 20));
        release();
        const results = await Promise.all(pending);

        const refused = results.filter((result) => !result.ok);
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatchObject({
            ok: false,
            error: expect.objectContaining({
                statusCode: 400,
                data: expect.objectContaining({ rpcCode: 'backpressure' }),
            }),
        });
    });

    it('threads the broker cancellation signal into connection dispatch', async () => {
        resolveConnectionServiceMock.mockReturnValue({
            service: {
                resolve: vi.fn(async () => ({
                    status: 'resolved',
                    connection: { providerId: 'fake.provider', scopes: ['read:items'] },
                })),
                revealCredential: vi.fn(() => 'tok_live_123'),
            },
            storeId: 'durable',
            durable: true,
        });
        listProvidersMock.mockReturnValue([{ id: 'fake.provider' }]);
        descriptorsMock.mockResolvedValue({ setup: null, policy: { id: 'p' }, problems: [] });
        toDispatchPolicyMock.mockReturnValue({ connections: [], destinations: [] });
        let observedSignal: AbortSignal | undefined;
        let aborted = false;
        dispatchMock.mockImplementation(async (input: { signal?: AbortSignal }) => {
            observedSignal = input.signal;
            await new Promise<void>((resolve, reject) => {
                input.signal?.addEventListener('abort', () => {
                    aborted = true;
                    reject(new Error('aborted'));
                });
            });
            return { status: 'ok', operationId: 'items.list', response: {} };
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'connections.dispatch',
            params: { ref: 'orc_a_r1', operationId: 'items.list', url: 'https://x.test/v1/' },
            requestId: 'rpc-conn-cancel',
        });

        const { event, close } = makeCloseableEvent();
        const pending = handler(event);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        close(false);

        await expectStatus(pending, 499);
        expect(observedSignal).toBeInstanceOf(AbortSignal);
        expect(aborted).toBe(true);
    });

    it('never starts the external request when cancellation lands during lookup', async () => {
        let releaseLookup!: () => void;
        const lookupGate = new Promise<void>((resolve) => {
            releaseLookup = resolve;
        });
        resolveConnectionServiceMock.mockReturnValue({
            service: {
                resolve: vi.fn(async () => {
                    await lookupGate;
                    return {
                        status: 'resolved',
                        connection: { providerId: 'fake.provider', scopes: [] },
                    };
                }),
                revealCredential: vi.fn(() => 'tok_live_123'),
            },
            storeId: 'durable',
            durable: true,
        });
        listProvidersMock.mockReturnValue([{ id: 'fake.provider' }]);
        descriptorsMock.mockResolvedValue({ setup: null, policy: { id: 'p' }, problems: [] });
        toDispatchPolicyMock.mockReturnValue({ connections: [], destinations: [] });
        dispatchMock.mockResolvedValue({ status: 'ok', operationId: 'items.list', response: {} });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'connections.dispatch',
            params: { ref: 'orc_a_r1', operationId: 'items.list', url: 'https://x.test/v1/' },
            requestId: 'rpc-conn-precancel',
        });

        const { event, close } = makeCloseableEvent();
        const pending = handler(event);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Disconnect while the connection lookup is still suspended.
        close(false);
        releaseLookup();

        await expectStatus(pending, 499);
        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('refuses without admission when revocation lands during the grant lookup', async () => {
        let releaseLookup!: (review: PluginGrantReviewSnapshot) => void;
        const lookupGate = new Promise<PluginGrantReviewSnapshot>((resolve) => {
            releaseLookup = resolve;
        });
        getPluginGrantReviewMock.mockImplementationOnce(() => lookupGate);
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-race-grant',
        });

        const pending = handler(makeEvent());
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        revokeHostActivation(record.activationId, 'plugin-disabled');
        releaseLookup(grants(['network.http']));

        await expectFailure(pending, 409, 'activation-revoked');
        // Refused before admission: no method was built and no admission
        // state was recreated for the dead handle.
        expect(aiFactoryMock).not.toHaveBeenCalled();
        expect(getActivationAdmissionStats(record.activationId)).toEqual({
            inFlight: 0,
            seen: 0,
            sideEffected: 0,
        });
    });

    it('refuses without dispatching when revocation lands during method preparation', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        let releaseRead!: (raw: string | null) => void;
        const readGate = new Promise<string | null>((resolve) => {
            releaseRead = resolve;
        });
        settingsStore.get.mockImplementationOnce(() => readGate);
        const governed = vi.fn(async () => ({ text: 'ok' }));
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: governed,
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-race-prep',
        });

        const pending = handler(makeEvent());
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Revocation aborts the admission controller while the budget read is
        // still suspended; the abort must not be lost before dispatch.
        revokeHostActivation(record.activationId, 'plugin-disabled');
        releaseRead(null);

        await expectFailure(pending, 409, 'activation-revoked');
        expect(governed).not.toHaveBeenCalled();
        expect(getActivationAdmissionStats(record.activationId)).toEqual({
            inFlight: 0,
            seen: 0,
            sideEffected: 0,
        });
    });

    it('refuses preparation when the client is already disconnected', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.models',
            requestId: 'rpc-early-disconnect',
        });
        const res = {
            on: () => undefined,
            off: () => undefined,
            writableEnded: false,
            destroyed: true,
        };

        await expectStatus(handler(makeEvent(res)), 499);
        // The slot was admitted and released, but no method was prepared.
        expect(aiFactoryMock).not.toHaveBeenCalled();
        expect(getActivationAdmissionStats(record.activationId).inFlight).toBe(0);
    });

    it('reports a mid-dispatch timeout as deadline-exceeded rather than cancelled', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return { text: 'too late' };
            },
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-dispatch-deadline',
            deadlineMs: 10,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 504,
            data: { rpcCode: 'deadline-exceeded' },
        });
        expect(getActivationAdmissionStats(record.activationId).inFlight).toBe(0);
    });

    it('applies the call deadline to preparation as well as dispatch', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        settingsStore.get.mockImplementationOnce(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return null;
        });
        const governed = vi.fn(async () => ({ text: 'ok' }));
        aiFactoryMock.mockReturnValue({
            method: 'ai.complete',
            grant: 'network.http',
            handler: governed,
        });
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-prep-deadline',
            deadlineMs: 10,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 504,
            data: { rpcCode: 'deadline-exceeded' },
        });
        expect(governed).not.toHaveBeenCalled();
        expect(getActivationAdmissionStats(record.activationId).inFlight).toBe(0);
    });

    it('releases the admission slot at the deadline without waiting for a stalled preparation', async () => {
        configMock.mockReturnValue({
            auth: { enabled: true },
            openrouterApiKey: 'sk-or-host',
            openrouterBaseUrl: 'https://openrouter.ai/api/v1',
            admin: {
                pluginModelPrices: { m: { promptPerMillion: 1, completionPerMillion: 2 } },
                pluginAllowedModels: ['m'],
            },
        });
        let releaseRead!: (raw: string | null) => void;
        const readGate = new Promise<string | null>((resolve) => {
            releaseRead = resolve;
        });
        settingsStore.get.mockImplementationOnce(() => readGate);
        readBodyMock.mockResolvedValue({
            activationId: record.activationId,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-prep-stall',
            deadlineMs: 10,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 504,
            data: { rpcCode: 'deadline-exceeded' },
        });
        // Preparation is still suspended, but the slot was released at the
        // deadline instead of waiting for the stalled budget read.
        expect(getActivationAdmissionStats(record.activationId).inFlight).toBe(0);
        releaseRead(null);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
});
