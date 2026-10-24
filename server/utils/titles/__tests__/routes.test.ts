import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';

const state = vi.hoisted(() => ({ body: {} as Record<string, unknown>, model: null as string | null,
    session: { authenticated: true, user: { id: 'internal-user' }, workspace: { id: 'ws' }, role: 'owner' } as SessionContext,
    key: 'server-secret' as string | undefined, cloud: true, allowed: true }));
const store = { get: vi.fn(async () => state.model), set: vi.fn(async (_ws: string, _key: string, value: string) => { state.model = value; }) };
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ openrouterBaseUrl: 'https://openrouter.ai/api/v1' }) }));
vi.mock('h3', async load => ({ ...await load<Record<string, unknown>>(), defineEventHandler: (handler: unknown) => handler,
    setResponseHeader: vi.fn() }));
vi.mock('../../security/limited-json-body', () => ({ readLimitedJsonBody: async () => state.body }));
vi.mock('../../security/cloud-mutation', () => ({ requireCloudMutation: vi.fn() }));
vi.mock('../../auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => state.cloud }));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => state.session }));
vi.mock('../../../secrets/openrouter', () => ({ resolveOpenRouterCredential: vi.fn(async () => ({ apiKey: state.key, source: 'server' })) }));
vi.mock('../../../admin/stores/registry', () => ({ getWorkspaceSettingsStore: () => store }));
vi.mock('../../llm/rate-limiter', () => ({ checkAndRecordLlmRequest: () => ({ allowed: state.allowed }) }));
vi.mock('../../../admin/guard', () => ({ requireAdminRequest: vi.fn(), requireAdminMutation: vi.fn() }));
vi.mock('../../../admin/context', () => ({ resolveAdminRequestContext: async () => ({ session: state.session,
    principal: { kind: 'workspace_admin', userId: 'internal-user', session: state.session } }),
    requireAdminContext: (context: unknown) => context, isSuperAdmin: () => false }));
vi.mock('~~/shared/openrouter', () => ({ createOpenRouterClient: vi.fn(),
    fetchOpenRouterCatalog: async () => [{ id: 'deepseek/deepseek-v4.1-flash', architecture: { output_modalities: ['text'] } }, { id: 'other/model' }] }));
import titleRoute from '../../../api/openrouter/title.post';
import readRoute from '../../../api/openrouter/title-model.get';
import saveRoute from '../../../api/admin/title-model.post';

const event = () => ({ context: {}, node: { req: { socket: { remoteAddress: 'local' } } } }) as H3Event;
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
    state.body = { type: 'chat', content: 'Explain OR3 plugin architecture', workspaceId: 'ws' };
    state.model = null; state.key = 'server-secret'; state.cloud = true; state.allowed = true;
    state.session = { authenticated: true, user: { id: 'internal-user' }, workspace: { id: 'ws' }, role: 'owner' } as SessionContext;
    network = vi.fn(async () => Response.json({ choices: [{ message: { content: 'OR3 Plugin Architecture' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', network);
    store.set.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('backend title routes', () => {
    it('preserves the default routing suffix, disables expensive options, and keeps credentials server-side', async () => {
        expect(await titleRoute(event())).toEqual({ title: 'OR3 Plugin Architecture' });
        const [url, init] = network.mock.calls[0]!;
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ model: 'deepseek/deepseek-v4.1-flash:nitro', stream: false, max_tokens: 48, reasoning: { effort: 'none' } });
        expect(body.tools).toBeUndefined();
        expect(body.plugins).toBeUndefined();
        expect(init.headers.Authorization).toBe('Bearer server-secret');
        expect(network).toHaveBeenCalledTimes(1);
    });
    it('uses persisted admin settings on future calls and ignores Cloud client overrides', async () => {
        state.body = { workspaceId: 'ws', model: 'other/model:nitro' };
        await expect(saveRoute(event())).resolves.toEqual({ model: 'other/model:nitro' });
        await expect(readRoute(event())).resolves.toEqual({ model: 'other/model:nitro' });
        state.body = { type: 'document', content: 'A document without a heading', workspaceId: 'ws', model: 'deepseek/deepseek-v4.1-flash:nitro' };
        await titleRoute(event());
        expect(JSON.parse(network.mock.calls[0]![1].body).model).toBe('other/model:nitro');
    });
    it.each(['editor', 'viewer'] as const)('refuses a %s changing the administrator model', async role => {
        state.session.role = role;
        state.body = { workspaceId: 'ws', model: 'other/model' };
        await expect(saveRoute(event())).rejects.toMatchObject({ statusCode: 403 });
        expect(store.set).not.toHaveBeenCalled();
    });
    it('refuses cross-workspace configuration', async () => {
        state.body = { workspaceId: 'another-workspace', model: 'other/model' };
        await expect(saveRoute(event())).rejects.toMatchObject({ statusCode: 403 });
        expect(store.set).not.toHaveBeenCalled();
    });
    it.each(['viewer', 'anonymous', 'wrong-workspace', 'missing-key', 'rate-limit', 'oversized'] as const)('refuses inference for %s without contacting a provider', async scenario => {
        if (scenario === 'viewer') state.session.role = 'viewer';
        if (scenario === 'anonymous') state.session.authenticated = false;
        if (scenario === 'wrong-workspace') state.body.workspaceId = 'other';
        if (scenario === 'missing-key') state.key = undefined;
        if (scenario === 'rate-limit') state.allowed = false;
        if (scenario === 'oversized') state.body.content = 'x'.repeat(2401);
        await expect(titleRoute(event())).rejects.toBeDefined();
        expect(network).not.toHaveBeenCalled();
    });
    it('caps duration with an abort signal and never retries a failing provider', async () => {
        network.mockResolvedValue(new Response('', { status: 503 }));
        await expect(titleRoute(event())).rejects.toMatchObject({ statusCode: 502 });
        expect(network.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
        expect(network).toHaveBeenCalledTimes(1);
    });
    it('aborts a stalled provider within the configured deadline', async () => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
            expect(ms).toBe(8000);
            return timeout(1);
        });
        network.mockImplementation(async (_url, init) => await new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('Timeout')), { once: true });
        }));
        await expect(titleRoute(event())).rejects.toMatchObject({ statusCode: 502 });
        expect(network).toHaveBeenCalledTimes(1);
    });

});
