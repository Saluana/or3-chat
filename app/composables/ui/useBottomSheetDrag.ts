import { onScopeDispose, ref, watch, type Ref } from 'vue';

/** Shared handle gestures for bottom sheets; content scrolling stays native. */
export function useBottomSheetDrag(
    open: Readonly<Ref<boolean>>,
    dismiss: () => void,
    onStart?: () => void
) {
    const offset = ref(0);
    const isDragging = ref(false);
    let drag: {
        handle: HTMLElement;
        pointerId: number;
        startY: number;
        startOffset: number;
        lastY: number;
        lastAt: number;
        velocity: number;
    } | undefined;

    function release(): void {
        const previous = drag;
        drag = undefined;
        isDragging.value = false;
        if (previous?.handle.hasPointerCapture(previous.pointerId)) {
            previous.handle.releasePointerCapture(previous.pointerId);
        }
    }

    function reset(): void {
        release();
        offset.value = 0;
    }

    function onPointerdown(event: PointerEvent): void {
        if (!event.isPrimary || event.button !== 0 || !open.value || drag) return;
        if (event.target instanceof Element &&
            event.target.closest('button, a, input, textarea, select')) return;
        event.preventDefault();
        onStart?.();
        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);
        drag = {
            handle, pointerId: event.pointerId, startY: event.clientY,
            startOffset: offset.value, lastY: event.clientY,
            lastAt: event.timeStamp, velocity: 0,
        };
        isDragging.value = true;
    }

    function onPointermove(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        offset.value = Math.max(0, drag.startOffset + event.clientY - drag.startY);
        const elapsed = event.timeStamp - drag.lastAt;
        if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
        drag.lastY = event.clientY;
        drag.lastAt = event.timeStamp;
    }

    function onPointerup(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointerId) return;
        // Match the mobile navigation sheet's distance and flick thresholds.
        // Holding still before release must not count as a flick.
        const shouldDismiss = offset.value >= 110 || (offset.value > 0 &&
            event.timeStamp - drag.lastAt < 80 && drag.velocity >= 0.55);
        release();
        if (shouldDismiss) dismiss();
        else offset.value = 0;
    }

    function onPointercancel(event: PointerEvent): void {
        if (drag?.pointerId === event.pointerId) reset();
    }

    watch(open, value => {
        if (value) reset();
        else release();
    }, { flush: 'sync' });
    onScopeDispose(release);

    return {
        offset, isDragging, reset,
        handleProps: {
            style: { touchAction: 'none' },
            onPointerdown, onPointermove, onPointerup, onPointercancel,
            onLostpointercapture: onPointercancel,
        },
    };
}
