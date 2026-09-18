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
 *   the server reported, and stops on its own once the attempt is terminal.
 * - Disconnect stops the local server first and reports whether central
 *   revocation is still outstanding.
 *
 * Constraints:
 * - Client only. The link belongs to the signed-in local user; another local
 *   user reads a different binding and never sees this one.
 */

import { computed, onScopeDispose, ref } from 'vue';

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
    const status = ref<LibraryLinkStatus | null>(null);
    const loading = ref(false);
    const busy = ref(false);
    const failure = ref<LibraryLinkFailure | null>(null);
    let timer: ReturnType<typeof setTimeout> | null = null;

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
        clearTimer();
        const current = status.value;
        if (!current || current.state !== 'pending' || !current.pairing) return;
        const delay = Math.max(current.pairing.retryAfterMs, MIN_POLL_MS);
        timer = setTimeout(() => {
            timer = null;
            void load();
        }, delay);
    }

    async function load(): Promise<void> {
        loading.value = true;
        try {
            const result = await apiGet<unknown>('/api/plugins/library/link');
            status.value = normalizeStatus(result);
            failure.value = null;
        } catch (error) {
            failure.value = failureFrom(error);
        } finally {
            loading.value = false;
            schedule();
        }
    }

    async function connect(): Promise<void> {
        busy.value = true;
        try {
            const result = await apiPost<unknown>('/api/plugins/library/link');
            status.value = normalizeStatus(result);
            failure.value = null;
        } catch (error) {
            failure.value = failureFrom(error);
        } finally {
            busy.value = false;
            schedule();
        }
    }

    async function disconnect(): Promise<void> {
        busy.value = true;
        try {
            const result = await apiPost<unknown>('/api/plugins/library/link/disconnect');
            status.value = normalizeStatus(result);
            failure.value = null;
        } catch (error) {
            failure.value = failureFrom(error);
        } finally {
            busy.value = false;
            schedule();
        }
    }

    onScopeDispose(clearTimer);

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
