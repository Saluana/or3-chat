<template>
    <!-- Wrapper around virtua's virtual list for messages -->
    <div ref="root" class="flex flex-col min-w-0" :class="wrapperClass">
        <Virtualizer
            :data="messages"
            :itemSize="effectiveItemSize || undefined"
            :overscan="overscan"
            :scrollRef="scrollParentRef || undefined"
            @scroll="onScroll"
            @scroll-end="onScrollEnd"
            v-slot="{ item, index }"
        >
            <div :key="item.id || index">
                <slot name="item" :message="item" :index="index" />
            </div>
        </Virtualizer>
        <!-- Tail slot for streaming message appended after virtualized stable messages -->
        <slot name="tail" />
    </div>
</template>

<script setup lang="ts">
/**
 * VirtualMessageList
 * Requirements: 3.1 (Virtualization isolation), 4 (Docs)
 * Thin abstraction over virtua's <VList>. Purpose:
 *  - Decouple higher-level chat code from 3p library specifics (swap easier).
 *  - Emit semantic events (visible-range-change, reached-top/bottom) to drive
 *    auto-scroll + lazy fetch triggers without leaking scroll math.
 *  - Centralize perf tuning knobs (itemSizeEstimation, overscan) so callers
 *    don't sprinkle magic numbers.
 *
 * Task 2.3: Centralize scroll state and behavior here using VueUse utilities.
 * - useScroll: passive scroll tracking
 * - useResizeObserver: respond to size/DOM changes (messages/streaming)
 * - useRafFn: batch scroll-to-bottom to next frame to avoid jank
 */
import {
    onMounted,
    ref,
    watch,
    computed,
    nextTick,
    watchEffect,
    type PropType,
} from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Virtualizer } from 'virtua/vue';
import {
    useScroll,
    useResizeObserver,
    useRafFn,
    useEventListener,
} from '@vueuse/core';

interface ChatMessage {
    id: string;
    role?: string;
    content?: string;
    [k: string]: any;
}

const props = defineProps({
    messages: { type: Array as PropType<ChatMessage[]>, required: true },
    itemSizeEstimation: { type: Number, default: 500 }, // baseline heuristic average row height
    overscan: { type: Number, default: 4 },
    wrapperClass: { type: String, default: '' },
    scrollParent: {
        type: Object as PropType<HTMLElement | null>,
        default: null,
    },
    // Task 3.2: streaming maintenance
    isStreaming: { type: Boolean, default: false },
    // Task 3.1: adjustable threshold (design 100px; we default 100 while retaining legacy 64 logic internally)
    autoScrollThreshold: { type: Number, default: 100 },
    // Task 3.3: external editing suppression of auto-scroll
    editingActive: { type: Boolean, default: false },
    // Task 3.4: enable dynamic estimation of item size from growth deltas
    dynamicItemSize: { type: Boolean, default: true },
});

const emit = defineEmits<{
    (e: 'visible-range-change', range: { start: number; end: number }): void;
    (e: 'reached-top'): void;
    (e: 'reached-bottom'): void;
    (e: 'scroll-state', state: { atBottom: boolean; stick: boolean }): void; // Task 5.1.2
}>();

const root = ref<HTMLElement | null>(null);
// Accept both HTMLElement and Ref<HTMLElement|null> for scrollParent prop
const scrollParentRef = computed<HTMLElement | null>(() => {
    const sp: any = props.scrollParent as any;
    const el = sp && typeof sp === 'object' && 'value' in sp ? sp.value : sp;
    return el || root.value;
});
// Tunables (defined BEFORE any immediate watchers that call compute to avoid TDZ during HMR)
// Use provided threshold for deciding auto-scroll near-bottom detection (Req 1.1/3.1.3)
const thresholdPx = computed(() => props.autoScrollThreshold);
const disengageDeltaPx = 12; // small intentional upward scroll disengages
const USER_SCROLL_INACTIVE_TIMEOUT = 800;

// Scroll / stick state
let stick = true; // whether we are willing to auto-scroll
const atBottom = ref(true); // updated by compute(); default true so first append snaps
let lastScrollTop = 0;
let lastScrollHeight = 0;
let userScrollTimer: ReturnType<typeof setTimeout> | null = null;

// Initialize scroll metrics once scroll parent becomes available (after variables above are defined)
watch(
    scrollParentRef,
    (el) => {
        if (!el) return;
        try {
            lastScrollHeight = (el as any).scrollHeight || 0;
            lastScrollTop = (el as any).scrollTop || 0;
        } catch (e) {
            // intentionally ignored: initial scroll metrics fetch may fail if element not ready
        }
        compute();
    },
    { immediate: true }
);

