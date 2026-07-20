/** Small state machine used by stream consumers to bound durable writes. */
export function createStreamWriteCoalescer(options?: {
    maxEvents?: number;
    maxBytes?: number;
    maxDelayMs?: number;
    now?: () => number;
}) {
    const maxEvents = options?.maxEvents ?? 50;
    const maxBytes = options?.maxBytes ?? 16 * 1024;
    const maxDelayMs = options?.maxDelayMs ?? 500;
    const now = options?.now ?? Date.now;
    let dirtyEvents = 0;
    let dirtyBytes = 0;
    let lastFlushAt = now();

    return {
        markDirty(bytes = 0) {
            dirtyEvents += 1;
            dirtyBytes += Math.max(0, bytes);
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
            dirtyEvents = 0;
            dirtyBytes = 0;
            lastFlushAt = now();
        },
    };
}
