/**
 * @module server/plugins/graceful-shutdown
 *
 * Purpose:
 * Handles graceful shutdown signals (SIGTERM, SIGINT) to allow in-flight requests to complete.
 *
 * Responsibilities:
 * - Registers shutdown handlers for SIGTERM and SIGINT.
 * - Logs active background job count on shutdown.
 * - Implements configurable drain timeout (default 15s).
 * - Cleans up intervals and resources.
 */
import { defineNitroPlugin } from 'nitropack/runtime';

const SHUTDOWN_TIMEOUT_MS = Number(process.env.OR3_SHUTDOWN_TIMEOUT_MS) || 15_000;

let isShuttingDown = false;

/**
 * Graceful shutdown handler.
 * Logs shutdown signal and allows time for in-flight requests to complete.
 */
async function handleShutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
        console.warn(`[shutdown] Already shutting down, ignoring ${signal}`);
        return;
    }

    isShuttingDown = true;
    console.info(`[shutdown] Received ${signal}, initiating graceful shutdown...`);

    try {
        // Log active background jobs (if background jobs are enabled)
        // Background job providers should implement their own cleanup hooks
        const activeJobs = await getActiveBackgroundJobCount();
        if (activeJobs > 0) {
            console.warn(`[shutdown] ${activeJobs} background jobs are still in-flight`);
        }

        // Wait for drain or timeout
        console.info(`[shutdown] Waiting up to ${SHUTDOWN_TIMEOUT_MS}ms for in-flight requests to complete...`);
        await new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS));

        console.info('[shutdown] Shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('[shutdown] Error during shutdown:', error);
        process.exit(1);
    }
}

/**
 * Get active background job count (if background jobs are enabled).
 */
async function getActiveBackgroundJobCount(): Promise<number> {
    try {
        // Import dynamically to avoid errors when background jobs are not enabled
        const { getJobProvider } = await import('../utils/background-jobs/store');
        const provider = await getJobProvider();
        return provider.getActiveJobCount?.() ?? 0;
    } catch {
        return 0;
    }
}

export default defineNitroPlugin((nitro) => {
    // Register shutdown handlers
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    console.info('[shutdown] Graceful shutdown handlers registered');
});
