import { describe, it, expect, vi } from 'vitest';
import type { Or3DB } from '~/db/client';
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
});
