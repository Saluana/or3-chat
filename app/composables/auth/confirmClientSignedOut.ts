/**
 * Confirm a client is durably signed out before destructive logout work.
 *
 * A single null `/api/auth/session` snapshot (common under HMR) must not
 * trigger logoutCleanup / reloadNuxtApp. Providers report readiness via
 * `resolveClientAuthStatus`; we require sustained signed-out across a short
 * confirmation window.
 */
import { useRuntimeConfig } from '#imports';
import { fetchClientSession } from '~/composables/auth/client-session-request';
import { resolveClientAuthStatus } from '~/composables/auth/useClientAuthStatus.client';

export const DEFAULT_SIGNED_OUT_CONFIRM_MS = 400;

export type ConfirmClientSignedOutOptions = {
    /** Wait between the first and second status check. */
    confirmMs?: number;
    /** Injectable clock for tests. */
    sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkSignedOut(basicAuth: boolean): Promise<boolean> {
    try {
        if (basicAuth) {
            // Older Basic Auth adapters collapse transport failures into
            // signed-out status. Require a successful host session probe.
            const { session } = await fetchClientSession();
            return session === null || session.authenticated === false;
        }
        const status = await resolveClientAuthStatus();
        return status.ready && status.authenticated === false;
    } catch {
        return false;
    }
}

/** Require signed-out status on two consecutive checks separated by `confirmMs`. */
export async function confirmClientSignedOut(
    options: ConfirmClientSignedOutOptions = {}
): Promise<boolean> {
    const confirmMs = options.confirmMs ?? DEFAULT_SIGNED_OUT_CONFIRM_MS;
    const sleep = options.sleep ?? defaultSleep;

    const basicAuth = useRuntimeConfig().public.authProvider === 'basic-auth';
    if (!(await checkSignedOut(basicAuth))) {
        return false;
    }

    if (confirmMs > 0) {
        await sleep(confirmMs);
    }

    return checkSignedOut(basicAuth);
}
