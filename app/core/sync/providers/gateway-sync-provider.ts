/**
 * @module app/core/sync/providers/gateway-sync-provider
 *
 * Purpose:
 * Implements `SyncProvider` using SSR gateway endpoints. Provides real-time
 * sync via polling (not WebSockets) and proxies all operations through
 * `/api/sync/*` server routes.
 *
 * Behavior:
 * - `subscribe()`: Polls `/api/sync/pull` on an interval (default 2s)
 *   with random jitter to prevent thundering herd. Supports backpressure
 *   by awaiting async `onChanges` handlers before re-polling.
 * - `pull()`: Single request to `/api/sync/pull`
 * - `push()`: Sends batched ops to `/api/sync/push`
 * - `updateCursor()` / `gcTombstones()` / `gcChangeLog()`: Proxied via
 *   corresponding gateway endpoints
 *
 * Constraints:
 * - Polling-based (no true real-time push); latency = poll interval + jitter
 * - Auth is session-based (cookies); no client-side JWT needed
 * - Error messages are sanitized to a max of 200 chars for user-facing display
 * - Subscribe resolves immediately (does not await first poll) to avoid
 *   deadlocking resubscribe logic in SubscriptionManager
 *
 * @see shared/sync/types for SyncProvider interface
 * @see server/api/sync/ for the SSR endpoint implementations
 */
import type {
    SyncProvider,
    SyncScope,
    SyncChange,
    PullRequest,
    PullResponse,
    PushBatch,
    PushResult,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_PULL_LIMIT = 100;

/**
 * Purpose:
 * Configuration for the gateway (SSR-proxied) sync provider.
 *
 * Constraints:
 * - `baseUrl` should typically be same-origin for cookie auth
 * - Polling has inherent latency; keep `pollIntervalMs` conservative
 */
export interface GatewaySyncProviderConfig {
    id?: string;
    baseUrl?: string;
    pollIntervalMs?: number;
    pullLimit?: number;
}

class GatewaySyncRequestError extends Error {
    status: number;
    path: string;
    retryAfterMs?: number;

    constructor(path: string, status: number, message: string, retryAfterMs?: number) {
        super(`[gateway-sync] ${path} failed (${status}): ${message}`);
        this.name = 'GatewaySyncRequestError';
        this.status = status;
        this.path = path;
        this.retryAfterMs = retryAfterMs;
    }
}

export function isAbortLikeError(error: unknown): boolean {
    if (error instanceof DOMException) return error.name === 'AbortError';
    return error instanceof Error && error.name === 'AbortError';
}

function parseRetryAfterHeader(value: string | null): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
    }

    const asDateMs = Date.parse(trimmed);
    if (!Number.isFinite(asDateMs)) return undefined;
    const delta = asDateMs - Date.now();
    if (delta <= 0) return undefined;
    return delta;
}

/**
 * Truncate and sanitize error text for user-facing display.
 * Removes JSON blobs, stack traces, and limits length.
 */
function sanitizeErrorText(text: string, maxLength: number = 200): string {
    // Try to parse as JSON and extract a meaningful error message
    try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.message === 'string') {
                return obj.message.slice(0, maxLength);
            }
            if (obj.error !== undefined) {
                return String(obj.error).slice(0, maxLength);
            }
        }
    } catch {
        // Not JSON, continue with text sanitization
    }

    // Remove stack traces (lines starting with "at " or containing file paths)
    const lines = text.split('\n').filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('at ') && !trimmed.match(/\.(ts|js|vue):\d+/);
    });

    const cleaned = lines.join(' ').trim();
    return cleaned.slice(0, maxLength);
}

async function requestJson<T>(
    path: string,
    body: unknown,
    baseUrl: string,
    options: { allowEmpty?: boolean; signal?: AbortSignal } = {}
): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options.signal,
    });

    if (!res.ok) {
        const retryAfterMs = parseRetryAfterHeader(res.headers.get('Retry-After'));
        const text = await res.text();
        const sanitized = sanitizeErrorText(text);
        throw new GatewaySyncRequestError(path, res.status, sanitized, retryAfterMs);
    }

    const text = await res.text();
    if (!text || text.trim().length === 0) {
        if (options.allowEmpty) {
            return undefined as T;
        }
        throw new Error(`[gateway-sync] ${path} returned empty response`);
    }

    return JSON.parse(text) as T;
}

/**
 * Purpose:
 * Create a SyncProvider that proxies sync operations through SSR `/api/sync/*` endpoints.
 *
 * Behavior:
 * - Uses polling for `subscribe()` (awaits handlers for backpressure)
 * - Uses `pull()`/`push()` gateway endpoints for transport
 *
 * Constraints:
 * - Requires SSR routes; not available in static-only builds
 */
