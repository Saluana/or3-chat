<template>
    <div
        v-if="isDesktop && !collapsed"
        class="hidden md:block absolute top-0 bottom-0 w-3 cursor-col-resize select-none group"
        :class="side === 'right' ? 'left-0' : 'right-0'"
        @pointerdown="onPointerDown"
        role="separator"
        aria-orientation="vertical"
        :aria-valuemin="minWidth"
        :aria-valuemax="maxWidth"
        :aria-valuenow="computedWidth"
        aria-label="Resize sidebar"
        tabindex="0"
        @keydown="onHandleKeydown"
    >
        <div
            class="absolute inset-y-0 my-auto h-24 w-1.5 rounded-full bg-[var(--md-outline-variant)]/70 group-hover:bg-[var(--md-primary)]/70 transition-colors"
            :class="side === 'right' ? 'left-0' : 'right-0'"
        ></div>
    </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';

const props = defineProps({
    isDesktop: { type: Boolean, required: true },
    collapsed: { type: Boolean, required: true },
    side: { type: String as () => 'left' | 'right', required: true },
    minWidth: { type: Number, required: true },
    maxWidth: { type: Number, required: true },
    computedWidth: { type: Number, required: true },
});

// events: pointerdown and keydown are native; parent binds handlers via v-on

function onPointerDown(e: PointerEvent) {
    // re-emit native event so parent can handle logic
    const ev = new CustomEvent('pointerdown', { detail: e, bubbles: true });
    (e.target as Element).dispatchEvent(ev);
}

function onHandleKeydown(e: KeyboardEvent) {
    const ev = new CustomEvent('keydown', { detail: e, bubbles: true });
    (e.target as Element).dispatchEvent(ev);
}
</script>

<style scoped>
/* visual handled by parent styles */
</style>
