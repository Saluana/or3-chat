type ShutdownController = {
    beginRequest(path: string): boolean;
    endRequest(): void;
    isShuttingDown(): boolean;
    getInFlightCount(): number;
    startShutdown(signal: string): Promise<void>;
};

type BackgroundJobCountGetter = () => Promise<number>;

type ShutdownControllerOptions = {
    shutdownTimeoutMs: number;
    drainPollMs?: number;
    getBackgroundJobCount: BackgroundJobCountGetter;
    exitProcess: (code: number) => never;
};

function canServeDuringShutdown(path: string): boolean {
    return path === '/api/health' || path === '/api/healthz';
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createShutdownController(
    options: ShutdownControllerOptions
): ShutdownController {
    const drainPollMs = options.drainPollMs ?? 100;
    let shuttingDown = false;
    let inFlightRequests = 0;
    let shutdownPromise: Promise<void> | null = null;

    async function waitForDrain(deadline: number): Promise<void> {
        while (inFlightRequests > 0 && Date.now() < deadline) {
            await wait(drainPollMs);
        }
    }

    return {
        beginRequest(path: string): boolean {
            if (shuttingDown && !canServeDuringShutdown(path)) {
                return false;
            }
            inFlightRequests += 1;
            return true;
        },

        endRequest(): void {
            if (inFlightRequests > 0) {
                inFlightRequests -= 1;
            }
        },

        isShuttingDown(): boolean {
            return shuttingDown;
        },

        getInFlightCount(): number {
            return inFlightRequests;
        },

        async startShutdown(signal: string): Promise<void> {
            if (shutdownPromise) {
                console.warn(`[shutdown] Already shutting down, ignoring ${signal}`);
                return shutdownPromise;
            }

            shuttingDown = true;
            shutdownPromise = (async () => {
                console.info(`[shutdown] Received ${signal}, initiating graceful shutdown...`);

                let exitCode = 0;

                try {
                    const activeJobs = await options.getBackgroundJobCount();
                    if (activeJobs > 0) {
                        console.warn(`[shutdown] ${activeJobs} background jobs are still in-flight`);
                    }

                    const deadline = Date.now() + options.shutdownTimeoutMs;
                    console.info(
                        `[shutdown] Draining in-flight requests (count=${inFlightRequests}) for up to ${options.shutdownTimeoutMs}ms...`
                    );
                    await waitForDrain(deadline);

                    const remaining = inFlightRequests;
                    if (remaining > 0) {
                        console.warn(
                            `[shutdown] Drain timeout reached with ${remaining} in-flight request(s) remaining`
                        );
                    }

                    console.info('[shutdown] Shutdown complete');
                } catch (error) {
                    console.error('[shutdown] Error during shutdown:', error);
                    exitCode = 1;
                }

                options.exitProcess(exitCode);
            })();

            return shutdownPromise;
        },
    };
}
