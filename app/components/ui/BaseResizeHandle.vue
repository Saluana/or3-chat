<template>
    <div
        v-show="visible"
        :class="[
            'resize-handle-base absolute top-0 bottom-0 cursor-col-resize select-none group z-20',
            widthClass,
            positionClass,
        ]"
        @pointerdown="onPointerDown"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
        role="separator"
        aria-orientation="vertical"
        :aria-valuemin="ariaValueMin"
        :aria-valuemax="ariaValueMax"
        :aria-valuenow="ariaValueNow"
        :aria-label="ariaLabel"
        tabindex="0"
        @keydown="onHandleKeydown"
        @focus="isFocused = true"
        @blur="isFocused = false"
    >
        <!-- Hit area for easier grabbing -->
        <slot name="hit-area">
            <div
                class="resize-handle-base__hit-area absolute inset-y-0 left-0 right-0 pointer-events-auto"
            ></div>
        </slot>

        <!-- Visual indicator -->
        <slot name="indicator" :hovered="isHovered" :focused="isFocused">
            <div
                :class="[
                    'resize-handle-base__indicator absolute inset-y-0 my-auto rounded-full transition-all duration-200 pointer-events-none',
                    indicatorPositionClass,
                    indicatorSizeClass,
                    isHovered || isFocused
                        ? indicatorActiveClass
                        : indicatorIdleClass,
                ]"
            ></div>
        </slot>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

export interface BaseResizeHandleProps {
    /** Whether the handle is visible */
    visible?: boolean;
    /** Position of the handle relative to parent */
    position?: 'left' | 'right';
    /** Width of the hit area (Tailwind class) */
    widthClass?: string;
    /** ARIA label for accessibility */
    ariaLabel?: string;
    /** ARIA min value (for slider-like semantics) */
    ariaValueMin?: number;
    /** ARIA max value (for slider-like semantics) */
    ariaValueMax?: number;
    /** ARIA current value (for slider-like semantics) */
    ariaValueNow?: number;
    /** Height of the visual indicator (Tailwind class) */
    indicatorHeight?: string;
    /** Width of the visual indicator (Tailwind class) */
    indicatorWidth?: string;
    /** Classes for active (hovered/focused) state */
    indicatorActiveClass?: string;
    /** Classes for idle state */
    indicatorIdleClass?: string;
}

const props = withDefaults(defineProps<BaseResizeHandleProps>(), {
    visible: true,
    position: 'right',
    widthClass: 'w-2',
    ariaLabel: 'Resize',
    ariaValueMin: undefined,
    ariaValueMax: undefined,
    ariaValueNow: undefined,
    indicatorHeight: 'h-18',
    indicatorWidth: 'w-1.5',
    indicatorActiveClass:
        'bg-[var(--md-primary)] opacity-100 shadow-[0_0_6px_rgba(0,0,0,0.15)]',
    indicatorIdleClass: 'bg-[var(--md-outline-variant)]/70 opacity-100',
});

const emit = defineEmits<{
    resizeStart: [event: PointerEvent];
    resizeKeydown: [event: KeyboardEvent];
}>();

const isHovered = ref(false);
const isFocused = ref(false);

const positionClass = computed(() =>
    props.position === 'left' ? 'left-0' : 'right-0'
);

const indicatorPositionClass = computed(() =>
    props.position === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'
);

const indicatorSizeClass = computed(
    () => `${props.indicatorHeight} ${props.indicatorWidth}`
);

function onPointerDown(e: PointerEvent) {
    emit('resizeStart', e);
}

function onHandleKeydown(e: KeyboardEvent) {
    emit('resizeKeydown', e);
}
</script>

<style scoped>
/* Base styles - can be extended by consumers */
</style>
