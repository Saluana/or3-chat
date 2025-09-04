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
    userScrolling: Ref<boolean>;
    /** Epoch ms when we were last within NEAR_BOTTOM_PX */
    lastBottomAt: Ref<number>;
    /** Forcibly disable sticky behavior until user explicitly sticks again */
    release: () => void;
}

export interface UseAutoScrollOptions {
    thresholdPx?: number;
    behavior?: ScrollBehavior;
    throttleMs?: number; // to avoid scroll thrash; default 50ms
    /**
     * Minimum upward scroll (px) while inside the bottom threshold that will
     * disengage sticky auto-scroll. Fixes the "end-of-stream jump" when user
     * scrolls a little bit up to read but still remains within thresholdPx.
     * Default 12px – small deliberate nudge.
     */
    disengageDeltaPx?: number;
}

export function useAutoScroll(
    container: Ref<HTMLElement | null>,
    opts: UseAutoScrollOptions = {}
): AutoScrollApi {
    const {
        thresholdPx = 64,
        behavior = 'auto',
        throttleMs = 50,
        disengageDeltaPx = 12,
    } = opts;
    const atBottom = ref(true);
    // Internal sticky intent (cleared when user scrolls away from bottom)
    let stick = true;
    // User actively interacting with scroll (wheel/touch) recently
    const userScrolling = ref(false);
    // Timestamp (ms) last time viewport was near the very bottom
    const lastBottomAt = ref(Date.now());
    const NEAR_BOTTOM_PX = 24; // threshold for considering user "at bottom" for snap eligibility window
    const USER_SCROLL_INACTIVE_TIMEOUT = 800; // ms
    let userScrollTimer: any = null;
    // Track previous scrollTop to detect upward user scroll even while still
    // considered "at bottom" by threshold heuristics.
    let lastScrollTop = 0;

    function compute() {
        const el = container.value;
        if (!el) return;
        const currentTop = el.scrollTop;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const newAtBottom = dist <= thresholdPx;
        // Detect deliberate upward scroll (negative delta beyond disengageDeltaPx)
        // while still inside bottom threshold window. This means user intends
        // to read earlier content; release sticky so finalize delta won't snap.
        if (currentTop < lastScrollTop - disengageDeltaPx) {
            stick = false;
        }
        if (!newAtBottom) stick = false;
        atBottom.value = newAtBottom;
        if (dist <= NEAR_BOTTOM_PX) {
            lastBottomAt.value = Date.now();
        }
        lastScrollTop = currentTop;
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
        lastBottomAt.value = Date.now();
    }

    function stickBottom() {
        stick = true;
        scrollToBottom({ smooth: true });
    }

    function onContentIncrease() {
        // Safe auto-scroll gate: only snap if user recently at bottom and not scrolling.
        const now = Date.now();
        const recentlyAtBottom = now - lastBottomAt.value < 1200; // 1.2s window
        if (stick && !userScrolling.value && recentlyAtBottom) {
            scrollToBottom({ smooth: false });
        } else {
            compute();
        }
    }

    let cleanup: (() => void) | null = null;
    function markUserScroll() {
        userScrolling.value = true;
        if (userScrollTimer) clearTimeout(userScrollTimer);
        userScrollTimer = setTimeout(() => {
            userScrolling.value = false;
        }, USER_SCROLL_INACTIVE_TIMEOUT);
    }

    onMounted(() => {
        compute();
        cleanup = useEventListener(container, 'scroll', throttledCompute, {
            passive: true,
        });
        // Interaction listeners (wheel & touchstart) to gate auto-scroll
        useEventListener(
            container,
            'wheel',
            () => {
                markUserScroll();
            },
            { passive: true }
        );
        useEventListener(
            container,
            'touchstart',
            () => {
                markUserScroll();
            },
            { passive: true }
        );
        useEventListener(
            container,
            'touchmove',
            () => {
                markUserScroll();
            },
            { passive: true }
        );
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
        userScrolling,
        lastBottomAt,
        release: () => {
            stick = false;
        },
    };
}
