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
import { createShutdownController } from '../utils/shutdown/controller';

const SHUTDOWN_TIMEOUT_MS = Number(process.env.OR3_SHUTDOWN_TIMEOUT_MS) || 15_000;

/**
 * Graceful shutdown handler.
 * Logs shutdown signal and allows time for in-flight requests to complete.
 */
async function handleShutdown(signal: string): Promise<void> {
    await controller.startShutdown(signal);
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

const controller = createShutdownController(
    {
        shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
        getBackgroundJobCount: getActiveBackgroundJobCount,
        exitProcess: (code) => process.exit(code),
    }
);

export default defineNitroPlugin((nitro) => {
    nitro.hooks.hook('request', (event) => {
        const path = event.path || event.node.req.url || '/';
        const accepted = controller.beginRequest(path);

        if (!accepted) {
            event.node.res.statusCode = 503;
            event.node.res.setHeader('content-type', 'application/json; charset=utf-8');
            event.node.res.setHeader('retry-after', '5');
            event.node.res.end(
                JSON.stringify({
                    statusCode: 503,
                    statusMessage: 'Service unavailable: server shutting down',
                })
            );
            return;
        }

        let completed = false;
        const complete = () => {
            if (completed) return;
            completed = true;
            controller.endRequest();
        };

        event.node.res.once('finish', complete);
        event.node.res.once('close', complete);
    });

    // Register shutdown handlers
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    console.info('[shutdown] Graceful shutdown handlers registered');
});