export function createGatewaySyncProvider(
    config: GatewaySyncProviderConfig = {}
): SyncProvider {
    const baseUrl = config.baseUrl ?? '';
    const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const pullLimit = config.pullLimit ?? DEFAULT_PULL_LIMIT;
    const subscriptions = new Set<() => void>();

    return {
        id: config.id ?? 'gateway',
        mode: 'gateway',

        async subscribe(
            scope: SyncScope,
            tables: string[],
            onChanges: (changes: SyncChange[]) => void | Promise<void>,
            options?: SyncSubscribeOptions
        ): Promise<() => void> {
            let active = true;
            let cursor = options?.cursor ?? 0;
            const limit = options?.limit ?? pullLimit;
            let timeout: ReturnType<typeof setTimeout> | null = null;
            let running = false;
            const pollAbortController = new AbortController();

            const poll = async () => {
                let hasMore = true;
                while (active && hasMore) {
                    const previousCursor = cursor;
                    const response = await requestJson<PullResponse>(
                        '/api/sync/pull',
                        {
                            scope,
                            cursor,
                            limit,
                            tables,
                        },
                        baseUrl,
                        { signal: pollAbortController.signal }
                    );

                    if (response.changes.length) {
                        // Allow async handlers (SubscriptionManager) to provide backpressure.
                        // This prevents overlapping apply cycles which can break cursor accounting.
                        await Promise.resolve(onChanges(response.changes));
                    }

                    if (response.nextCursor > cursor) {
                        cursor = response.nextCursor;
                    }

                    hasMore = response.hasMore;
                    if (hasMore && cursor <= previousCursor) {
                        console.error('[gateway-sync] Non-advancing cursor during poll loop', {
                            cursor: previousCursor,
                            nextCursor: response.nextCursor,
                        });
                        break;
                    }
                }
            };

            const run = async () => {
                if (!active || running) return;
                running = true;
                try {
                    await poll();
                } catch (error) {
                    if (isAbortLikeError(error)) return;
                    console.error('[gateway-sync] Poll failed:', error);
                    if (
                        error instanceof GatewaySyncRequestError &&
                        (error.status === 401 || error.status === 403)
                    ) {
                        active = false;
                        const eventTarget = globalThis as {
                            dispatchEvent?: (event: unknown) => boolean;
                        };
                        if (typeof eventTarget.dispatchEvent === 'function') {
                            eventTarget.dispatchEvent(
                                new CustomEvent('or3:sync-session-invalid', {
                                    detail: {
                                        status: error.status,
                                        path: error.path,
                                        workspaceId: scope.workspaceId,
                                    },
                                })
                            );
                        }
                    }
                } finally {
                    running = false;
                }
                if (!active) return;
                // Add random jitter (0-500ms) to prevent thundering herd
                const jitter = Math.floor(Math.random() * 500);
                timeout = setTimeout(run, pollIntervalMs + jitter);
            };

            // Delay the first poll by the configured interval + jitter.
            // This avoids a wasted round-trip immediately after bootstrap when the cursor
            // is already up-to-date. Callers still get the unsubscribe handle synchronously.
            const initialJitter = Math.floor(Math.random() * 500);
            timeout = setTimeout(run, pollIntervalMs + initialJitter);

            const unsubscribe = () => {
                active = false;
                pollAbortController.abort();
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
            };

            subscriptions.add(unsubscribe);

            return () => {
                unsubscribe();
                subscriptions.delete(unsubscribe);
            };
        },

        async pull(request: PullRequest): Promise<PullResponse> {
            return requestJson<PullResponse>('/api/sync/pull', request, baseUrl);
        },

        async push(batch: PushBatch): Promise<PushResult> {
            return requestJson<PushResult>('/api/sync/push', batch, baseUrl);
        },

        async updateCursor(scope: SyncScope, deviceId: string, version: number): Promise<void> {
            await requestJson(
                '/api/sync/update-cursor',
                { scope, deviceId, version },
                baseUrl,
                { allowEmpty: true }
            );
        },

        async gcTombstones(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await requestJson(
                '/api/sync/gc-tombstones',
                { scope, retentionSeconds },
                baseUrl,
                { allowEmpty: true }
            );
        },

        async gcChangeLog(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await requestJson(
                '/api/sync/gc-change-log',
                { scope, retentionSeconds },
                baseUrl,
                { allowEmpty: true }
            );
        },

        async dispose(): Promise<void> {
            subscriptions.forEach((cleanup) => cleanup());
            subscriptions.clear();
        },
    };
}
