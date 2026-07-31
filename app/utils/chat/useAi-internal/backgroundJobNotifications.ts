/**
 * Completion-notification policy for detached background chat jobs.
 *
 * This module owns notification suppression and delivery only. Tracker
 * transport and persistence stay in backgroundJobs.ts.
 */
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import type { HookEngine } from '~/core/hooks/hooks';
import type { TypedHookEngine } from '~/core/hooks/typed-hooks';
import { NotificationService } from '~/core/notifications/notification-service';
import { resolveNotificationUserId } from '~/core/notifications/notification-user';
import { getCachedSessionContext } from '~/composables/auth/useSessionContext';
import { getDb } from '~/db/client';
import { newId } from '~/db/util';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import type { BackgroundJobTracker } from './types';

export const BACKGROUND_JOB_MUTED_KEY = 'notification_muted_threads';

let cachedNotificationHooks: TypedHookEngine | null = null;

function isClientRuntime(): boolean {
    const override = (globalThis as { __OR3_TEST_CLIENT?: boolean })
        .__OR3_TEST_CLIENT;
    if (typeof override === 'boolean') return override;
    return Boolean(import.meta.client);
}

function resolveNotificationHooks(): TypedHookEngine | null {
    if (cachedNotificationHooks) return cachedNotificationHooks;
    const globalHooks = globalThis as typeof globalThis & {
        __NUXT_HOOKS__?: HookEngine;
    };
    if (!globalHooks.__NUXT_HOOKS__) return null;
    cachedNotificationHooks = createTypedHookEngine(
        globalHooks.__NUXT_HOOKS__
    );
    return cachedNotificationHooks;
}

async function isThreadMuted(
    threadId: string,
    userId?: string
): Promise<boolean> {
    if (!isClientRuntime()) return false;
    try {
        const scopedKey =
            userId && userId.length > 0
                ? `${BACKGROUND_JOB_MUTED_KEY}:${userId}`
                : null;
        const db = getDb();
        const kv =
            (scopedKey ? await db.kv.get(scopedKey) : null) ||
            (await db.kv.get(BACKGROUND_JOB_MUTED_KEY));
        if (!kv?.value) return false;
        const parsed: unknown = JSON.parse(kv.value);
        return Array.isArray(parsed) && parsed.includes(threadId);
    } catch {
        return false;
    }
}

export async function emitBackgroundComplete(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus
): Promise<void> {
    if (!isClientRuntime() || !tracker.threadId) return;

    const hasSubscribers = tracker.subscribers.size > 0;
    if (tracker.preferServerNotifications && !hasSubscribers) return;

    const isTabHidden =
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden';
    if (hasSubscribers && !isTabHidden) return;
    if (await isThreadMuted(tracker.threadId, tracker.userId)) return;

    const hooks = resolveNotificationHooks();
    if (!hooks) return;

    const isError = status.status === 'error';
    const isAbort = status.status === 'aborted';
    const payload = {
        type:
            isError || isAbort
                ? 'system.warning'
                : 'ai.message.received',
        title: isError
            ? 'AI response failed'
            : isAbort
              ? 'AI response stopped'
              : 'AI response ready',
        body: isError
            ? status.error || 'Background response failed.'
            : isAbort
              ? 'Background response was aborted.'
              : 'Your background response is ready.',
        threadId: tracker.threadId,
        actions: [
            {
                id: newId(),
                label: 'Open chat',
                kind: 'navigate' as const,
                target: { threadId: tracker.threadId },
                data: { messageId: tracker.messageId },
            },
        ],
    };

    try {
        if (hooks.hasAction('notify:action:push')) {
            await hooks.doAction('notify:action:push', payload);
            return;
        }

        const session = getCachedSessionContext();
        const sessionUserId =
            session?.authenticated && session.user?.id ? session.user.id : null;
        const userId =
            sessionUserId ||
            tracker.userId ||
            resolveNotificationUserId(session);
        await new NotificationService(getDb(), hooks, userId).create(payload);
    } catch {
        // Notifications are best-effort and must never fail job finalization.
    }
}
