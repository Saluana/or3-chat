import type { SessionPayload } from '~/composables/auth/useSessionContext';

/** One budget for the boot response, provider recovery and session fetches. */
export const SESSION_CHECK_TIMEOUT_MS = 10_000;

/** Longest a boot response is reused; after that the first check refetches. */
const BOOT_SESSION_MAX_AGE_MS = 10_000;

type BootSession = {
    at: number;
    response: Promise<SessionPayload | null>;
    controller?: AbortController;
};

/**
 * Start the session check while app scripts download. The head request owns a
 * deadline even if application initialization never reaches takeBootSession().
 */
export const BOOT_SESSION_SCRIPT =
    `(()=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),${SESSION_CHECK_TIMEOUT_MS});window.__or3BootSession={at:Date.now(),controller,response:fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'},signal:controller.signal}).then(r=>r.ok?r.json():null).catch(()=>null).finally(()=>clearTimeout(timer))}})()`;

/**
 * Take a boot response once. Expired or failed responses leave the normal check
 * to the app; cancellation also stops the underlying head request when supported.
 */
export async function takeBootSession(signal?: AbortSignal): Promise<SessionPayload | null> {
    const browser = (globalThis as { window?: { __or3BootSession?: BootSession } }).window;
    if (!browser) return null;
    const boot = browser.__or3BootSession;
    if (!boot) return null;
    delete browser.__or3BootSession;
    const remainingMs = BOOT_SESSION_MAX_AGE_MS - Math.max(0, Date.now() - boot.at);
    if (remainingMs <= 0) {
        boot.controller?.abort();
        return null;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const boundary = new Promise<null>((resolve, reject) => {
        timer = setTimeout(() => {
            boot.controller?.abort();
            resolve(null);
        }, remainingMs);
        onAbort = () => {
            boot.controller?.abort(signal?.reason);
            reject(signal?.reason ?? new DOMException('Session check cancelled', 'AbortError'));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([boot.response, boundary]);
    } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
}
