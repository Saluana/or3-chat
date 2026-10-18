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
let activeInterval: ReturnType<typeof setInterval> | null = null;
let activeStartup: ReturnType<typeof setTimeout> | null = null;

export default defineNitroPlugin((nitroApp) => {
    if (activeInterval) clearInterval(activeInterval);
    if (activeStartup) clearTimeout(activeStartup);
    activeInterval = null;
    activeStartup = null;

    if (!isBackgroundStreamingEnabled()) return;
    const encryptionKey = getBackgroundJobEncryptionKey();
    if (encryptionKey.length < 32) {
        throw new Error(
            '[background-jobs] OR3_BACKGROUND_ENCRYPTION_KEY must contain at least 32 characters when background streaming is enabled'
        );
    }

    const workerId = randomUUID();
    let scanning = false;
    const reconcile = async () => {
        const { controller } = getShutdownRuntime();
        if (scanning || controller.phase() === 'draining' || controller.phase() === 'closed') return;
        scanning = true;
        try {
            const provider = await getJobProvider();
            if (controller.canStartWork()) await provider.cleanupExpired();
            // Pending delivery is existing work and must finish while preparing.
            // Pausing it along with new claims would make its own drain blocker
            // impossible to clear after a transient canonical-history failure.
            await reconcilePendingBackgroundHistory(
                provider,
                getJobConfig().maxConcurrentJobs
            );
            if (!controller.canStartWork()) return;
            await reconcileBackgroundJobs(
                {
                    provider,
                    encryptionKey,
                    execute: executeBackgroundJob,
                    workerId,
                },
                getJobConfig().maxConcurrentJobs
            );
        } catch (error) {
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
    const scan = () => { void getShutdownRuntime().controller.track(reconcile()); };
    activeStartup = setTimeout(scan, 1_000);
    if (typeof activeStartup.unref === 'function') activeStartup.unref();
    activeInterval = setInterval(scan, RECONCILE_INTERVAL_MS);
    if (typeof activeInterval.unref === 'function') activeInterval.unref();

    nitroApp.hooks.hook('close', () => {
        if (activeStartup) clearTimeout(activeStartup);
        if (activeInterval) clearInterval(activeInterval);
        activeStartup = null;
        activeInterval = null;
    });
});
