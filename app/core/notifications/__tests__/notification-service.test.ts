import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Or3DB } from '~/db/client';
import { getDb, setActiveWorkspaceDb } from '~/db/client';
import { NotificationService } from '~/core/notifications/notification-service';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import type { NotificationCreatePayload } from '~/core/hooks/hook-types';

describe('NotificationService', () => {
    const createDb = () =>
        ({
            notifications: {
                add: vi.fn(),
                update: vi.fn(),
                where: vi.fn(),
            },
        }) as unknown as Or3DB;

    it('rejects invalid payloads', async () => {
        const db = createDb();
        const hooks = createTypedHookEngine(createHookEngine());
        const service = new NotificationService(db, hooks, 'user-1');
        const payload: NotificationCreatePayload = { type: '', title: '' };

        const result = await service.create(payload);

        expect(result).toBeNull();
        expect(db.notifications.add).not.toHaveBeenCalled();
    });

    it('rejects filtered payloads', async () => {
        const db = createDb();
        const engine = createHookEngine();
        const hooks = createTypedHookEngine(engine);
        hooks.addFilter('notify:filter:before_store', () => false as const);
        const service = new NotificationService(db, hooks, 'user-1');

        const payload: NotificationCreatePayload = {
            type: 'system.warning',
            title: 'Alert',
        };

        const result = await service.create(payload);

        expect(result).toBeNull();
        expect(db.notifications.add).not.toHaveBeenCalled();
    });

    it('ignores invalid payloads from push action', async () => {
        const db = createDb();
        const engine = createHookEngine();
        const hooks = createTypedHookEngine(engine);
        const service = new NotificationService(db, hooks, 'user-1');
        const stop = service.startListening();

        await hooks.doAction('notify:action:push', { type: '', title: '' });

        expect(db.notifications.add).not.toHaveBeenCalled();
        stop();
    });

    it('falls back when db.transaction is unavailable', async () => {
        const modifyReadSpy = vi.fn().mockResolvedValue(0);
        const modifyClearSpy = vi.fn().mockResolvedValue(2);
        const whereChainRead = {
            equals: vi.fn().mockReturnThis(),
            and: vi.fn().mockReturnThis(),
            modify: modifyReadSpy,
        };
        const whereChainClear = {
            equals: vi.fn().mockReturnThis(),
            and: vi.fn().mockReturnThis(),
            modify: modifyClearSpy,
        };

        const db = {
            notifications: {
                add: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(1),
                where: vi
                    .fn()
                    .mockReturnValueOnce(whereChainRead)
                    .mockReturnValueOnce(whereChainClear),
            },
            tables: [{ name: 'notifications' }],
        } as unknown as Or3DB;

        const hooks = createTypedHookEngine(createHookEngine());
        const service = new NotificationService(db, hooks, 'user-1');

        const created = await service.create({
            type: 'system.warning',
            title: 'Alert',
        });
        expect(created).not.toBeNull();
        expect(db.notifications.add).toHaveBeenCalledTimes(1);

        await service.markRead(created!.id);
        expect(db.notifications.update).toHaveBeenCalledTimes(1);

        await service.markAllRead();
        expect(modifyReadSpy).toHaveBeenCalledTimes(1);

        const cleared = await service.clearAll();
        expect(cleared).toBe(2);
        expect(modifyClearSpy).toHaveBeenCalledTimes(1);
    });
});

describe('NotificationService (Dexie)', () => {
    let workspaceId = '';

    beforeEach(async () => {
        workspaceId = `test-notification-service-${Date.now()}-${Math.random()}`;
        setActiveWorkspaceDb(workspaceId);
        await getDb().notifications.clear();
    });

    afterEach(async () => {
        await getDb().notifications.clear();
        await getDb().delete();
        setActiveWorkspaceDb(null);
    });

    it('marks a notification as read and emits hook action', async () => {
        const engine = createHookEngine();
        const hooks = createTypedHookEngine(engine);
        const service = new NotificationService(getDb(), hooks, 'user-1');
        const actionSpy = vi.fn();
        hooks.addAction('notify:action:read', actionSpy);

        const created = await service.create({
            type: 'system.warning',
            title: 'Alert',
        });
        if (!created) throw new Error('Failed to create notification');

        await service.markRead(created.id);

        const row = await getDb().notifications.get(created.id);
        expect(row?.read_at).toBeDefined();
        expect(actionSpy).toHaveBeenCalledWith({
            id: created.id,
            readAt: expect.any(Number),
        });
    });

    it('marks all notifications as read for current user only', async () => {
        const engine = createHookEngine();
        const hooks = createTypedHookEngine(engine);
        const service = new NotificationService(getDb(), hooks, 'user-1');

        await service.create({ type: 'system.warning', title: 'One' });
        const otherService = new NotificationService(getDb(), hooks, 'user-2');
        await otherService.create({ type: 'system.warning', title: 'Two' });

        await service.markAllRead();

        const userOneUnread = await getDb().notifications
            .where('user_id')
            .equals('user-1')
            .and((n) => n.read_at === undefined && !n.deleted)
            .count();
        const userTwoUnread = await getDb().notifications
            .where('user_id')
            .equals('user-2')
            .and((n) => n.read_at === undefined && !n.deleted)
            .count();

        expect(userOneUnread).toBe(0);
        expect(userTwoUnread).toBe(1);
    });

    it('clears notifications and reports count', async () => {
        const engine = createHookEngine();
        const hooks = createTypedHookEngine(engine);
        const service = new NotificationService(getDb(), hooks, 'user-1');
        const clearedSpy = vi.fn();
        hooks.addAction('notify:action:cleared', clearedSpy);

        await service.create({ type: 'system.warning', title: 'One' });
        await service.create({ type: 'system.warning', title: 'Two' });

        const cleared = await service.clearAll();

        const remaining = await getDb().notifications
            .where('user_id')
            .equals('user-1')
            .and((n) => !n.deleted)
            .count();

        expect(cleared).toBe(2);
        expect(remaining).toBe(0);
        expect(clearedSpy).toHaveBeenCalledWith({ count: 2 });
    });

    it('startListening is idempotent', async () => {
        const engine = createHookEngine();
        const hooks = createTypedHookEngine(engine);
        const service = new NotificationService(getDb(), hooks, 'user-1');
        const addSpy = vi.spyOn(hooks, 'addAction');
        const removeSpy = vi.spyOn(hooks, 'removeAction');

        const stopFirst = service.startListening();
        const stopSecond = service.startListening();

        stopFirst();
        stopSecond();

        expect(addSpy).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledTimes(1);
    });
});
