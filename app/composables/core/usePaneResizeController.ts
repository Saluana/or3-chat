import { ref, type Ref } from 'vue';
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
    let previousX = 0;
    let pendingFrame: number | null = null;
    let pendingDelta = 0;

    const recalculate = useDebounceFn((width: number) => {
        if (width > 0 && options.paneCount() > 1) {
            options.recalculateWidths(width);
        }
    }, 100);
    if (import.meta.client) {
        useResizeObserver(paneContainerRef, (entries) => {
            const entry = entries[0];
            if (entry) recalculate(entry.contentRect.width);
        });
    }

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
        if (options.isMobile.value) return;
        (event.target as Element).setPointerCapture(event.pointerId);
        paneIndex = nextPaneIndex;
        previousX = event.clientX;
        pendingDelta = 0;
        isResizing.value = true;
    }

    function onPaneResizeMove(event: PointerEvent): void {
        if (paneIndex === null) return;
        pendingDelta += event.clientX - previousX;
        previousX = event.clientX;
        if (pendingFrame !== null) return;
        pendingFrame = requestAnimationFrame(() => {
            flushPendingResize();
            pendingFrame = null;
        });
    }

    function onPaneResizeEnd(): void {
        if (pendingFrame !== null) {
            cancelAnimationFrame(pendingFrame);
            pendingFrame = null;
        }
        flushPendingResize();
        paneIndex = null;
        isResizing.value = false;
        options.persist();
    }

    useEventListener(
        () => (isResizing.value ? window : null),
        'pointermove',
        onPaneResizeMove
    );
    useEventListener(
        () => (isResizing.value ? window : null),
        'pointerup',
        onPaneResizeEnd
    );

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