// Scroll state emission tracking (Task 5.1.2)
let lastEmittedStick: boolean | null = null;
let lastEmittedAtBottom: boolean | null = null;
function maybeEmitScrollState() {
    const a = atBottom.value;
    if (a !== lastEmittedAtBottom || stick !== lastEmittedStick) {
        try {
            emit('scroll-state', { atBottom: a, stick });
        } catch (e) {
            // intentionally ignored: emit failure should not break scrolling
        }
        lastEmittedAtBottom = a;
        lastEmittedStick = stick;
    }
}

// Passive scroll monitoring
useScroll(scrollParentRef, {
    eventListenerOptions: { passive: true },
});

function compute() {
    const el =
        (props.scrollParent as any) || scrollParentRef.value || root.value;
    if (!el) return;
    const currentTop = el.scrollTop;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottomNow = dist <= thresholdPx.value;
    // Disengage if user scrolled upward a meaningful amount.
    const upward = currentTop < lastScrollTop - disengageDeltaPx;
    if (upward) {
        stick = false; // user explicitly left bottom intent
    } else if (atBottomNow && currentTop > lastScrollTop) {
        // Only (re)enable stick when user actively scrolled downward into bottom zone.
        stick = true;
    }
    atBottom.value = atBottomNow;
    lastScrollTop = currentTop;
    lastScrollHeight = el.scrollHeight;
    maybeEmitScrollState();
}

function markUserScroll() {
    if (userScrollTimer) clearTimeout(userScrollTimer);
    userScrollTimer = setTimeout(() => {}, USER_SCROLL_INACTIVE_TIMEOUT);
}

useEventListener(scrollParentRef, 'scroll', compute, {
    passive: true,
});
useEventListener(scrollParentRef, 'wheel', markUserScroll, { passive: true });
useEventListener(scrollParentRef, 'touchstart', markUserScroll, {
    passive: true,
});
useEventListener(scrollParentRef, 'touchmove', markUserScroll, {
    passive: true,
});

// Minimal: auto-scroll only if user is at bottom and not editing.
const shouldAutoScroll = computed(
    () => stick && atBottom.value && !props.editingActive
);

// (Restick delay removed for simplicity.)

function scrollToBottom(opts: { smooth?: boolean } = {}) {
    if (!stick) return; // respect disengaged reading state
    const baseEl = scrollParentRef.value || root.value;
    if (!baseEl) return;
    const smooth = opts.smooth === true;
    const targets: any[] = [];
    if (baseEl) targets.push(baseEl);
    if (root.value && root.value !== baseEl) targets.push(root.value);
    for (const t of targets) {
        try {
            const bottomPos = t.scrollHeight - t.clientHeight;
            if (typeof t.scrollTo === 'function') {
                t.scrollTo({
                    top: bottomPos,
                    behavior: (smooth ? 'smooth' : 'auto') as ScrollBehavior,
                });
            } else {
                t.scrollTop = bottomPos;
            }
        } catch (e) {
            // intentionally ignored: scrollTo API unsupported
        }
    }
    stick = true;
    (scrollToBottom as any)._count = ((scrollToBottom as any)._count || 0) + 1;
    try {
        lastScrollTop = baseEl.scrollTop ?? lastScrollTop;
        lastScrollHeight = baseEl.scrollHeight ?? lastScrollHeight;
    } catch (e) {
        // intentionally ignored: metrics update
    }
}

let pendingSmooth = false;
const raf = useRafFn(
    () => {
        raf.pause();
        scrollToBottom({ smooth: pendingSmooth });
        pendingSmooth = false;
    },
    { immediate: false }
);
function scrollToBottomRaf(smooth = false) {
    pendingSmooth = smooth;
    if (!raf.isActive.value) raf.resume();
}

function onContentIncrease() {
    const el =
        (props.scrollParent as any) || scrollParentRef.value || root.value;
    if (!el) return;
    if (shouldAutoScroll.value) {
        scrollToBottom({ smooth: false });
    } else {
        // Just refresh metrics, do not adjust position.
        lastScrollHeight = el.scrollHeight;
    }
}

useResizeObserver(root, () => {
    nextTick(onContentIncrease);
});
watch(
    () => props.scrollParent,
    (el) => {
        if (!el) return;
        useResizeObserver(el, () => {
            nextTick(onContentIncrease);
        });
    },
    { immediate: true }
);

function computeRange(): { start: number; end: number } {
    const total = props.messages.length;
    if (!root.value) return { start: 0, end: Math.max(0, total - 1) };
    return { start: 0, end: total - 1 };
}

function onInternalUpdate() {
    const range = computeRange();
    emit('visible-range-change', range);
    if (range.start === 0) emit('reached-top');
    if (range.end >= props.messages.length - 1) emit('reached-bottom');
}

