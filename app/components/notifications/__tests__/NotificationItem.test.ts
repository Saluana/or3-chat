import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import Dexie from 'dexie';
import { evictWorkspaceDb, getActiveWorkspaceId, getDb, setActiveWorkspaceDb } from '~/db/client';
import { getGlobalMultiPaneApi, setGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import NotificationItem from '../NotificationItem.vue';
import type { Notification } from '~/db/schema';

const pushMock = vi.fn();
const doActionMock = vi.fn();

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (token: string) => computed(() => token),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ doAction: doActionMock }),
}));

const baseNotification = (): Notification => ({
    id: 'n1',
    user_id: 'local-user',
    type: 'system.warning',
    title: 'Alert',
    body: 'Body',
    actions: [
        {
            id: 'a1',
            label: 'Open',
            kind: 'navigate',
            target: { route: '/chat/123' },
        },
    ],
    deleted: false,
    created_at: 10,
    updated_at: 10,
    clock: 10,
});

const UButtonStub = {
    template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
};

const UIconStub = {
    template: '<span />',
};

describe('NotificationItem', () => {
    beforeEach(() => {
        pushMock.mockClear();
        doActionMock.mockClear();
    });

    it('keeps identifier-only notification navigation in the active workspace when record IDs overlap', async () => {
        const previousWorkspace = getActiveWorkspaceId();
        const previousApi = getGlobalMultiPaneApi();
        const origin = `notification-origin-${crypto.randomUUID()}`;
        const current = `notification-current-${crypto.randomUUID()}`;
        let wrapper: ReturnType<typeof mount> | undefined;
        try {
            const originDb = setActiveWorkspaceDb(origin); await originDb.open();
            await originDb.threads.put({ id: 'identical-thread', title: 'synthetic-origin-title', created_at: 1, updated_at: 1, clock: 1, deleted: false } as never);
            const currentDb = setActiveWorkspaceDb(current); await currentDb.open();
            await currentDb.threads.put({ id: 'identical-thread', title: 'synthetic-current-title', created_at: 1, updated_at: 1, clock: 1, deleted: false } as never);
            const originRead = vi.spyOn(originDb.threads, 'get');
            const opened: string[] = [];
            const setPaneThread = vi.fn(async (_index: number, id: string) => {
                const thread = await getDb().threads.get(id);
                if (typeof thread?.title === 'string') opened.push(thread.title);
            });
            setGlobalMultiPaneApi({ activePaneIndex: ref(0), updatePane: vi.fn(), setPaneThread } as unknown as Parameters<typeof setGlobalMultiPaneApi>[0]);
            const notification = baseNotification();
            notification.actions = [{ id: 'open', label: 'Open chat', kind: 'navigate', target: { threadId: 'identical-thread' } }];
            wrapper = mount(NotificationItem, { props: { notification, onMarkRead: vi.fn(async () => {}) },
                global: { stubs: { UButton: UButtonStub, UIcon: UIconStub } } });
            await wrapper.trigger('click');
            await vi.waitFor(() => expect(opened).toEqual(['synthetic-current-title']));
            expect(originRead).not.toHaveBeenCalled();
            expect(getActiveWorkspaceId()).toBe(current);
            expect(pushMock).not.toHaveBeenCalled();
            originRead.mockRestore();
        } finally {
            wrapper?.unmount(); setGlobalMultiPaneApi(previousApi); setActiveWorkspaceDb(previousWorkspace);
            for (const id of [origin, current]) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
        }
    });

    it('does not navigate a workspace-scoped completion after its workspace is replaced', async () => {
        const previous = getActiveWorkspaceId(); const api = getGlobalMultiPaneApi();
        const workspace = `notification-guard-${crypto.randomUUID()}`;
        setActiveWorkspaceDb(workspace);
        const select = vi.fn(); const mark = vi.fn(async () => {});
        setGlobalMultiPaneApi({ activePaneIndex: ref(0), updatePane: vi.fn(), setPaneThread: select } as unknown as Parameters<typeof setGlobalMultiPaneApi>[0]);
        const notification = baseNotification();
        notification.actions = [{ id: 'open', label: 'Open chat', kind: 'navigate', target: { threadId: 'private-thread' }, data: { workspaceId: 'origin-workspace' } }];
        const wrapper = mount(NotificationItem, { props: { notification, onMarkRead: mark }, global: { stubs: { UButton: UButtonStub, UIcon: UIconStub } } });
        try {
            await wrapper.find('button').trigger('click');
            expect(select).not.toHaveBeenCalled(); expect(pushMock).not.toHaveBeenCalled();
            expect(mark).not.toHaveBeenCalled();
        } finally { wrapper.unmount(); setGlobalMultiPaneApi(api); setActiveWorkspaceDb(previous); evictWorkspaceDb(workspace); await Dexie.delete(`or3-db-${workspace}`); }
    });

    it('marks read once when clicking the item with a navigate action', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const wrapper = mount(NotificationItem, {
            props: {
                notification: baseNotification(),
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.trigger('click');

        expect(onMarkRead).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith('/chat/123');
    });

    it('marks read once when clicking an action button', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const wrapper = mount(NotificationItem, {
            props: {
                notification: baseNotification(),
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.find('button').trigger('click');

        expect(onMarkRead).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith('/chat/123');
    });

    it('emits hook action for callback actions', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const notification = baseNotification();
        notification.actions = [
            {
                id: 'cb1',
                label: 'Run',
                kind: 'callback',
                data: { foo: 'bar' },
            },
        ];
        const wrapper = mount(NotificationItem, {
            props: {
                notification,
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.find('button').trigger('click');

        expect(onMarkRead).toHaveBeenCalledTimes(1);
        expect(doActionMock).toHaveBeenCalledWith('notify:action:clicked', {
            notification,
            action: notification.actions[0],
        });
    });

    it('routes to thread when target threadId is provided', async () => {
        const onMarkRead = vi.fn().mockResolvedValue(undefined);
        const notification = baseNotification();
        notification.actions = [
            {
                id: 'nav1',
                label: 'Open thread',
                kind: 'navigate',
                target: { threadId: 'thread-9' },
            },
        ];
        const wrapper = mount(NotificationItem, {
            props: {
                notification,
                onMarkRead,
            },
            global: {
                stubs: { UButton: UButtonStub, UIcon: UIconStub },
            },
        });

        await wrapper.trigger('click');

        expect(pushMock).toHaveBeenCalledWith('/chat/thread-9');
    });

});
