<template>
    <BaseResizeHandle
        v-if="isDesktop && paneCount > 1"
        :visible="true"
        position="right"
        width-class="w-2"
        :aria-label="`Resize pane ${paneIndex + 1}`"
        indicator-height="h-full"
        indicator-width="w-0.5"
        indicator-active-class="bg-[var(--blank-brand-accent,var(--md-primary))] opacity-100"
        indicator-idle-class="bg-transparent opacity-0"
        class="pane-resize-handle pointer-events-auto translate-x-1/2"
        :data-pane-index="paneIndex"
        @resize-start="onResizeStart"
        @resize-keydown="onResizeKeydown"
    >
        <div
            class="absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 invisible opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
            <UTooltip :delay-duration="0" text="Swap left and right panes">
                <UButton
                    :square="true"
                    variant="outline"
                    color="neutral"
                    size="sm"
                    icon="i-lucide-arrow-left-right"
                    aria-label="Swap left and right panes"
                    title="Swap left and right panes"
                    class="pane-swap-button cursor-pointer bg-[var(--md-surface)] shadow-sm"
                    @pointerdown.stop
                    @keydown.stop
                    @click.stop="emit('swap', paneIndex)"
                />
            </UTooltip>
        </div>
    </BaseResizeHandle>
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
    swap: [paneIndex: number];
}>();

function onResizeStart(e: PointerEvent) {
    emit('resizeStart', e, props.paneIndex);
}

function onResizeKeydown(e: KeyboardEvent) {
    emit('resizeKeydown', e, props.paneIndex);
}
</script>

<style scoped>
/* Keep the controls above the active pane's inset outline while visible. */
.pane-resize-handle:hover,
.pane-resize-handle:focus-within {
    z-index: 110;
}
</style>
