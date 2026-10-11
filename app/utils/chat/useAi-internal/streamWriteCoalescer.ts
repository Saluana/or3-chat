/** Small state machine used by stream consumers to bound durable writes. */
export function createStreamWriteCoalescer(options?: {
    maxEvents?: number;
    maxBytes?: number;
    maxDelayMs?: number;
    now?: () => number;
    onIdleFlush?: () => Promise<void>;
}) {
    const maxEvents = options?.maxEvents ?? 50;
    const maxBytes = options?.maxBytes ?? 16 * 1024;
    const maxDelayMs = options?.maxDelayMs ?? 500;
    const now = options?.now ?? Date.now;
    const onIdleFlush = options?.onIdleFlush;
    let dirtyEvents = 0;
    let dirtyBytes = 0;
    let lastFlushAt = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | undefined;
    let disposed = false;
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
        if (disposed || timer !== undefined || inFlight || dirtyEvents === 0 || !onIdleFlush)
            return;
        timer = setTimeout(() => {
            timer = undefined;
            // flush() retains dirty progress on failure and schedules a retry.
            // Terminal persistence still reports an unrecoverable write error.
            void onIdleFlush().catch(() => {});
        }, Math.max(0, maxDelayMs - (now() - lastFlushAt)));
    }
    function resetDirty() {
        clearTimer();
        dirtyEvents = 0;
        dirtyBytes = 0;
        lastFlushAt = now();
    }

    return {
        markDirty(bytes = 0) {
            dirtyEvents += 1;
            dirtyBytes += Math.max(0, bytes);
            scheduleIdleFlush();
        },
        shouldFlush() {
            return dirtyEvents > 0 && (
                dirtyEvents >= maxEvents ||
                dirtyBytes >= maxBytes ||
                now() - lastFlushAt >= maxDelayMs
            );
        },
        hasDirty() {
            return dirtyEvents > 0;
        },
        flushed() {
            resetDirty();
            failedWrite = false;
            updateUnloadGuard();
        },
        async flush(write: () => Promise<void>) {
            if (inFlight) await inFlight;
            if (dirtyEvents === 0) return;
            // Acknowledge only the snapshot entering this write. Deltas that
            // arrive while it awaits storage remain dirty for the next write.
            resetDirty();
            const pending = Promise.resolve().then(write);
            inFlight = pending;
            try {
                await pending;
                failedWrite = false;
                updateUnloadGuard();
            } catch (error) {
                dirtyEvents += 1;
                lastFlushAt = now();
                // Keep the displayed response available while storage retries.
                // Starting another write is not acknowledgement of this one.
                failedWrite = true;
                updateUnloadGuard();
                throw error;
            } finally {
                inFlight = undefined;
                scheduleIdleFlush();
            }
        },
        async dispose() {
            disposed = true;
            clearTimer();
            updateUnloadGuard();
            // Drain a prepared progress write before the caller finalizes the
            // row, so an older snapshot cannot land after its terminal state.
            await inFlight?.catch(() => {});
        },
    };
}
