import { randomUUID } from 'node:crypto';
import { defineNitroPlugin } from 'nitropack/runtime';
import {
    getBackgroundJobEncryptionKey,
    getJobConfig,
    getJobProvider,
    isBackgroundStreamingEnabled,
} from '../utils/background-jobs/store';
import { reconcileBackgroundJobs } from '../utils/background-jobs/lifecycle';
import { executeBackgroundJob } from '../utils/background-jobs/stream-handler';
import { reconcilePendingBackgroundHistory } from '../utils/background-jobs/history';
import { getShutdownRuntime } from '../utils/shutdown/runtime';

const RECONCILE_INTERVAL_MS = 5_000;
const MAX_IDLE_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60_000;
let stopActive: (() => void) | undefined;

export default defineNitroPlugin((nitroApp) => {
    stopActive?.();
    let activeInterval: ReturnType<typeof setTimeout> | undefined;
    let activeStartup: ReturnType<typeof setTimeout> | undefined;
    if (!isBackgroundStreamingEnabled()) return;
    const encryptionKey = getBackgroundJobEncryptionKey();
    if (encryptionKey.length < 32) {
        throw new Error(
            '[background-jobs] OR3_BACKGROUND_ENCRYPTION_KEY must contain at least 32 characters when background streaming is enabled'
        );
    }

    const workerId = randomUUID();
    let scanning = false;
    let stopped = false;
    let delay = RECONCILE_INTERVAL_MS;
    let nextCleanupAt = 0;
    const reconcile = async () => {
        const { controller } = getShutdownRuntime();
        if (scanning || controller.phase() === 'draining' || controller.phase() === 'closed') return;
        scanning = true;
        try {
            const provider = await getJobProvider();
            if (controller.canStartWork() && Date.now() >= nextCleanupAt) {
                await provider.cleanupExpired();
                nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS;
            }
            // Pending delivery is existing work and must finish while preparing.
            // Pausing it along with new claims would make its own drain blocker
            // impossible to clear after a transient canonical-history failure.
            const delivered = await reconcilePendingBackgroundHistory(
                provider,
                getJobConfig().maxConcurrentJobs
            );
            if (!controller.canStartWork()) return;
            const claimed = await reconcileBackgroundJobs(
                {
                    provider,
                    encryptionKey,
                    execute: executeBackgroundJob,
                    workerId,
                },
                getJobConfig().maxConcurrentJobs
            );
            delay = delivered || claimed ? RECONCILE_INTERVAL_MS
                : Math.min(delay * 2, MAX_IDLE_INTERVAL_MS);
        } catch (error) {
            delay = RECONCILE_INTERVAL_MS;
            console.warn(
                '[background-jobs] Recovery scan failed:',
                error instanceof Error ? error.message : 'Unknown error'
            );
        } finally {
            scanning = false;
        }
    };

    // Provider modules register during Nitro startup; defer the first scan so
    // provider selection cannot be cached before registration completes.
    const scan = async () => {
        await getShutdownRuntime().controller.track(reconcile());
        if (stopped) return;
        activeInterval = setTimeout(() => { void scan(); }, delay);
        activeInterval.unref();
    };
    activeStartup = setTimeout(() => { void scan(); }, 1_000);
    activeStartup.unref();

    const stop = () => {
        stopped = true;
        clearTimeout(activeStartup);
        if (activeInterval) clearTimeout(activeInterval);
        if (stopActive === stop) stopActive = undefined;
    };
    stopActive = stop;
    nitroApp.hooks.hook('close', stop);
});
