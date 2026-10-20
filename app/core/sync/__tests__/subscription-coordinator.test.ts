import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCoordinatedSubscription } from '../subscription-coordinator';
import { Or3DB } from '~/db/client';
import { SubscriptionManager } from '../subscription-manager';
import { createGatewaySyncProvider } from '../providers/gateway-sync-provider';
import { _resetCursorManagers } from '../cursor-manager';
import { _resetHookBridge, getHookBridge } from '../hook-bridge';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { FULL_HISTORY_PULL_RETENTION, type SyncChange } from '~~/shared/sync/types';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['visibility', 'connectivity'] as const)('applies incoming pages immediately when %s returns', async reason => {
    const db = new Or3DB(`coordinated-catch-up-${crypto.randomUUID()}`);
    const scope = { workspaceId: crypto.randomUUID() };
    const provider = createGatewaySyncProvider({ pollIntervalMs: 60_000 });
    const manager = new SubscriptionManager(db, provider, scope, { tables: ['messages'], bootstrapPageSize: 1 });
    let stop: (() => Promise<void>) | undefined;
    let ownership = Promise.resolve();
    let visible = true;
    let online = true;
    const changes: SyncChange[] = [];
    const pulls: number[] = [];
    const acknowledgements: number[] = [];
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    vi.stubGlobal('navigator', {
        get onLine() { return online; },
        locks: { request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) =>
            ownership = Promise.resolve().then(() => callback({})) },
    });
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
        const request = JSON.parse(init.body as string);
        if (path.endsWith('/update-cursor')) {
            acknowledgements.push(request.version);
            return new Response('{}');
        }
        pulls.push(request.cursor);
        const remaining = changes.filter(change => change.serverVersion > request.cursor);
        const page = remaining.slice(0, request.limit);
        return new Response(JSON.stringify({
            ...FULL_HISTORY_PULL_RETENTION, changes: page,
            nextCursor: page.at(-1)?.serverVersion ?? request.cursor,
            hasMore: remaining.length > page.length,
        }));
    }));
    setHookEngine(createTypedHookEngine(createHookEngine()));
    try {
        await db.open();
        await db.sync_state.put({ id: `sync_state:${scope.workspaceId}:default`, cursor: 100, lastSyncAt: Date.now(), deviceId: 'device-1' });
        getHookBridge(db).start();
        stop = await startCoordinatedSubscription(db.name, manager);
        if (reason === 'visibility') visible = false;
        else online = false;
        (reason === 'visibility' ? document : window).dispatchEvent(new Event(reason === 'visibility' ? 'visibilitychange' : 'offline'));
        await ownership;
        for (const version of [101, 102]) {
            changes.push({ serverVersion: version, tableName: 'messages', pk: `remote-${version}`, op: 'put',
                payload: { id: `remote-${version}`, thread_id: 'conversation', role: 'user', index: version,
                    data: { content: `Remote message ${version}` }, created_at: 1, updated_at: 1, clock: version, deleted: false },
                stamp: { clock: version, hlc: `${version}:0:remote`, deviceId: 'remote', opId: crypto.randomUUID() } });
        }
        visible = true;
        online = true;
        (reason === 'visibility' ? document : window).dispatchEvent(new Event(reason === 'visibility' ? 'visibilitychange' : 'online'));
        // The normal poll is a minute away. Returning must apply both pages
        // through the real transport and manager without waiting for that timer.
        await vi.waitFor(async () => expect(await db.messages.toArray()).toMatchObject([
            { id: 'remote-101', data: { content: 'Remote message 101' } },
            { id: 'remote-102', data: { content: 'Remote message 102' } },
        ]));
        await vi.waitFor(() => expect(acknowledgements).toEqual([102]));
        expect(pulls).toEqual([100, 100, 101]);
        expect(await db.pending_ops.count()).toBe(0);
        expect((await db.sync_state.get(`sync_state:${scope.workspaceId}:default`))?.cursor).toBe(102);
    } finally {
        await stop?.();
        await manager.stop();
        await provider.dispose();
        _resetHookBridge();
        _resetCursorManagers();
        setHookEngine(null);
        await db.delete();
    }
});

it('fences an in-flight bootstrap before releasing ownership and reacquires after resume', async () => {
    let grant!: () => Promise<void>;
    let callbackFinished = false;
    const request = vi.fn((_name: string, options: { signal?: AbortSignal }, callback: (lock: object) => Promise<void>) =>
        new Promise<void>((resolve, reject) => {
            let granted = false;
            grant = async () => { granted = true; await callback({}); callbackFinished = true; resolve(); };
            options.signal?.addEventListener('abort', () => {
                if (!granted) reject(new DOMException('Cancelled', 'AbortError'));
            }, { once: true });
        })
    );
    vi.stubGlobal('navigator', { locks: { request }, onLine: true });
    let finishBootstrap!: () => void;
    const subscription = {
        start: vi.fn(() => new Promise<void>(resolve => { finishBootstrap = resolve; })),
        stop: vi.fn(async () => undefined),
    };
    const coordinated = startCoordinatedSubscription('workspace-1', subscription);
    await Promise.resolve();
    const owned = grant();
    expect(subscription.start).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(subscription.stop).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pageshow'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(callbackFinished).toBe(false);
    finishBootstrap();
    const dispose = await coordinated;
    await owned;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await dispose();
    window.dispatchEvent(new Event('online'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(subscription.stop).toHaveBeenCalledTimes(1);
});

describe.each(['absent', 'denied'] as const)('Web Locks %s', reason => {
    it('retains the normal subscription lifecycle', async () => {
        vi.stubGlobal('navigator', {
            onLine: true,
            locks: reason === 'denied'
                ? { request: vi.fn(async () => { throw new DOMException('Restricted', 'SecurityError'); }) }
                : undefined,
        });
        const subscription = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
        const dispose = await startCoordinatedSubscription('workspace-1', subscription);
        await vi.waitFor(() => expect(subscription.start).toHaveBeenCalledTimes(1));
        await dispose();
        expect(subscription.stop).toHaveBeenCalledTimes(1);
    });
});
