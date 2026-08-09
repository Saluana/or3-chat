import { nextTick, ref, watch, type Ref } from 'vue';
import {
    useDebounceFn,
    useEventListener,
    useResizeObserver,
} from '@vueuse/core';

export function usePaneResizeController(options: {
    paneCount: () => number;
    paneWidths: Ref<number[]>;
    isMobile: Ref<boolean>;
    minPaneWidth: number;
    recalculateWidths: (width: number) => void;
    resize: (paneIndex: number, deltaX: number, persist: boolean) => void;
    persist: () => void;
}) {
    const paneContainerRef = ref<HTMLElement | null>(null);
    const isResizing = ref(false);
    let paneIndex: number | null = null;
    let pointerId: number | null = null;
    let pointerCaptureTarget: Element | null = null;
    let previousX = 0;
    let pendingFrame: number | null = null;
    let pendingDelta = 0;

    const recalculate = useDebounceFn((width: number) => {
        if (width > 0) {
            options.recalculateWidths(width);
        }
    }, 100);
    if (import.meta.client) {
        useResizeObserver(paneContainerRef, (entries) => {
            const entry = entries[0];
            if (entry) recalculate(entry.contentRect.width);
        });
    }

    // Adding or closing a pane does not resize the container, so its resize
    // observer will not fire. Reconcile explicitly after the pane DOM updates.
    watch(
        options.paneCount,
        async (paneCount, previousPaneCount) => {
            if (paneCount === previousPaneCount) return;
            await nextTick();
            const containerWidth = paneContainerRef.value?.clientWidth ?? 0;
            if (containerWidth > 0) {
                options.recalculateWidths(containerWidth);
            }
        },
        { flush: 'post' }
    );

    function flushPendingResize(): void {
        if (paneIndex !== null && pendingDelta !== 0) {
            options.resize(paneIndex, pendingDelta, false);
            pendingDelta = 0;
        }
    }

    function onPaneResizeStart(
        event: PointerEvent,
        nextPaneIndex: number
    ): void {
        if (
            options.isMobile.value ||
            event.button !== 0 ||
            event.isPrimary === false
        ) {
            return;
        }
        const captureTarget = event.currentTarget;
        if (
            captureTarget instanceof Element &&
            typeof captureTarget.setPointerCapture === 'function'
        ) {
            captureTarget.setPointerCapture(event.pointerId);
            pointerCaptureTarget = captureTarget;
        } else {
            pointerCaptureTarget = null;
        }
        paneIndex = nextPaneIndex;
        pointerId = event.pointerId;
        previousX = event.clientX;
        pendingDelta = 0;
        isResizing.value = true;
    }

    function onPaneResizeMove(event: PointerEvent): void {
        if (paneIndex === null || pointerId !== event.pointerId) return;
        pendingDelta += event.clientX - previousX;
        previousX = event.clientX;
        if (pendingFrame !== null) return;
        pendingFrame = requestAnimationFrame(() => {
            flushPendingResize();
            pendingFrame = null;
        });
    }

    function onPaneResizeEnd(event: PointerEvent): void {
        if (pointerId !== event.pointerId) return;
        if (pendingFrame !== null) {
            cancelAnimationFrame(pendingFrame);
            pendingFrame = null;
        }
        flushPendingResize();
        if (
            typeof pointerCaptureTarget?.hasPointerCapture === 'function' &&
            typeof pointerCaptureTarget.releasePointerCapture === 'function' &&
            pointerCaptureTarget.hasPointerCapture(pointerId)
        ) {
            pointerCaptureTarget.releasePointerCapture(pointerId);
        }
        pointerCaptureTarget = null;
        pointerId = null;
        paneIndex = null;
        isResizing.value = false;
        options.persist();
    }

    // Keep the listeners stable for the composable's lifetime. Registering
    // only after `isResizing` changes can miss the terminating pointer event
    // in fast drags; the handlers themselves are no-ops unless a matching
    // pointer owns an active resize.
    if (typeof window !== 'undefined') {
        useEventListener(window, 'pointermove', onPaneResizeMove);
        useEventListener(window, 'pointerup', onPaneResizeEnd);
        useEventListener(window, 'pointercancel', onPaneResizeEnd);
    }

    function onPaneResizeKeydown(
        event: KeyboardEvent,
        targetPaneIndex: number
    ): void {
        if (options.isMobile.value) return;
        const currentWidth = options.paneWidths.value[targetPaneIndex];
        const nextWidth = options.paneWidths.value[targetPaneIndex + 1];
        const step = event.shiftKey ? 32 : 16;
        let delta = 0;

        if (event.key === 'ArrowLeft') delta = -step;
        else if (event.key === 'ArrowRight') delta = step;
        else if (event.key === 'Home' && currentWidth !== undefined) {
            delta = options.minPaneWidth - currentWidth;
        } else if (
            event.key === 'End' &&
            currentWidth !== undefined &&
            nextWidth !== undefined
        ) {
            delta = nextWidth - options.minPaneWidth;
        } else {
            return;
        }
        event.preventDefault();
        if (delta !== 0) options.resize(targetPaneIndex, delta, true);
    }

    return {
        paneContainerRef,
        isResizing,
        onPaneResizeStart,
        onPaneResizeKeydown,
    };
}
