/* @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, toWebHandler } from 'h3';

// Only authenticated workspace members may observe versions. Async permission
// failure, disconnect, and a failing provider must all release the subscription.
const state = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), watch: vi.fn(),
    push: vi.fn(async () => {}), close: vi.fn(async () => {}), closed: undefined as undefined | (() => void),
    closers: [] as Array<() => void>,
    version: undefined as undefined | ((version: number) => void), stop: vi.fn(),
}));
vi.mock('h3', async original => {
    const actual = await original<typeof import('h3')>();
    return { ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getQuery: () => ({ workspaceId: 'ws-1' }),
    createEventStream: (event: Parameters<typeof actual.createEventStream>[0]) => event.node ? actual.createEventStream(event) : ({ push: state.push, close: state.close, send: async () => {},
        onClosed: (fn: () => void) => { state.closed = fn; state.closers.push(fn); } }),
    };
});
vi.mock('../../../auth/session', () => ({ resolveSessionContext: state.session }));
vi.mock('../../../utils/storage/workspace-access', () => ({ requireStorageWorkspaceAccess: state.access }));
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => true }));
vi.mock('../../../utils/sync/is-sync-enabled', () => ({ isSyncEnabled: () => true }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => ({ watchVersion: state.watch }) }));
vi.mock('../../../utils/headers', () => ({ setNoCacheHeaders: vi.fn() }));
beforeEach(() => {
    vi.useFakeTimers();
    state.session.mockResolvedValue({ authenticated: true, user: { id: 'u1' } });
    state.access.mockResolvedValue(undefined);
    state.watch.mockImplementation(async (_event, _scope, version) => { state.version = version; return state.stop; });
    state.close.mockImplementation(async () => { state.closed?.(); });
});
afterEach(() => { for (const close of state.closers.splice(0)) close(); vi.clearAllMocks(); vi.useRealTimers(); });
it('denies a nonmember before subscribing', async () => {
    state.access.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    const route = (await import('../events.get')).default as any;
    await expect(route({ context: {} })).rejects.toMatchObject({ statusCode: 403 });
    expect(state.watch).not.toHaveBeenCalled();
});
it('rechecks membership for notifications and closes when access is revoked', async () => {
    const route = (await import('../events.get')).default as any;
    await route({ context: {} });
    state.version?.(4);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.push).toHaveBeenCalledWith(JSON.stringify({ version: 4 }));
    state.access.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    state.version?.(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.stop).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledTimes(1);
});

it('bounds simultaneous notification connections per authenticated user', async () => {
    const route = (await import('../events.get')).default as any;
    for (let index = 0; index < 8; index++) await route({ context: {} });
    await expect(route({ context: {} })).rejects.toMatchObject({ statusCode: 429 });
    expect(state.watch).toHaveBeenCalledTimes(8);
});

it('releases the subscription at the session refresh deadline even during a stalled permission check', async () => {
    const route = (await import('../events.get')).default as any;
    await route({ context: {} });
    let release!: () => void;
    state.access.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    state.version?.(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.stop).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.push).not.toHaveBeenCalledWith(JSON.stringify({ version: 4 }));
});

it('does not extend session expiry by time spent checking initial membership', async () => {
    const now = Date.now();
    state.session.mockResolvedValue({ authenticated: true, user: { id: 'u1' }, expiresAt: new Date(now + 30_000).toISOString() });
    state.access.mockImplementationOnce(async () => { vi.setSystemTime(now + 20_000); });
    const route = (await import('../events.get')).default as any;
    await route({ context: {} });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.stop).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledTimes(1);
});

// Exercise the real H3 wire/close boundary; the permission/queue fixtures above
// cannot detect an event stream that never sends or never disposes its watcher.
it('delivers real SSE frames and closes the H3 stream when membership is revoked', async () => {
    state.watch.mockImplementation(async (_event, _scope, version) => {
        state.version = version;
        version(7);
        return state.stop;
    });
    const route = (await import('../events.get')).default;
    const send = toWebHandler(createApp().use(route));
    const opening = send(new Request('http://chat.test/api/sync/events?workspaceId=ws-1'));
    await vi.advanceTimersByTimeAsync(0);
    const response = await opening;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    try {
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain('data: {"version":7}');
        state.access.mockRejectedValue(new Error('Revoked'));
        state.version?.(8);
        await vi.advanceTimersByTimeAsync(0);
        expect((await reader.read()).done).toBe(true);
        expect(state.stop).toHaveBeenCalledTimes(1);
    } finally { await reader.cancel(); }
});
