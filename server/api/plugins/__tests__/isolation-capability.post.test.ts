import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

/**
 * Authorization tests for the portable capability endpoint (finding 4).
 *
 * The endpoint is the authenticated bridge between a sandbox and server-owned
 * capabilities. These tests pin the ordering and the refusals: the mutation
 * guard runs first, then session + workspace write, then plugin enabled/access,
 * and only then the capability itself.
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
vi.mock('../../../admin/plugins/workspace-plugin-store', () => ({
    getEnabledPlugins: getEnabledPluginsMock as any,
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

const resolveConnectionServiceMock = vi.fn();
vi.mock('../../../utils/plugins/connections/resolve', () => ({
    resolveConnectionService: resolveConnectionServiceMock as any,
}));

vi.mock('../../../utils/plugins/connections/providers/registry', () => ({
    listConnectionProviders: () => [],
}));

vi.mock('../../../utils/plugins/connections/transport', () => ({
    createFetchConnectionTransport: () => async () => ({ status: 200, headers: {}, body: '{}' }),
}));

const dispatchMock = vi.fn();
vi.mock('../../../utils/plugins/connections/dispatch', () => ({
    dispatchApprovedConnectionOperation: dispatchMock as any,
}));

const descriptorsMock = vi.fn(async () => ({ setup: null, policy: null, problems: [] }));
vi.mock('../../../utils/plugins/setup/load-descriptors', () => ({
    loadPackageDescriptors: descriptorsMock as any,
    toConnectionDispatchPolicy: () => null,
}));

const aiFactoryMock = vi.fn((_input: unknown) => undefined as never);
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

const handler = (await import('../isolation/capability.post')).default as (event: H3Event) => Promise<unknown>;

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as unknown as H3Event;
}

async function expectStatus(promise: Promise<unknown>, statusCode: number): Promise<void> {
    await expect(promise).rejects.toMatchObject({ statusCode });
}

describe('POST /api/plugins/isolation/capability', () => {
    beforeEach(() => {
        mutationMock.mockReset();
        requireSessionMock.mockReset();
        requireCanMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            role: 'owner',
            user: { id: 'user_1' },
            workspace: { id: 'ws_1' },
        });
        readBodyMock.mockReset().mockResolvedValue({
            pluginId: 'example.plugin',
            generation: 1,
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
        configMock.mockReset().mockReturnValue({
            auth: { enabled: true },
            admin: {},
            openrouterApiKey: '',
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

    it('refuses a plugin that is not enabled for the workspace', async () => {
        getEnabledPluginsMock.mockResolvedValue([]);
        await expectStatus(handler(makeEvent()), 403);
    });

    it('refuses when the workspace access gate denies the plugin', async () => {
        checkPluginAccessMock.mockResolvedValue({
            decision: { allowed: false, reasons: ['role-not-allowed'] },
        });
        await expectStatus(handler(makeEvent()), 403);
    });

    it('refuses an unknown capability method', async () => {
        await expectStatus(handler(makeEvent()), 400);
    });

    it('refuses ai.complete without a host provider credential', async () => {
        readBodyMock.mockResolvedValue({
            pluginId: 'example.plugin',
            generation: 2,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
        });
        await expectStatus(handler(makeEvent()), 503);
        expect(aiFactoryMock).not.toHaveBeenCalled();
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
            pluginId: 'example.plugin',
            generation: 3,
            method: 'ai.complete',
            params: { model: 'm', prompt: 'p' },
            requestId: 'rpc-1',
        });
        const governed = vi.fn(async () => ({ text: 'ok' }));
        aiFactoryMock.mockReturnValue({ method: 'ai.complete', grant: 'network.http', handler: governed });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            ok: true,
            result: { text: 'ok' },
        });
        expect(aiFactoryMock).toHaveBeenCalledTimes(1);
        const factoryInput = aiFactoryMock.mock.calls[0]![0] as {
            prices: Record<string, unknown>;
            allowedModels: string[];
        };
        expect(factoryInput.prices).toMatchObject({ m: { promptPerMillion: 1, completionPerMillion: 2 } });
        expect(factoryInput.allowedModels).toEqual(['m']);
        // The sandbox cannot name the plugin/workspace/user: they come from the session.
        expect(governed.mock.calls[0]![0]).toMatchObject({ model: 'm', prompt: 'p' });
        expect(governed.mock.calls[0]![1]).toMatchObject({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            generation: 3,
        });
    });

    it('refuses connections.dispatch without a durable connection store', async () => {
        resolveConnectionServiceMock.mockReturnValue({
            service: {},
            storeId: 'memory',
            durable: false,
        });
        readBodyMock.mockResolvedValue({
            pluginId: 'example.plugin',
            generation: 1,
            method: 'connections.dispatch',
            params: { ref: 'orc_a_r1', operationId: 'items.list', url: 'https://x.test/v1/' },
        });
        await expectStatus(handler(makeEvent()), 503);
        expect(dispatchMock).not.toHaveBeenCalled();
    });
});
