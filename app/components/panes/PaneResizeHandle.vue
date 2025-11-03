<template>
    <div
        v-if="isDesktop && paneCount > 1"
        class="pane-resize-handle absolute top-0 bottom-0 w-1 cursor-col-resize select-none group z-20 -right-0.5"
        @pointerdown="onPointerDown"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
        role="separator"
        aria-orientation="vertical"
        :aria-label="`Resize pane ${paneIndex + 1}`"
        tabindex="0"
        @keydown="onHandleKeydown"
        @focus="isFocused = true"
        @blur="isFocused = false"
    >
        <!-- Invisible hit area that extends 2px on each side -->
        <div
            class="absolute inset-y-0 -left-[2px] -right-[2px] pointer-events-auto"
        ></div>
        
        <!-- Visible indicator (only on hover or focus) -->
        <div
            :class="[
                'absolute inset-y-0 my-auto h-24 rounded-full transition-all duration-200',
                isHovered || isFocused
                    ? 'w-1.5 bg-[var(--md-primary)] opacity-100'
                    : 'w-0 opacity-0'
            ]"
        ></div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Props {
    paneIndex: number;
    paneCount: number;
    isDesktop: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
    resizeStart: [event: PointerEvent, paneIndex: number];
    resizeKeydown: [event: KeyboardEvent, paneIndex: number];
}>();

const isHovered = ref(false);
const isFocused = ref(false);

function onPointerDown(e: PointerEvent) {
    emit('resizeStart', e, props.paneIndex);
}

function onHandleKeydown(e: KeyboardEvent) {
    emit('resizeKeydown', e, props.paneIndex);
}
</script>

<style scoped>
.pane-resize-handle {
    /* Position on the exact border */
    transform: translateX(50%);
}
</style>
