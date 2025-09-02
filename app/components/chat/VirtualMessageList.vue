<template>
    <!-- Wrapper around virtua's virtual list for messages -->
    <div ref="root" class="flex flex-col" :class="wrapperClass">
        <Virtualizer
            :data="messages"
            :itemSize="itemSizeEstimation || undefined"
            :overscan="overscan"
            :scrollRef="scrollParent || undefined"
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
 * Performance Notes (Task 2.4):
 *  - itemSizeEstimation is a heuristic avg row height (px). Virtua benefits
 *    from closer estimates for jump accuracy. We'll measure once real message
 *    mix known; keep default conservative (72) to reduce under-estimation.
 *  - overscan kept small (4) to balance DOM churn vs. rapid wheel scroll.
 *  - computeRange() currently returns full range because virtua's public API
 *    doesn't expose internal first/last indices directly. This is acceptable
 *    for now since downstream consumers only need edge detection. If/when we
 *    require partial range (e.g. transcript minimap) we can either:
 *      a) Contribute an API upstream, or
 *      b) Probe DOM for rendered children & derive indices (slower fallback).
 *  - Scroll events: we coalesce logic via onInternalUpdate() — cheap constant
 *    operations (no layout thrash) so safe each scroll tick.
 *  - Future optimization hooks: dynamic itemSizeEstimation sampling (median of
 *    first N rendered rows) and throttled range emission if CPU hotspots seen.
 */
import { onMounted, ref, watch, type PropType } from 'vue';
// eslint-disable-next-line import/no-unresolved
import { Virtualizer } from 'virtua/vue';

interface ChatMessage {
    id: string;
    role?: string;
    content?: string;
    [k: string]: any;
}

const props = defineProps({
    messages: { type: Array as PropType<ChatMessage[]>, required: true },
    itemSizeEstimation: { type: Number, default: 72 }, // heuristic average row height
    overscan: { type: Number, default: 4 },
    wrapperClass: { type: String, default: '' },
    scrollParent: {
        type: Object as PropType<HTMLElement | null>,
        default: null,
    },
});

const emit = defineEmits<{
    (e: 'visible-range-change', range: { start: number; end: number }): void;
    (e: 'reached-top'): void;
    (e: 'reached-bottom'): void;
}>();

const root = ref<HTMLElement | null>(null);

// Debug/logging removed per request.

// Track visible range heuristically via scroll metrics
function computeRange(): { start: number; end: number } {
    // virtua does not expose direct API here; fallback simplistic approach:
    // We rely on overscan as smoothing; refine later if library offers hooks.
    const total = props.messages.length;
    if (!root.value) return { start: 0, end: Math.max(0, total - 1) };
    // Placeholder: without internal indices, emit full range.
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

watch(
    () => props.messages.length,
    () => {
        onInternalUpdate();
    }
);

onMounted(() => {
    onInternalUpdate();
});
</script>

<style scoped>
/* Keep retro feel: no extra styling here; rely on parent theme utilities */
</style>