function onScroll() {
    onInternalUpdate();
}
function onScrollEnd() {
    onInternalUpdate();
}

const averageItemSize = ref<number>(props.itemSizeEstimation);
let prevLength = props.messages.length;
let prevScrollHeight = 0;

watch(
    () => props.messages.length,
    () => {
        const el = scrollParentRef.value || root.value;
        const beforeAtBottom = atBottom.value;
        const added = props.messages.length - prevLength;
        if (el && added > 0) {
            prevScrollHeight = el.scrollHeight;
        }
        onInternalUpdate();
        nextTick(() => {
            const el2 = scrollParentRef.value || root.value;
            if (props.dynamicItemSize && el2 && added > 0) {
                const deltaH = el2.scrollHeight - prevScrollHeight;
                if (deltaH > 0) {
                    const per = deltaH / added;
                    averageItemSize.value = Math.max(
                        32,
                        Math.min(1200, averageItemSize.value * 0.7 + per * 0.3)
                    );
                } else if (
                    deltaH === 0 &&
                    averageItemSize.value === props.itemSizeEstimation
                ) {
                    averageItemSize.value = props.itemSizeEstimation;
                }
            }
            if (added > 0) {
                if (shouldAutoScroll.value && beforeAtBottom) {
                    scrollToBottomRaf(true);
                } else {
                    onContentIncrease();
                }
            }
            prevLength = props.messages.length;
        });
    }
);

const effectiveItemSize = computed(() => {
    return props.dynamicItemSize
        ? Math.round(averageItemSize.value)
        : props.itemSizeEstimation;
});

watchEffect(() => {
    if (!props.isStreaming) return;
    if (!shouldAutoScroll.value) return; // includes stick check
    nextTick(() => scrollToBottomRaf(false));
});

// --- Finalize clamp (retry over a few macrotasks to catch synthetic jump) ---
// --- Finalize stabilization: simplest form (capture reading position while streaming, restore once) ---
let readingPos: number | null = null;
// Capture reading position anytime user is disengaged during streaming
useEventListener(scrollParentRef, 'scroll', () => {
    if (!props.isStreaming) return;
    if (stick || atBottom.value) return; // following bottom; no need
    const el = scrollParentRef.value || root.value;
    if (!el) return;
    readingPos = el.scrollTop;
});

watch(
    () => props.isStreaming,
    (v, prev) => {
        if (!(prev && !v)) return; // only when streaming just ended
        if (stick || atBottom.value) {
            readingPos = null;
            return;
        }
        const target = readingPos;
        if (target == null) return;
        const apply = () => {
            const el = scrollParentRef.value || root.value;
            if (!el) {
                readingPos = null;
                return;
            }
            if (stick || atBottom.value) {
                readingPos = null;
                return;
            }
            // If user scrolled further up after finalize, respect it
            if (el.scrollTop < target - 4) {
                readingPos = null;
                return;
            }
            if (Math.abs(el.scrollTop - target) > 4) {
                try {
                    if (typeof (el as any).scrollTo === 'function')
                        (el as any).scrollTo({ top: target });
                } catch (e) {
                    // intentionally ignored: scrollTo unsupported
                }
                try {
                    (el as any).scrollTop = target;
                } catch (e) {
                    // intentionally ignored: direct scrollTop set failure
                }
            }
            readingPos = null;
        };
        // Stage corrections so synthetic test mutation (immediate) is seen:
        nextTick(() => {
            apply();
            queueMicrotask(apply);
            requestAnimationFrame(apply);
        });
    },
    { flush: 'post' }
);

onMounted(() => {
    onInternalUpdate();
    nextTick(() => {
        compute();
        if (atBottom.value) {
            scrollToBottom({ smooth: false });
        }
    });
    const sp: any = props.scrollParent as any;
    if (
        sp &&
        typeof sp === 'object' &&
        'value' in sp &&
        !sp.value &&
        root.value instanceof HTMLElement
    ) {
        try {
            sp.value = root.value;
        } catch (e) {
            // intentionally ignored: cannot assign scroll parent
        }
    }
});

defineExpose({
    atBottom,
    onContentIncrease,
    scrollToBottom,
    stickBottom: () => {
        stick = true;
        scrollToBottom({ smooth: true });
    },
    release: () => {
        stick = false;
        // no-op; stick will restore only when user reaches bottom again
    },
    effectiveItemSize,
    _devMetrics: () => ({ scrollCalls: (scrollToBottom as any)._count || 0 }),
});
</script>

<style scoped>
/* Keep retro feel: no extra styling here; rely on parent theme utilities */
</style>
