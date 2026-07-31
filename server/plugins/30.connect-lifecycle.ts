import { defineNitroPlugin } from 'nitropack/runtime';
import { useRuntimeConfig } from '#imports';
import { reconcileDueConnectEnvironments } from '../connect/lifecycle';

const RECONCILE_INTERVAL_MS = 30_000;
let activeInterval: ReturnType<typeof setInterval> | null = null;
let activeStartup: ReturnType<typeof setTimeout> | null = null;

export default defineNitroPlugin((nitroApp) => {
    if (activeInterval) clearInterval(activeInterval);
    if (activeStartup) clearTimeout(activeStartup);
    activeInterval = null;
    activeStartup = null;

    const runtime = useRuntimeConfig() as {
        connect?: {
            enabled?: boolean;
            encryptionKey?: string;
        };
    };
    const encryptionKey = runtime.connect?.encryptionKey?.trim() ?? '';
    if (runtime.connect?.enabled !== true || encryptionKey.length < 32) {
        return;
    }

    let running = false;
    const reconcile = async () => {
        if (running) return;
        running = true;
        try {
            await reconcileDueConnectEnvironments({ encryptionKey });
        } catch (error) {
            console.warn(
                '[connect:lifecycle] Could not scan lifecycle work:',
                error instanceof Error ? error.message : 'Unknown error'
            );
        } finally {
            running = false;
        }
    };

    // Give provider plugins time to register before the first scan.
    activeStartup = setTimeout(() => void reconcile(), 1_000);
    if (typeof activeStartup.unref === 'function') activeStartup.unref();
    activeInterval = setInterval(
        () => void reconcile(),
        RECONCILE_INTERVAL_MS
    );
    if (typeof activeInterval.unref === 'function') activeInterval.unref();

    nitroApp.hooks.hook('close', () => {
        if (activeStartup) clearTimeout(activeStartup);
        if (activeInterval) clearInterval(activeInterval);
        activeStartup = null;
        activeInterval = null;
    });
});
