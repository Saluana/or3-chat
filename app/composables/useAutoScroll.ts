/**
 * useAutoScroll
 * Scroll position tracking + conditional auto-stick logic.
 * Requirements: 3.3 (Auto-scroll), 3.11 (VueUse adoption), 4 (Docs)
 *
 * Usage:
 * const container = ref<HTMLElement|null>(null)
 * const auto = useAutoScroll(container, { thresholdPx: 64 })
 * auto.onContentIncrease() // call after DOM height increases
 */
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { useEventListener, useThrottleFn } from '@vueuse/core';

export interface AutoScrollApi {
    atBottom: Ref<boolean>;
    stickBottom: () => void;
    scrollToBottom: (opts?: { smooth?: boolean }) => void;
    onContentIncrease: () => void;
    detach: () => void;
    recompute: () => void; // explicit recompute (useful for tests/manual)
}

export interface UseAutoScrollOptions {
    thresholdPx?: number;
    behavior?: ScrollBehavior;
    throttleMs?: number; // to avoid scroll thrash; default 50ms
}

export function useAutoScroll(
    container: Ref<HTMLElement | null>,
    opts: UseAutoScrollOptions = {}
): AutoScrollApi {
    const { thresholdPx = 64, behavior = 'auto', throttleMs = 50 } = opts;
    const atBottom = ref(true);
    let stick = true;

    function compute() {
        const el = container.value;
        if (!el) return;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const newAtBottom = dist <= thresholdPx;
        if (!newAtBottom) stick = false;
        atBottom.value = newAtBottom;
    }

    const throttledCompute = useThrottleFn(compute, throttleMs);

    function scrollToBottom({ smooth }: { smooth?: boolean } = {}) {
        const el = container.value;
        if (!el) return;
        el.scrollTo({
            top: el.scrollHeight,
            behavior: smooth ? 'smooth' : behavior,
        });
        stick = true;
        atBottom.value = true;
    }

    function stickBottom() {
        stick = true;
        scrollToBottom({ smooth: true });
    }

    function onContentIncrease() {
        // Previously this deferred with nextTick, which combined with callers
        // already awaiting nextTick created a double frame delay causing jank.
        if (stick) scrollToBottom({ smooth: false });
        else compute();
    }

    let cleanup: (() => void) | null = null;
    onMounted(() => {
        compute();
        cleanup = useEventListener(container, 'scroll', throttledCompute, {
            passive: true,
        });
    });
    function detach() {
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
    }
    onBeforeUnmount(detach);

    return {
        atBottom,
        stickBottom,
        scrollToBottom,
        onContentIncrease,
        detach,
        recompute: compute,
    };
}
