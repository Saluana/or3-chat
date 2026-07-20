/**
 * Confirm a client is durably signed out before destructive logout work.
 *
 * A single null `/api/auth/session` snapshot (common under HMR) must not
 * trigger logoutCleanup / reloadNuxtApp. Providers report readiness via
 * `resolveClientAuthStatus`; we require sustained signed-out across a short
 * confirmation window.
 */
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

async function isConfirmedSignedOutSnapshot(): Promise<boolean> {
    const status = await resolveClientAuthStatus();
    if (!status.ready) return false;
    if (status.authenticated === undefined) return false;
    return status.authenticated === false;
}

/**
 * Returns true only when the auth provider is ready and reports signed-out
 * on two consecutive checks separated by `confirmMs`.
 */
export async function confirmClientSignedOut(
    options: ConfirmClientSignedOutOptions = {}
): Promise<boolean> {
    const confirmMs = options.confirmMs ?? DEFAULT_SIGNED_OUT_CONFIRM_MS;
    const sleep = options.sleep ?? defaultSleep;

    if (!(await isConfirmedSignedOutSnapshot())) {
        return false;
    }

    if (confirmMs > 0) {
        await sleep(confirmMs);
    }

    return await isConfirmedSignedOutSnapshot();
}
