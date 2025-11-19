<template>
    <div
        v-if="isDesktop && paneCount > 1"
        class="pane-resize-handle absolute top-0 bottom-0 w-2 cursor-col-resize select-none group z-20 pointer-events-auto right-0 translate-x-full"
        :data-pane-index="paneIndex"
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
            class="pane-resize-handle__hit-area absolute inset-y-0 left-0 right-0 pointer-events-auto"
        ></div>

        <!-- Visible indicator (only on hover or focus) -->
        <div
            :class="[
                'pane-resize-handle__indicator absolute inset-y-0 left-1/2 -translate-x-1/2 my-auto h-18 rounded-full transition-all duration-200 pointer-events-none',
                isHovered || isFocused
                    ? 'w-1.5 bg-[var(--md-primary)] opacity-100 shadow-[0_0_6px_rgba(0,0,0,0.15)]'
                    : 'w-1.5 bg-[var(--md-primary)]/0 opacity-100',
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

<style scoped></style>
