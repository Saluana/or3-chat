<template>
    <BaseResizeHandle
        :visible="isDesktop && !collapsed"
        :position="side === 'right' ? 'left' : 'right'"
        width-class="w-3"
        aria-label="Resize sidebar"
        :aria-value-min="minWidth"
        :aria-value-max="maxWidth"
        :aria-value-now="computedWidth"
        indicator-height="h-24"
        indicator-width="w-1.5"
        indicator-active-class="bg-[var(--md-primary)]/70"
        indicator-idle-class="bg-[var(--md-outline-variant)]/70"
        class="resize-handle-layer hidden md:block"
        @resize-start="emit('resize-start', $event)"
        @resize-keydown="emit('resize-keydown', $event)"
    />
</template>

<script setup lang="ts">
import BaseResizeHandle from '~/components/ui/BaseResizeHandle.vue';

defineProps<{
    isDesktop: boolean;
    collapsed: boolean;
    side: 'left' | 'right';
    minWidth: number;
    maxWidth: number;
    computedWidth: number;
}>();

const emit = defineEmits<{
    (e: 'resize-start', ev: PointerEvent): void;
    (e: 'resize-keydown', ev: KeyboardEvent): void;
}>();
</script>

<style scoped>
/* visual handled by BaseResizeHandle */
</style>
