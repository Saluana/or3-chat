/** Small state machine used by stream consumers to bound durable writes. */
export function createStreamWriteCoalescer(options?: {
    maxEvents?: number;
    maxBytes?: number;
    maxDelayMs?: number;
    now?: () => number;
    writeProgress?: () => Promise<void>;
}) {
    const maxEvents = options?.maxEvents ?? 50;
    const maxBytes = options?.maxBytes ?? 16 * 1024;
    const maxDelayMs = options?.maxDelayMs ?? 500;
    const now = options?.now ?? Date.now;
    const writeProgress = options?.writeProgress;
    let dirtyEvents = 0;
    let dirtyBytes = 0;
    let lastFlushAt = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: { completed: Promise<void>; background: boolean } | undefined;
    let backgroundFailure: { error: unknown } | undefined;
    let disposed = false;
    const isDisposed = (): boolean => disposed;
    let failedWrite = false;
    let unloadGuardBound = false;

    function guardFailedUnload(event: BeforeUnloadEvent) {
        if (!failedWrite || disposed || (!inFlight && dirtyEvents === 0)) return;
        event.preventDefault();
        event.returnValue = '';
    }
    function updateUnloadGuard() {
        if (typeof window === 'undefined') return;
        const needed = failedWrite && !disposed;
        if (needed && !unloadGuardBound) window.addEventListener('beforeunload', guardFailedUnload);
        else if (!needed && unloadGuardBound) window.removeEventListener('beforeunload', guardFailedUnload);
        unloadGuardBound = needed;
    }

    function clearTimer() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    }
    function scheduleIdleFlush() {
        if (isDisposed() || timer !== undefined || inFlight || backgroundFailure || dirtyEvents === 0 || !writeProgress)
            return;
        timer = setTimeout(() => {
            timer = undefined;
            void startWrite(writeProgress, true).catch(() => {});
        }, Math.max(0, maxDelayMs - (now() - lastFlushAt)));
    }
    function resetDirty() {
        clearTimer();
        dirtyEvents = 0;
        dirtyBytes = 0;
        lastFlushAt = now();
    }
    function shouldFlush() {
        return dirtyEvents > 0 && (
            dirtyEvents >= maxEvents ||
            dirtyBytes >= maxBytes ||
            now() - lastFlushAt >= maxDelayMs
        );
    }

    function startWrite(write: () => Promise<void>, background: boolean) {
        // Deltas that arrive during the write remain dirty for the next snapshot.
        resetDirty();
        const completed = Promise.resolve().then(write).then(
            () => {
                backgroundFailure = undefined;
                failedWrite = failedWrite && dirtyEvents > 0;
                updateUnloadGuard();
            },
            (error: unknown) => {
                dirtyEvents += 1;
                lastFlushAt = now();
                failedWrite = true;
                if (background) backgroundFailure = { error };
                updateUnloadGuard();
                throw error;
            }
        ).finally(() => {
            inFlight = undefined;
            scheduleIdleFlush();
        });
        inFlight = { completed, background };
        return completed;
    }

    return {
        markDirty(bytes = 0) {
            if (isDisposed()) return;
            dirtyEvents += 1;
            dirtyBytes += Math.max(0, bytes);
            scheduleIdleFlush();
        },
        scheduleFlush(): Promise<void> | undefined {
            if (isDisposed()) return;
            if (!writeProgress) throw new Error('Stream progress writer is not configured.');
            if (backgroundFailure) throw backgroundFailure.error;
            if (!inFlight && shouldFlush()) {
                // Keep consuming while one snapshot saves. Its callback reads
                // the newest state when it starts; no per-token jobs are queued.
                void startWrite(writeProgress, true).catch(() => {});
            }
            if (inFlight && (dirtyEvents >= maxEvents * 4 || dirtyBytes >= maxBytes * 4)) {
                // Bound the suffix accepted during a slow write. Rejection
                // reaches the consumer before it reads more provider events.
                return inFlight.completed.then(() => {
                    if (isDisposed() || dirtyEvents === 0) return;
                    return inFlight?.completed ?? startWrite(writeProgress, true);
                });
            }
        },
        hasDirty() {
            return dirtyEvents > 0;
        },
        flushed() {
            resetDirty();
            backgroundFailure = undefined;
            failedWrite = false;
            updateUnloadGuard();
        },
        async flush(write = writeProgress) {
            if (isDisposed()) return;
            if (!write) throw new Error('Stream progress writer is not configured.');
            // Another waiting caller may prepare the next snapshot first. Join
            // that write too. Retry a failed background write with the latest
            // snapshot. A failed explicit flush is already the durability barrier.
            while (inFlight) {
                const { completed, background } = inFlight;
                try {
                    await completed;
                } catch (error) {
                    if (!background) throw error;
                }
                if (isDisposed()) return;
            }
            if (dirtyEvents > 0) await startWrite(write, false);
        },
        async dispose() {
            disposed = true;
            clearTimer();
            updateUnloadGuard();
            // Drain a prepared progress write before the caller finalizes the
            // row, so an older snapshot cannot land after its terminal state.
            await inFlight?.completed.catch(() => {});
        },
    };
}
