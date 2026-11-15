import type { Component } from 'vue';

function whenIdle(): Promise<void> {
    return new Promise((resolve) => {
        const ric = (globalThis as {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;
        if (typeof ric === 'function') ric(() => resolve(), { timeout: 4000 });
        else setTimeout(resolve, 200);
    });
}

function constrainedConnection(): boolean {
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    return Boolean(connection?.saveData || connection?.effectiveType?.includes('2g'));
}

/**
 * Resolve an async component through its own loader. Vue caches the result,
 * so its first render is synchronous. Plain components need no loading.
 */
export function loadAsyncComponent(component: Component | undefined): Promise<unknown> {
    return (component as { __asyncLoader?: () => Promise<unknown> } | undefined)?.__asyncLoader?.()
        ?? Promise.resolve();
}

/**
 * Load first-use code in idle time, one loader at a time, so the first chat
 * open, ⌘K or document renders without waiting for its chunks. Best effort:
 * a failure leaves that code to load on demand as before.
 */
export function prefetchWhenIdle(loaders: ReadonlyArray<() => Promise<unknown>>): void {
    if (typeof window === 'undefined' || constrainedConnection()) return;
    void (async () => {
        for (const load of loaders) {
            await whenIdle();
            try {
                await load();
            } catch {
                // Loaded on demand instead.
            }
        }
    })();
}
