<template>
    <BaseResizeHandle
        v-if="isDesktop && paneCount > 1"
        :visible="true"
        position="right"
        width-class="w-2"
        :aria-label="`Resize pane ${paneIndex + 1}`"
        indicator-height="h-18"
        indicator-width="w-1.5"
        indicator-active-class="bg-[var(--md-primary)] opacity-100 shadow-[0_0_6px_rgba(0,0,0,0.15)]"
        indicator-idle-class="bg-[var(--md-primary)]/0 opacity-100"
        class="pane-resize-handle pointer-events-auto translate-x-full"
        :data-pane-index="paneIndex"
        @resize-start="onResizeStart"
        @resize-keydown="onResizeKeydown"
    />
</template>

<script setup lang="ts">
import BaseResizeHandle from '~/components/ui/BaseResizeHandle.vue';

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

function onResizeStart(e: PointerEvent) {
    emit('resizeStart', e, props.paneIndex);
}

function onResizeKeydown(e: KeyboardEvent) {
    emit('resizeKeydown', e, props.paneIndex);
}
</script>

<style scoped></style>
