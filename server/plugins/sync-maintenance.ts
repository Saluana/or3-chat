/**
 * @module server/plugins/sync-maintenance
 *
 * Purpose:
 * In-process scheduler for SQLite sync-history maintenance (change-log and
 * tombstone GC). Runs only when SSR sync is enabled AND the active sync
 * provider is `sqlite`. Reuses the registered SyncGatewayAdapter directly —
 * it never widens the HTTP action surface.
 *
 * Safety:
 * - Non-overlapping: a pass is skipped if the previous one is still running.
 * - Bounded cadence: 60 minutes, guarded to a 5-minute minimum.
 * - An initial pass is queued after Nitro plugin setup, after provider plugins
 *   have registered and finished their database migrations.
 * - Inert in static builds / non-sqlite configs (early return).
 * - Never throws at startup if the provider is not registered.
 */
import { defineNitroPlugin } from 'nitropack/runtime';
import type { NitroApp } from 'nitropack';
import { useRuntimeConfig } from '#imports';
import { getSyncGatewayAdapter } from '../sync/gateway/registry';
import { MAX_SYNC_RETENTION_SECONDS } from '~~/shared/sync/history-gc-policy';
import type { H3Event } from 'h3';

const SYNC_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const MIN_SYNC_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

/** Module-scoped lock: skip a tick while a previous pass is still active. */
let running = false;
let initialPassQueued = false;

/**
 * Run one bounded maintenance pass across every workspace.
 *
 * Behavior:
 * - Fetches the sqlite gateway from the registry (no hard provider import).
 * - Enumerates workspaces via `listWorkspaceIds()`.
 * - Runs gcChangeLog + gcTombstones per workspace with the max bounded window.
 * - Records maintenance state (begin/complete/fail) on the provider.
 */
export async function runSyncMaintenance(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const adapter = getSyncGatewayAdapter('sqlite');
        if (!adapter) return;

        adapter.beginMaintenanceRun?.();
        try {
            const workspaceIds = (await adapter.listWorkspaceIds?.()) ?? [];
            for (const workspaceId of workspaceIds) {
                await adapter.gcChangeLog?.(
                    {} as H3Event,
                    { scope: { workspaceId }, retentionSeconds: MAX_SYNC_RETENTION_SECONDS }
                );
                await adapter.gcTombstones?.(
                    {} as H3Event,
                    { scope: { workspaceId }, retentionSeconds: MAX_SYNC_RETENTION_SECONDS }
                );
            }
            adapter.completeMaintenanceRun?.({ lastRun: new Date().toISOString() });
        } catch (error) {
            adapter.failMaintenanceRun?.(
                error instanceof Error ? error.message : String(error)
            );
        }
    } finally {
        running = false;
    }
}

/**
 * Start the bounded scheduler. Returns null when sync is not sqlite+enabled.
 */
export function startSyncMaintenanceScheduler(): { stop: () => void } | null {
    const config = useRuntimeConfig();
    if (config.sync?.enabled !== true || config.sync?.provider !== 'sqlite') {
        return null;
    }

    const intervalMs = Math.max(
        MIN_SYNC_MAINTENANCE_INTERVAL_MS,
        SYNC_MAINTENANCE_INTERVAL_MS
    );
    const handle = setInterval(() => {
        void runSyncMaintenance();
    }, intervalMs);
    if (typeof handle.unref === 'function') {
        handle.unref();
    }

    return {
        stop() {
            clearInterval(handle);
        },
    };
}

function queueInitialMaintenancePass(): void {
    if (initialPassQueued) return;
    initialPassQueued = true;
    const timer = setTimeout(() => {
        initialPassQueued = false;
        void runSyncMaintenance();
    }, 0);
    if (typeof timer.unref === 'function') timer.unref();
}

export default defineNitroPlugin((nitroApp: NitroApp) => {
    const config = useRuntimeConfig();
    if (config.sync?.enabled !== true || config.sync?.provider !== 'sqlite') {
        return;
    }

    if (!getSyncGatewayAdapter('sqlite')) {
        console.debug(
            '[sync-maintenance] SQLite sync gateway not registered; scheduler will retry on each tick'
        );
    }

    const scheduler = startSyncMaintenanceScheduler();
    if (!scheduler) return;

    queueInitialMaintenancePass();

    nitroApp.hooks.hook('close', () => {
        scheduler.stop();
    });
});
