<template>
  <UModal
    :model-value="modelValue"
    v-bind="mergedProps"
    :class="mergedClass"
    @close="handleClose"
    @open="handleOpen"
    @update:model-value="handleUpdateModelValue"
  >
    <template v-for="(_, slot) in $slots" :key="slot" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps || {}" />
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useThemeOverrides, useAutoContext } from '~/composables/useThemeOverrides'

/**
 * ThemeModal Component
 * ====================
 * 
 * A theme-aware modal wrapper that automatically applies cyberpunk theme
 * overrides with glow shadows, neon accents, and gradient backgrounds.
 * 
 * @example
 * ```vue
 * <!-- Basic usage - auto-applies cyberpunk modal styling -->
 * <ThemeModal v-model="isOpen">
 *   <template #header>Neon Modal</template>
 *   <template #body>
 *     <p>This modal has cyberpunk styling with glow effects!</p>
 *   </template>
 * </ThemeModal>
 * 
 * <!-- With custom size (props win over theme) -->
 * <ThemeModal v-model="isOpen" size="xl">
 *   <template #header>Large Cyberpunk Modal</template>
 *   <template #body>Large modal content</template>
 * </ThemeModal>
 * ```
 */

// Component props interface
interface ThemeModalProps {
  /** Modal v-model binding */
  modelValue: boolean
  /** Modal size - if provided, wins over theme override */
  size?: string
  /** Additional CSS classes */
  class?: string
  /** Whether modal can be closed by clicking outside */
  dismissible?: boolean
  /** Whether to prevent body scroll when modal is open */
  preventClose?: boolean
  /** Transition animation */
  transition?: any
  /** Whether modal is fullscreen */
  fullscreen?: boolean
  /** Whether to show overlay */
  overlay?: boolean
}

// Define props with TypeScript
const props = withDefaults(defineProps<ThemeModalProps>(), {
  size: undefined,
  dismissible: true,
  preventClose: false,
  fullscreen: false,
  overlay: true
})

// Define emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  open: []
}>()

// Auto-detect context from DOM
const context = useAutoContext()

// Get theme overrides for modal component
const { overrides } = useThemeOverrides<Record<string, any>>('modal', context, ref({
  size: props.size,
  dismissible: props.dismissible,
  preventClose: props.preventClose,
  fullscreen: props.fullscreen,
  overlay: props.overlay
}), computed(() => 'default'))

/**
 * Merge theme overrides with component props
 * Component props take precedence (Props Win principle)
 */
const mergedProps = computed(() => {
  const themeOverrides = overrides.value || {}
  
  return {
    // Theme overrides first, then component props override
    ...themeOverrides,
    // Component props win over theme overrides
    size: props.size,
    dismissible: props.dismissible,
    preventClose: props.preventClose,
    transition: props.transition,
    fullscreen: props.fullscreen,
    overlay: props.overlay
  }
})

/**
 * Merge CSS classes from theme and props
 */
const mergedClass = computed(() => {
  const themeClasses = overrides.value?.class || ''
  const propClasses = props.class || ''
  
  // Concatenate theme classes with prop classes
  return [themeClasses, propClasses].filter(Boolean).join(' ')
})

// Event handlers
const handleClose = () => {
  emit('update:modelValue', false)
  emit('close')
}

const handleOpen = () => {
  emit('open')
}

const handleUpdateModelValue = (value: boolean) => {
  emit('update:modelValue', value)
}
</script>

<style scoped>
/* Additional styling if needed */
</style>
