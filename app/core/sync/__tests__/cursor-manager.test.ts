import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import {
    CursorManager,
    _resetCursorManagers,
    cleanupCursorManager,
    getCursorManager,
} from '../cursor-manager';

vi.mock('../hlc', () => ({
    getDeviceId: () => 'device-fixed',
}));

const databases = new Set<Dexie>();
afterEach(async () => { for (const db of databases) await db.delete(); databases.clear(); });
function makeDb(name = 'or3-db-ws-1') {
    const db = new Dexie(name);
    db.version(1).stores({ sync_state: 'id' });
    databases.add(db);
    return db;
}

describe('CursorManager', () => {
    it('never regresses across concurrent completion and cursor writes', async () => {
        const db = makeDb();
        const manager = new CursorManager(db as never, { workspaceId: 'ws-1' });
        await manager.setCursor(5);
        await Promise.all([manager.markSyncComplete(), manager.setCursor(30), manager.setCursor(10)]);
        expect(await manager.getCursor()).toBe(30);
    });
    beforeEach(() => {
        _resetCursorManagers();
    });

    it('starts at cursor=0 and bootstrap needed=true', async () => {
        const db = makeDb();
        const manager = new CursorManager(db as any, { workspaceId: 'ws-1' });

        await expect(manager.getCursor()).resolves.toBe(0);
        await expect(manager.isBootstrapNeeded()).resolves.toBe(true);
    });

    it('persists cursor and updates lastSyncAt on markSyncComplete', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T10:00:00.000Z'));

        const db = makeDb();
        const manager = new CursorManager(db as any, { workspaceId: 'ws-1' });

        await manager.setCursor(42);
        expect(await manager.getCursor()).toBe(42);

        vi.setSystemTime(new Date('2026-02-06T10:00:10.000Z'));
        await manager.markSyncComplete();
        expect(await manager.getLastSyncAt()).toBe(Date.now());

        vi.useRealTimers();
    });

    it('checks cursor expiry with custom maxAgeMs', async () => {
        vi.useFakeTimers();
        const db = makeDb();
        const manager = new CursorManager(db as any, { workspaceId: 'ws-1' });

        vi.setSystemTime(new Date('2026-02-06T10:00:00.000Z'));
        await manager.setCursor(1);
        await manager.markSyncComplete();

        vi.setSystemTime(new Date('2026-02-06T10:00:00.500Z'));
        await expect(manager.isCursorPotentiallyExpired(1000)).resolves.toBe(false);

        vi.setSystemTime(new Date('2026-02-06T10:00:02.000Z'));
        await expect(manager.isCursorPotentiallyExpired(1000)).resolves.toBe(true);

        vi.useRealTimers();
    });

    it('reset clears persisted state', async () => {
        const db = makeDb();
        const manager = new CursorManager(db as any, { workspaceId: 'ws-1' });

        await manager.setCursor(7);
        await manager.reset();

        await expect(manager.getCursor()).resolves.toBe(0);
    });

    it('is singleton per db+scope and resettable', () => {
        const db = makeDb('db-a');

        const a = getCursorManager(db as any, { workspaceId: 'ws-1' });
        const b = getCursorManager(db as any, { workspaceId: 'ws-1' });
        const c = getCursorManager(db as any, { workspaceId: 'ws-2' });

        expect(a).toBe(b);
        expect(a).not.toBe(c);

        _resetCursorManagers();
        const d = getCursorManager(db as any, { workspaceId: 'ws-1' });
        expect(d).not.toBe(a);
    });

    it('cleanupCursorManager removes scoped or all db instances', () => {
        const db = makeDb('db-cleanup');
        const ws1 = { workspaceId: 'ws-1' };
        const ws2 = { workspaceId: 'ws-2' };

        const a = getCursorManager(db as any, ws1);
        const b = getCursorManager(db as any, ws2);

        cleanupCursorManager('db-cleanup', ws1);
        const a2 = getCursorManager(db as any, ws1);
        const b2 = getCursorManager(db as any, ws2);

        expect(a2).not.toBe(a);
        expect(b2).toBe(b);

        cleanupCursorManager('db-cleanup');
        const b3 = getCursorManager(db as any, ws2);
        expect(b3).not.toBe(b2);
    });

    it('returns fixed device ID from HLC generator', () => {
        const db = makeDb();
        const manager = new CursorManager(db as any, { workspaceId: 'ws-1' });

        expect(manager.getDeviceId()).toBe('device-fixed');
    });
});
