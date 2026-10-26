import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { NotificationService } from '~/core/notifications/notification-service';
import type { BackgroundJobTracker } from '../types';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';

const session = vi.hoisted(() => ({ current: { authenticated: true, user: { id: 'owner' }, workspace: { id: 'origin' } } }));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => session.current }));
const ids: string[] = [];
afterEach(async () => {
    setActiveWorkspaceDb(null);
    for (const id of ids.splice(0)) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
    vi.unstubAllGlobals();
});

it('stores detached completion in its originating workspace even with a current-workspace push listener', async () => {
    const originId = crypto.randomUUID(); const currentId = crypto.randomUUID(); ids.push(originId, currentId);
    const origin = setActiveWorkspaceDb(originId); await origin.open();
    const current = setActiveWorkspaceDb(currentId); await current.open();
    session.current.workspace.id = currentId;
    const raw = createHookEngine(); const hooks = createTypedHookEngine(raw);
    vi.stubGlobal('__OR3_TEST_CLIENT', true); vi.stubGlobal('__NUXT_HOOKS__', raw);
    const stop = new NotificationService(current, hooks, 'owner').startListening();
    const tracker = { jobId: 'job', userId: 'owner', threadId: 'private-thread', messageId: 'reply',
        originDb: origin, workspaceId: originId, subscribers: new Set() } as BackgroundJobTracker;
    try {
        const { emitBackgroundComplete } = await import('../backgroundJobNotifications');
        await emitBackgroundComplete(tracker, { status: 'complete' } as BackgroundJobStatus);
        expect(await current.notifications.count()).toBe(0);
        const stored = (await origin.notifications.toArray())[0]!;
        expect(stored.thread_id).toBe('private-thread');
        expect(stored.actions?.[0]?.data?.workspaceId).toBe(originId);
    } finally { stop(); }
});
