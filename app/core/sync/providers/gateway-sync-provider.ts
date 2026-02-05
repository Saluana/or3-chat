/**
 * Gateway Sync Provider
 *
 * Uses SSR endpoints for sync operations (push/pull/update cursor).
 * Suitable for providers that cannot be accessed directly from the client.
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

export interface GatewaySyncProviderConfig {
    id?: string;
    baseUrl?: string;
    pollIntervalMs?: number;
    pullLimit?: number;
}

/**
 * Truncate and sanitize error text for user-facing display.
 * Removes JSON blobs, stack traces, and limits length.
 */
function sanitizeErrorText(text: string, maxLength: number = 200): string {
    // Try to parse as JSON and extract a meaningful error message
    try {
        const parsed = JSON.parse(text);
        if (parsed.message) {
            return parsed.message.slice(0, maxLength);
        }
        if (parsed.error) {
            return String(parsed.error).slice(0, maxLength);
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
    options: { allowEmpty?: boolean } = {}
): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        const sanitized = sanitizeErrorText(text);
        throw new Error(`[gateway-sync] ${path} failed (${res.status}): ${sanitized}`);
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

            const poll = async () => {
                let hasMore = true;
                while (active && hasMore) {
                    const response = await requestJson<PullResponse>(
                        '/api/sync/pull',
                        {
                            scope,
                            cursor,
                            limit,
                            tables,
                        },
                        baseUrl
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
                }
            };

            const run = async () => {
                if (!active || running) return;
                running = true;
                try {
                    await poll();
                } catch (error) {
                    console.error('[gateway-sync] Poll failed:', error);
                } finally {
                    running = false;
                }
                if (!active) return;
                // Add random jitter (0-500ms) to prevent thundering herd
                const jitter = Math.floor(Math.random() * 500);
                timeout = setTimeout(run, pollIntervalMs + jitter);
            };

            // Start immediately. Do not await initial poll; callers expect subscribe() to resolve quickly
            // with an unsubscribe handle. Awaiting the initial poll can deadlock resubscribe logic.
            timeout = setTimeout(run, 0);

            const unsubscribe = () => {
                active = false;
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
