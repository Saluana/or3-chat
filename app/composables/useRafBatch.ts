/**
 * useRafBatch
 * Coalesce multiple synchronous invalidations into a single rAF callback.
 * Returns a stable trigger function. Subsequent calls within the same frame
 * are ignored. If called from within a rAF already scheduled, execution is
 * still deferred to next frame to allow DOM to settle (post Vue flush).
 */
import { onBeforeUnmount } from 'vue';

export function useRafBatch(fn: () => void) {
    let scheduled = false;
    let cancelled = false;
    let frame = -1;
    function run() {
        if (scheduled || cancelled) return;
        scheduled = true;
        frame = requestAnimationFrame(() => {
            scheduled = false;
            if (cancelled) return;
            try {
                fn();
            } catch (e) {
                // eslint-disable-next-line no-console
                if (import.meta.dev)
                    console.error('[useRafBatch] callback error', e);
            }
        });
    }
    onBeforeUnmount(() => {
        cancelled = true;
        if (frame !== -1) cancelAnimationFrame(frame);
    });
    return run;
}

export default useRafBatch;
