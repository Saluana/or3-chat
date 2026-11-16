import { createHookEngine } from '~~/shared/hooks/hook-engine-core';
import { observeSyncAction } from '~/core/sync/sync-observers';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setClient(value: boolean) {
    Object.defineProperty(import.meta, 'client', {
        value,
        configurable: true,
    });
    (globalThis as { __OR3_TEST_CLIENT?: boolean }).__OR3_TEST_CLIENT = value;
}

let engine = createHookEngine();
const handlers = new Map<string, (payload: unknown) => Promise<void>>();
const addActionMock = vi.fn(
    (name: string, handler: (payload: unknown) => Promise<void>) => {
        handlers.set(name, handler);
        engine.addAction(name, handler as never);
    }
);

const hooksMock = {
    addAction: addActionMock,
    doAction: vi.fn((name: string, payload: unknown) => engine.doAction(name, payload)),
    get _engine() { return engine; },
};

const createMock = vi.fn().mockResolvedValue(null);
const panesRef = { value: [] as Array<{ mode?: string; threadId?: string }> };
const runtimeConfigRef = {
    value: { public: { ssrAuthEnabled: false } } as {
        public: {
            ssrAuthEnabled?: boolean;
            sync?: {
                enabled?: boolean;
                provider?: string;
                convexUrl?: string;
            };
        };
    },
};

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hooksMock,
}));

vi.mock('~/core/notifications/notification-service', () => ({
    NotificationService: vi.fn(function () {
        return { create: createMock };
    }),
}));

vi.mock('~/core/notifications/notification-user', () => ({
    resolveNotificationUserId: () => 'user-1',
}));

vi.mock('~/db/client', () => ({
    getDb: () => ({}),
}));

vi.mock('~/db/util', () => ({
    newId: () => 'action-1',
}));

vi.mock('~/utils/multiPaneApi', () => ({
    getGlobalMultiPaneApi: () => ({ panes: panesRef }),
}));

vi.mock('#app', () => ({
    defineNuxtPlugin: (plugin: () => void) => plugin(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfigRef.value,
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: { value: { session: null } } }),
}));

describe('notification listeners plugin', () => {
    beforeEach(() => {
        vi.resetModules();
        handlers.clear();
        engine = createHookEngine();
        addActionMock.mockClear();
        createMock.mockClear();
        panesRef.value = [];
        runtimeConfigRef.value = { public: { ssrAuthEnabled: false } };
    });

    it.each([
        ['sync.bootstrap:action:start', 'sync.bootstrap:action:complete'],
        ['sync.rescan:action:starting', 'sync.rescan:action:completed'],
    ] as const)('preserves suppression phases past a hung %s listener', async (start, complete) => {
        setClient(true);
        let release!: () => void;
        const hung = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        engine.addAction(start, hung, 0);
        await import('~/plugins/notification-listeners.client');
        const hooks = hooksMock as unknown as TypedHookEngine;
        const notify = (pk: string) => handlers.get('sync.error:action')?.({
            op: { tableName: 'messages', pk }, error: 'invalid', permanent: true,
        });
        try {
            await observeSyncAction(hooks, start, { scope: { workspaceId: 'local' } } as never);
            await notify('during');
            expect(createMock).not.toHaveBeenCalled();
            await observeSyncAction(hooks, complete, { scope: { workspaceId: 'local' }, cursor: 1, totalPulled: 1 } as never);
            release();
            await new Promise(resolve => setTimeout(resolve, 0));
            await notify('after');
            expect(createMock).toHaveBeenCalledTimes(1);
            // A second lifecycle still toggles suppression while its first start is unresolved.
            engine.addAction(start, () => new Promise(() => undefined), 0);
            await observeSyncAction(hooks, start, { scope: { workspaceId: 'local' } } as never);
            await observeSyncAction(hooks, complete, { scope: { workspaceId: 'local' }, cursor: 2, totalPulled: 1 } as never);
            await observeSyncAction(hooks, start, { scope: { workspaceId: 'local' } } as never);
            await notify('during-again');
            expect(createMock).toHaveBeenCalledTimes(1);
        } finally { release?.(); }
    });

    it('is a no-op outside the client runtime', async () => {
        setClient(false);
        await import('~/plugins/notification-listeners.client');

        expect(addActionMock).not.toHaveBeenCalled();
    });

    it('does not emit system notifications when not client', async () => {
        setClient(false);
        const module = await import('~/plugins/notification-listeners.client');
        await module.emitSystemNotification({
            title: 'Sync error',
            body: 'Bad things',
        });

        expect(createMock).not.toHaveBeenCalled();
    });

    it('emits AI completion notification when thread is not open', async () => {
        setClient(true);
        await import('~/plugins/notification-listeners.client');

        const handler = handlers.get('ai.chat.stream:action:complete');
        await handler?.({
            threadId: 'thread-2',
            assistantId: 'msg-1',
            streamId: 'stream-1',
            totalLength: 10,
        });

        expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('does not emit AI completion notification when thread is open', async () => {
        setClient(true);
        panesRef.value = [{ mode: 'chat', threadId: 'thread-1' }];
        await import('~/plugins/notification-listeners.client');

        const handler = handlers.get('ai.chat.stream:action:complete');
        await handler?.({
            threadId: 'thread-1',
            assistantId: 'msg-1',
            streamId: 'stream-1',
            totalLength: 10,
        });

        expect(createMock).not.toHaveBeenCalled();
    });

    it('does not emit AI error notification when aborted', async () => {
        setClient(true);
        await import('~/plugins/notification-listeners.client');

        const handler = handlers.get('ai.chat.stream:action:error');
        await handler?.({
            threadId: 'thread-3',
            streamId: 'stream-2',
            aborted: true,
        });

        expect(createMock).not.toHaveBeenCalled();
    });

    it('emits AI completion notification even when server notifications are enabled', async () => {
        setClient(true);
        runtimeConfigRef.value = {
            public: {
                ssrAuthEnabled: true,
                sync: {
                    enabled: true,
                    provider: 'convex',
                    convexUrl: 'https://example.convex.site',
                },
            },
        };
        await import('~/plugins/notification-listeners.client');

        const handler = handlers.get('ai.chat.stream:action:complete');
        await handler?.({
            threadId: 'thread-2',
            assistantId: 'msg-1',
            streamId: 'stream-1',
            totalLength: 10,
        });

        expect(createMock).toHaveBeenCalledTimes(1);
    });
});
