/**
 * One incoming gateway subscription per shared workspace database/account.
 * Dexie propagates committed changes to the other same-origin windows; outbox
 * managers remain independent so local edits never wait for ownership.
 */
interface SubscriptionLifecycle {
    start(): Promise<void>;
    stop(): Promise<void>;
}

export async function startCoordinatedSubscription(
    key: string,
    subscription: SubscriptionLifecycle
): Promise<() => Promise<void>> {
    const locks = navigator.locks;
    if (!locks) {
        await subscription.start();
        return () => subscription.stop();
    }

    let active = true;
    let pageActive = true;
    let fallback = false;
    let firstAttempt = true;
    let ready!: () => void;
    const initialReady = new Promise<void>(resolve => { ready = resolve; });
    let releaseOwner: (() => void) | undefined;
    let pending: { abort: AbortController; done: Promise<void> } | undefined;
    const eligible = () => active && pageActive &&
        document.visibilityState !== 'hidden' && navigator.onLine !== false;

    const removeListeners = () => {
        document.removeEventListener('visibilitychange', reconcile);
        window.removeEventListener('online', reconcile);
        window.removeEventListener('offline', reconcile);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
    };

    const acquire = () => {
        if (pending || fallback || !eligible()) return;
        const request = { abort: new AbortController(), done: Promise.resolve() };
        pending = request;
        let granted = false;
        let follow = false;
        const initial = firstAttempt;
        firstAttempt = false;
        // The first attempt distinguishes an owner (retain bootstrap-before-
        // outbox ordering) from a follower (never wait for another window).
        request.done = Promise.resolve().then(() => locks.request<void>(
            `or3:sync-subscription:v1:${key}`,
            initial ? { ifAvailable: true } : { signal: request.abort.signal },
            async lock => {
                if (!lock) { follow = true; ready(); return; }
                granted = true;
                if (!eligible()) { ready(); return; }
                let released = false;
                let stop: Promise<void> | undefined;
                let finish!: () => void;
                const releasedPromise = new Promise<void>(resolve => { finish = resolve; });
                const release = () => {
                    if (released) return;
                    released = true;
                    // Fence an in-flight bootstrap immediately, before yielding
                    // ownership. Keep the lock until its asynchronous work ends.
                    stop = subscription.stop().catch(error => {
                        console.error('[sync] Shared subscription cleanup failed:', error);
                    });
                    finish();
                };
                releaseOwner = release;
                try {
                    await subscription.start();
                    ready();
                    await releasedPromise;
                } finally {
                    ready();
                    release();
                    await stop;
                    if (releaseOwner === release) releaseOwner = undefined;
                }
            }
        )).catch(async error => {
            if (request.abort.signal.aborted) { ready(); return; }
            if (granted) {
                // SubscriptionManager owns connection retries; never spin a
                // second ownership/recovery loop after a lifecycle failure.
                console.error('[sync] Shared subscription failed:', error);
                ready();
                return;
            }
            // Restricted browser contexts can expose locks but refuse access.
            // Preserve the original per-window transport in that case.
            fallback = true;
            removeListeners();
            if (active) {
                try { await subscription.start(); }
                catch (failure) { console.error('[sync] Subscription fallback failed:', failure); }
            }
            ready();
        }).finally(() => {
            if (pending === request) pending = undefined;
            if ((follow || request.abort.signal.aborted) && eligible()) acquire();
        });
    };

    function reconcile(): void {
        if (fallback) return;
        if (eligible()) acquire();
        else {
            pending?.abort.abort();
            releaseOwner?.();
        }
    }
    function onPageHide(): void { pageActive = false; reconcile(); }
    function onPageShow(): void { pageActive = true; reconcile(); }

    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('online', reconcile);
    window.addEventListener('offline', reconcile);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    acquire();
    if (!eligible()) ready();
    await initialReady;

    return async () => {
        active = false;
        removeListeners();
        pending?.abort.abort();
        releaseOwner?.();
        await pending?.done;
        if (fallback) await subscription.stop();
    };
}
