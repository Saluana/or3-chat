import type { SessionPayload } from '~/composables/auth/useSessionContext';

/** Longest a boot response is reused; after that the first check refetches. */
const BOOT_SESSION_MAX_AGE_MS = 10_000;

type BootSession = { at: number; response: Promise<SessionPayload | null> };
declare global {
    interface Window { __or3BootSession?: BootSession }
}

/**
 * Inline head script for the workspace page. It starts the session check while
 * the app's scripts download, instead of after they run. The request is fresh
 * (`no-store`) and any failure leaves the normal check to the app.
 */
export const BOOT_SESSION_SCRIPT =
    "window.__or3BootSession={at:Date.now(),response:fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'}}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}";

/**
 * Take the session response started by the boot script. Single use: later
 * checks always fetch again. Null when there is none, it failed or is stale.
 */
export async function takeBootSession(): Promise<SessionPayload | null> {
    if (typeof window === 'undefined') return null;
    const boot = window.__or3BootSession;
    if (!boot) return null;
    delete window.__or3BootSession;
    if (Date.now() - boot.at > BOOT_SESSION_MAX_AGE_MS) return null;
    return await boot.response;
}
