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
} from '~~/shared/sync/types';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_PULL_LIMIT = 100;

export interface GatewaySyncProviderConfig {
    id?: string;
    baseUrl?: string;
    pollIntervalMs?: number;
    pullLimit?: number;
}

async function requestJson<T>(path: string, body: unknown, baseUrl: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`[gateway-sync] ${path} failed: ${res.status} ${text}`);
    }

    return (await res.json()) as T;
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
            onChanges: (changes: SyncChange[]) => void
        ): Promise<() => void> {
            let active = true;
            let cursor = 0;
            let timeout: ReturnType<typeof setTimeout> | null = null;

            const poll = async () => {
                let hasMore = true;
                while (active && hasMore) {
                    const response = await requestJson<PullResponse>(
                        '/api/sync/pull',
                        {
                            scope,
                            cursor,
                            limit: pullLimit,
                            tables,
                        },
                        baseUrl
                    );

                    if (response.changes.length) {
                        onChanges(response.changes);
                    }

                    if (response.nextCursor > cursor) {
                        cursor = response.nextCursor;
                    }

                    hasMore = response.hasMore;
                }
            };

            await poll();

            const run = async () => {
                if (!active) return;
                try {
                    await poll();
                } catch (error) {
                    console.error('[gateway-sync] Poll failed:', error);
                }
                if (!active) return;
                timeout = setTimeout(run, pollIntervalMs);
            };

            timeout = setTimeout(run, pollIntervalMs);

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
                baseUrl
            );
        },

        async gcTombstones(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await requestJson(
                '/api/sync/gc-tombstones',
                { scope, retentionSeconds },
                baseUrl
            );
        },

        async gcChangeLog(scope: SyncScope, retentionSeconds: number): Promise<void> {
            await requestJson(
                '/api/sync/gc-change-log',
                { scope, retentionSeconds },
                baseUrl
            );
        },

        async dispose(): Promise<void> {
            subscriptions.forEach((cleanup) => cleanup());
            subscriptions.clear();
        },
    };
}
