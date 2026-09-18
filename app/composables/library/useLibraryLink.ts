/**
 * @module app/composables/library/useLibraryLink
 *
 * Purpose:
 * Client state for Dashboard > Library: this local user's marketplace link.
 *
 * Behavior:
 * - Every call goes to the local server, which owns the polling secret and the
 *   credential; the browser only ever sees the comparison code, the verification
 *   URL and the linked account summary.
 * - While a pairing waits for approval the composable re-checks on the interval
 *   the server reported; while a revocation is still unconfirmed it retries on a
 *   slow schedule, so "retried automatically" is true for a page left open.
 * - State belongs to one local user: switching the signed-in user resets it and
 *   any in-flight response for the previous user is discarded.
 * - Disposal cancels outstanding work; a request that finishes during teardown
 *   cannot schedule another poll.
 *
 * Constraints:
 * - Client only. The link belongs to the signed-in local user; another local
 *   user reads a different binding and never sees this one.
 */

import { computed, onScopeDispose, ref, watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';

export type LibraryLinkState =
    | 'unlinked'
    | 'pending'
    | 'linked'
    | 'denied'
    | 'expired'
    | 'revoked'
    | 'lost';

export interface LibraryLinkPairing {
    readonly code: string;
    readonly verificationUrl: string;
    readonly expiresAt: string;
    readonly retryAfterMs: number;
}

export interface LibraryLinkedSummary {
    readonly id: string;
    readonly label: string;
    readonly origin: string;
    readonly scopes: readonly string[];
    readonly expiresAt: string;
    readonly account?: string;
    readonly accountId?: string;
    readonly lastVerifiedAt?: string;
}

export interface LibraryLinkStatus {
    readonly configured: boolean;
    readonly state: LibraryLinkState;
    readonly pairing?: LibraryLinkPairing;
    readonly link?: LibraryLinkedSummary;
    readonly reason?: string;
    readonly centralRevokePending?: boolean;
    readonly notice?: { readonly code: string; readonly message: string };
}

export interface LibraryLinkFailure {
    readonly code?: string;
    readonly message: string;
    readonly retryable: boolean;
}

/** Never poll faster than a second; the server decides the real interval. */
const MIN_POLL_MS = 1_000;
/** How often an unconfirmed revocation is retried while the page is open. */
const REVOCATION_RETRY_MS = 60_000;

const KNOWN_STATES: readonly LibraryLinkState[] = [
    'unlinked',
    'pending',
    'linked',
    'denied',
    'expired',
    'revoked',
    'lost',
];

function stringField(source: Record<string, unknown>, key: string): string | undefined {
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Keep only the fields this surface uses. The server is trusted, but a
 * credential-shaped field in a response must never end up in browser state at
 * all (R15.AC4), so the DTO is rebuilt rather than stored verbatim.
 */
function normalizeStatus(raw: unknown): LibraryLinkStatus {
    const source = (raw ?? {}) as Record<string, unknown>;
    const state = KNOWN_STATES.includes(source.state as LibraryLinkState)
        ? (source.state as LibraryLinkState)
        : 'unlinked';

    const pairingSource = (source.pairing ?? null) as Record<string, unknown> | null;
    const linkSource = (source.link ?? null) as Record<string, unknown> | null;
    const noticeSource = (source.notice ?? null) as Record<string, unknown> | null;

    const pairing =
        state === 'pending' && pairingSource
            ? {
                  code: stringField(pairingSource, 'code') ?? '',
                  verificationUrl: stringField(pairingSource, 'verificationUrl') ?? '',
                  expiresAt: stringField(pairingSource, 'expiresAt') ?? '',
                  retryAfterMs:
                      typeof pairingSource.retryAfterMs === 'number' &&
                      Number.isFinite(pairingSource.retryAfterMs)
                          ? Math.max(pairingSource.retryAfterMs, 0)
                          : MIN_POLL_MS,
              }
            : undefined;

    const link =
        state === 'linked' && linkSource
            ? {
                  id: stringField(linkSource, 'id') ?? '',
                  label: stringField(linkSource, 'label') ?? '',
                  origin: stringField(linkSource, 'origin') ?? '',
                  scopes: Array.isArray(linkSource.scopes)
                      ? linkSource.scopes.filter((scope): scope is string => typeof scope === 'string')
                      : [],
                  expiresAt: stringField(linkSource, 'expiresAt') ?? '',
                  ...(stringField(linkSource, 'account')
                      ? { account: stringField(linkSource, 'account') }
                      : {}),
                  ...(stringField(linkSource, 'accountId')
                      ? { accountId: stringField(linkSource, 'accountId') }
                      : {}),
                  ...(stringField(linkSource, 'lastVerifiedAt')
                      ? { lastVerifiedAt: stringField(linkSource, 'lastVerifiedAt') }
                      : {}),
              }
            : undefined;

    return {
        configured: source.configured !== false,
        state,
        ...(pairing ? { pairing } : {}),
        ...(link ? { link } : {}),
        ...(stringField(source, 'reason') ? { reason: stringField(source, 'reason') } : {}),
        ...(source.centralRevokePending === true ? { centralRevokePending: true } : {}),
        ...(noticeSource
            ? {
                  notice: {
                      code: stringField(noticeSource, 'code') ?? '',
                      message: stringField(noticeSource, 'message') ?? '',
                  },
              }
            : {}),
    };
}

function failureFrom(error: unknown): LibraryLinkFailure {
    const data = (error as { data?: unknown })?.data as
        | { error?: { code?: string; message?: string; retryable?: boolean }; message?: string }
        | undefined;
    if (data?.error && typeof data.error.message === 'string') {
        return {
            code: data.error.code,
            message: data.error.message,
            retryable: data.error.retryable === true,
        };
    }
    if (typeof data?.message === 'string') {
        return { message: data.message, retryable: false };
    }
    return {
        message: error instanceof Error ? error.message : 'The request failed.',
        retryable: false,
    };
}

async function apiGet<T>(url: string): Promise<T> {
    return (await ($fetch as unknown as (input: string) => Promise<unknown>)(url)) as T;
}

async function apiPost<T>(url: string, body?: unknown): Promise<T> {
    return (await (
        $fetch as unknown as (input: string, init: Record<string, unknown>) => Promise<unknown>
    )(url, { method: 'POST', ...(body === undefined ? {} : { body }) })) as T;
}

export function useLibraryLink() {
    const session = useSessionContext();
    const userId = computed(() => session.data.value?.session?.user?.id ?? null);

    const status = ref<LibraryLinkStatus | null>(null);
    const loading = ref(false);
    const busy = ref(false);
    const failure = ref<LibraryLinkFailure | null>(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    /** Invalidates in-flight responses when the identity or scope changes. */
    let generation = 0;

    const state = computed<LibraryLinkState>(() => status.value?.state ?? 'unlinked');
    const configured = computed(() => status.value?.configured !== false);
    const pairing = computed(() => status.value?.pairing ?? null);
    const link = computed(() => status.value?.link ?? null);

    function clearTimer(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function schedule(): void {
        if (disposed) return;
        clearTimer();
        const current = status.value;
        if (!current) return;
        const pairingState = current.state === 'pending' ? current.pairing : null;
        let delay: number;
        if (pairingState) {
            delay = Math.max(pairingState.retryAfterMs, MIN_POLL_MS);
        } else if (current.centralRevokePending === true) {
            // Disconnect during an outage must keep retrying, not stop polling
            // because the record is no longer `pending`.
            delay = REVOCATION_RETRY_MS;
        } else {
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            void load();
        }, delay);
    }

    async function run(request: (current: number) => Promise<void>): Promise<void> {
        if (disposed) return;
        const current = generation;
        try {
            await request(current);
        } finally {
            if (!disposed && generation === current) schedule();
        }
    }

    async function load(): Promise<void> {
        loading.value = true;
        try {
            await run(async (current) => {
                const result = await apiGet<unknown>('/api/plugins/library/link');
                if (disposed || generation !== current) return;
                status.value = normalizeStatus(result);
                failure.value = null;
            });
        } catch (error) {
            failure.value = failureFrom(error);
        } finally {
            loading.value = false;
        }
    }

    async function connect(): Promise<void> {
        busy.value = true;
        try {
            await run(async (current) => {
                const result = await apiPost<unknown>('/api/plugins/library/link');
                if (disposed || generation !== current) return;
                status.value = normalizeStatus(result);
                failure.value = null;
            });
        } catch (error) {
            failure.value = failureFrom(error);
        } finally {
            busy.value = false;
        }
    }

    async function disconnect(): Promise<void> {
        busy.value = true;
        try {
            await run(async (current) => {
                const result = await apiPost<unknown>('/api/plugins/library/link/disconnect');
                if (disposed || generation !== current) return;
                status.value = normalizeStatus(result);
                failure.value = null;
            });
        } catch (error) {
            failure.value = failureFrom(error);
        } finally {
            busy.value = false;
        }
    }

    /** A response that arrives after the identity changed is discarded. */
    watch(userId, (next, previous) => {
        if (next === previous) return;
        generation += 1;
        clearTimer();
        status.value = null;
        failure.value = null;
        if (next) void load();
    });

    onScopeDispose(() => {
        disposed = true;
        generation += 1;
        clearTimer();
    });

    return {
        status,
        state,
        configured,
        pairing,
        link,
        loading,
        busy,
        failure,
        load,
        connect,
        disconnect,
    };
}
