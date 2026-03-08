import { randomUUID } from 'node:crypto';
import type { NitroApp } from 'nitropack';
import { defineNitroPlugin } from 'nitropack/runtime';
import { useRuntimeConfig } from '#imports';
import { createWebhookDispatcher } from '../utils/webhooks/dispatcher';
import { createWebhookEventBridge } from '../utils/webhooks/event-bridge';
import { isWebhooksEnabled } from '../utils/webhooks/is-webhooks-enabled';
import {
    getActiveWebhookRuntime,
    setActiveWebhookRuntime,
    stopActiveWebhookRuntime,
    type ActiveWebhookRuntime,
} from '../utils/webhooks/runtime';
import { resolveConfiguredWebhookStore } from '../utils/webhooks/store/resolve-store';

const ONE_HOUR_MS = 60 * 60 * 1000;
const PLUGIN_REAPER_INTERVAL_MS = 2 * 60 * 1000;
const STALE_IN_FLIGHT_REAPER_MS = 5 * 60 * 1000;

function resolveEncryptionKey(): string | null {
    const config = useRuntimeConfig();
    const encryptionKey =
        (config.webhooks as { encryptionKey?: unknown } | undefined)?.encryptionKey;

    return typeof encryptionKey === 'string' && encryptionKey.trim().length > 0
        ? encryptionKey
        : null;
}

function unrefInterval(handle: ReturnType<typeof setInterval>): void {
    if (typeof handle.unref === 'function') {
        handle.unref();
    }
}

export async function startWebhookRuntime(
    nitroApp: NitroApp
): Promise<ActiveWebhookRuntime | null> {
    if (!isWebhooksEnabled()) {
        return null;
    }

    const config = useRuntimeConfig();
    const encryptionKey = resolveEncryptionKey();
    if (!encryptionKey) {
        console.warn(
            '[webhooks] Webhooks enabled but no encryption key is configured; skipping runtime startup'
        );
        return null;
    }

    const store = resolveConfiguredWebhookStore(config);
    if (!store) {
        console.warn(
            '[webhooks] No webhook store is configured for the active sync provider; skipping runtime startup'
        );
        return null;
    }

    const workerId = randomUUID();
    const dispatcher = createWebhookDispatcher(
        store,
        {
            rateLimitPerMinute: Number(config.webhooks.rateLimitPerMinute),
            deliveryTimeoutMs: Number(config.webhooks.deliveryTimeoutMs),
            blockPrivateIps: Boolean(config.webhooks.blockPrivateIps),
            encryptionKey,
            maxRetryHours: Number(config.webhooks.maxRetryHours),
        },
        workerId
    );
    const bridge = createWebhookEventBridge(store, dispatcher, nitroApp);

    const hourlyCleanup = setInterval(() => {
        const retentionHours = Math.max(1, Number(config.webhooks.logRetentionHours));
        const cutoff = Date.now() - retentionHours * ONE_HOUR_MS;
        void store.purgeExpiredLogs(cutoff);
    }, ONE_HOUR_MS);
    unrefInterval(hourlyCleanup);

    const reaper = setInterval(() => {
        void store.resetStaleInFlightDeliveries(STALE_IN_FLIGHT_REAPER_MS);
    }, PLUGIN_REAPER_INTERVAL_MS);
    unrefInterval(reaper);

    let stopped = false;
    const runtime: ActiveWebhookRuntime = {
        nitroApp,
        store,
        dispatcher,
        bridge,
        workerId,
        stop() {
            if (stopped) {
                return;
            }

            stopped = true;
            clearInterval(hourlyCleanup);
            clearInterval(reaper);
            bridge.stop();
            dispatcher.stop();

            if (getActiveWebhookRuntime() === runtime) {
                setActiveWebhookRuntime(null);
            }
        },
    };

    bridge.start();
    dispatcher.start();
    await store.resetStaleInFlightDeliveries(STALE_IN_FLIGHT_REAPER_MS);
    await dispatcher.claimAndProcess();

    return runtime;
}

export default defineNitroPlugin(async (nitroApp) => {
    stopActiveWebhookRuntime();

    const runtime = await startWebhookRuntime(nitroApp);
    if (!runtime) {
        return;
    }

    setActiveWebhookRuntime(runtime);
    nitroApp.hooks.hook('close', () => {
        runtime.stop();
    });
});
