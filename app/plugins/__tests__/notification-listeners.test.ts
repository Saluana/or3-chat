import { describe, it, expect, vi, beforeEach } from 'vitest';

function setClient(value: boolean) {
    Object.defineProperty(import.meta, 'client', {
        value,
        configurable: true,
    });
    (globalThis as { __OR3_TEST_CLIENT?: boolean }).__OR3_TEST_CLIENT = value;
}

const handlers = new Map<string, (payload: unknown) => Promise<void>>();
const addActionMock = vi.fn(
    (name: string, handler: (payload: unknown) => Promise<void>) => {
        handlers.set(name, handler);
    }
);

const hooksMock = {
    addAction: addActionMock,
    doAction: vi.fn(),
};

const createMock = vi.fn().mockResolvedValue(null);
const panesRef = { value: [] as Array<{ mode?: string; threadId?: string }> };

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hooksMock,
}));

vi.mock('~/core/notifications/notification-service', () => ({
    NotificationService: vi.fn(() => ({ create: createMock })),
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
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: false } }),
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: { value: { session: null } } }),
}));

describe('notification listeners plugin', () => {
    beforeEach(() => {
        vi.resetModules();
        handlers.clear();
        addActionMock.mockClear();
        createMock.mockClear();
        panesRef.value = [];
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
});
