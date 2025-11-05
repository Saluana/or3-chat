<template>
    <UButton
        v-bind="mergedProps"
        :class="mergedClass"
        @click="handleClick"
        @keydown="handleKeydown"
    >
        <template v-for="(_, slot) in $slots" :key="slot" #[slot]="slotProps">
            <slot :name="slot" v-bind="slotProps || {}" />
        </template>
    </UButton>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watchEffect, type Ref } from 'vue';
import {
    useThemeOverrides,
    useAutoContext,
    mergeOverrides,
} from '~/composables/useThemeOverrides';
import type { ComponentState } from '~/theme/_shared/override-types';

/**
 * ThemeButton Component
 * =====================
 *
 * A theme-aware button wrapper that automatically applies cyberpunk theme
 * overrides based on context, state, and component props.
 *
 * @example
 * ```vue
 * <!-- Basic usage - auto-applies cyberpunk overrides -->
 * <ThemeButton>Click me</ThemeButton>
 *
 * <!-- With explicit props (props win over theme) -->
 * <ThemeButton variant="outline" size="lg">Custom Button</ThemeButton>
 *
 * <!-- In chat context - automatically gets neon outline style -->
 * <ThemeButton>Chat Action</ThemeButton>
 *
 * <!-- In sidebar context - automatically gets cyberpunk outline style -->
 * <ThemeButton>Sidebar Action</ThemeButton>
 * ```
 */

// Component props interface
interface ThemeButtonProps {
    /**
     * Identifier for precise theme targeting (HIGHEST PRIORITY)
     * Bypasses context-based resolution and wins over appearance props
     * @example 'chat.send.idle' | 'chat.send.streaming' | 'chat.attach'
     */
    identifier?: string;
    /** Button variant - if provided, wins over theme override */
    variant?: any;
    /** Button size - if provided, wins over theme override */
    size?: string;
    /** Additional CSS classes */
    class?: string;
    /** Whether button is disabled */
    disabled?: boolean;
    /** Button type */
    type?: 'button' | 'submit' | 'reset';
    /** Loading state */
    loading?: boolean;
    /** Icon to display */
    icon?: string;
    /** Button color - cast to any to avoid union type conflicts */
    color?: any;
    /** Block level button */
    block?: boolean;
    /** Square button (icon-only) */
    square?: boolean;
    /** Explicit theme context - overrides auto-detection */
    context?: 'chat' | 'sidebar' | 'dashboard' | 'header' | 'global';
}

// Define props with TypeScript
const props = withDefaults(defineProps<ThemeButtonProps>(), {
    variant: undefined,
    size: undefined,
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
    square: false,
});

// Define emits
const emit = defineEmits<{
    click: [event: MouseEvent];
    keydown: [event: KeyboardEvent];
}>();

// Use explicit context if provided, otherwise auto-detect (reactive)
const autoContext = useAutoContext();
const context = computed(() => props.context ?? autoContext.value);

// Note: keep context reactive so chat/sidebar detection updates after mount

// Track hydration to avoid SSR/client class mismatches
const isHydrated = ref(false);
onMounted(() => {
    isHydrated.value = true;
});

// Get theme overrides for button component
const componentProps = computed(() => ({
    variant: props.variant,
    size: props.size,
    disabled: props.disabled,
    loading: props.loading,
    color: props.color,
    block: props.block,
    square: props.square,
    type: props.type,
    icon: props.icon,
}));

const stateRef = computed<ComponentState>(() =>
    props.disabled ? 'disabled' : 'default'
);

const identifierRef = computed(() => props.identifier);

const { overrides } = useThemeOverrides<Record<string, any>>(
    'button',
    context,
    componentProps,
    stateRef,
    identifierRef
);

/**
 * Merge theme overrides with component props
 * Identifier takes highest priority for appearance, props win for behavior
 */
const mergedProps = computed(() => {
    // To prevent hydration mismatches, don't apply theme overrides until after mount
    if (!isHydrated.value) {
        return {
            variant: props.variant,
            size: props.size,
            disabled: props.disabled,
            loading: props.loading,
            type: props.type,
            icon: props.icon,
            color: props.color,
            block: props.block,
            square: props.square,
        };
    }

    const themeOverrides = overrides.value || {};

    return mergeOverrides<Record<string, any>>(themeOverrides, {
        variant: props.variant,
        size: props.size,
        color: props.color,
        block: props.block,
        square: props.square,
        disabled: props.disabled,
        loading: props.loading,
        type: props.type,
        icon: props.icon,
    });
});

/**
 * Merge CSS classes from theme and props
 */
const mergedClass = computed(() => {
    if (!isHydrated.value) return props.class || '';

    const themeClasses = overrides.value?.class || '';
    const propClasses = props.class || '';

    // Concatenate theme classes with prop classes
    return [themeClasses, propClasses].filter(Boolean).join(' ');
});

// Event handlers
const handleClick = (event: MouseEvent) => {
    if (!props.disabled) {
        emit('click', event);
    }
};

const handleKeydown = (event: KeyboardEvent) => {
    emit('keydown', event);
};
</script>

<style scoped>
/* Additional styling if needed */
</style>
