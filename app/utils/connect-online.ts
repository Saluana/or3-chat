export type ConnectSetupStage = 'approved' | 'installing' | 'online';

export interface ConnectSetupStatus {
    readonly stage: ConnectSetupStage;
}

export type ConnectSetupWaitResult = 'online' | 'timed_out' | 'cancelled';

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(true);
        }, delayMs);
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export async function waitForConnectOnline(input: {
    readonly probe: () => Promise<ConnectSetupStatus>;
    readonly onStage: (stage: ConnectSetupStage) => void;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly now?: () => number;
    readonly wait?: (delayMs: number, signal?: AbortSignal) => Promise<boolean>;
}): Promise<ConnectSetupWaitResult> {
    const timeoutMs = Math.max(1, input.timeoutMs ?? 120_000);
    const initialDelayMs = Math.max(1, input.initialDelayMs ?? 1_000);
    const maxDelayMs = Math.max(initialDelayMs, input.maxDelayMs ?? 5_000);
    const now = input.now ?? Date.now;
    const wait = input.wait ?? abortableDelay;
    const startedAt = now();
    let delayMs = 0;
    let lastStage: ConnectSetupStage | null = null;

    while (!input.signal?.aborted) {
        const elapsed = now() - startedAt;
        if (elapsed >= timeoutMs) return 'timed_out';
        if (delayMs > 0) {
            const waited = await wait(
                Math.min(delayMs, timeoutMs - elapsed),
                input.signal
            );
            if (!waited || input.signal?.aborted) return 'cancelled';
            if (now() - startedAt >= timeoutMs) return 'timed_out';
        }
        try {
            const status = await input.probe();
            if (status.stage !== lastStage) {
                lastStage = status.stage;
                input.onStage(status.stage);
            }
            if (status.stage === 'online') return 'online';
        } catch {
            // Tunnel and service startup failures are transient during setup.
        }
        delayMs =
            delayMs === 0
                ? initialDelayMs
                : Math.min(delayMs * 2, maxDelayMs);
    }
    return 'cancelled';
}
