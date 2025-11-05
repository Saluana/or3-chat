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
import { computed, ref } from 'vue'
import { useThemeOverrides, useAutoContext } from '~/composables/useThemeOverrides'

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
  /** Button variant - if provided, wins over theme override */
  variant?: any
  /** Button size - if provided, wins over theme override */
  size?: string
  /** Additional CSS classes */
  class?: string
  /** Whether button is disabled */
  disabled?: boolean
  /** Button type */
  type?: 'button' | 'submit' | 'reset'
  /** Loading state */
  loading?: boolean
  /** Icon to display */
  icon?: string
  /** Button color - cast to any to avoid union type conflicts */
  color?: any
  /** Block level button */
  block?: boolean
  /** Square button (aspect ratio 1:1) */
  square?: boolean
}

// Define props with TypeScript
const props = withDefaults(defineProps<ThemeButtonProps>(), {
  variant: undefined,
  size: undefined,
  type: 'button',
  disabled: false,
  loading: false,
  block: false,
  square: false
})

// Define emits
const emit = defineEmits<{
  click: [event: MouseEvent]
  keydown: [event: KeyboardEvent]
}>()

// Auto-detect context from DOM
const context = useAutoContext()

// Get theme overrides for button component
const { overrides } = useThemeOverrides<Record<string, any>>('button', context, ref({
  variant: props.variant,
  size: props.size,
  disabled: props.disabled,
  loading: props.loading,
  color: props.color,
  block: props.block,
  square: props.square
}), computed(() => props.disabled ? 'disabled' : 'default'))

/**
 * Merge theme overrides with component props
 * Component props take precedence (Props Win principle)
 */
const mergedProps = computed(() => {
  const themeOverrides = overrides.value || {}
  
  return {
    // Component props win over theme overrides
    variant: props.variant || themeOverrides.variant,
    size: props.size || themeOverrides.size,
    disabled: props.disabled,
    loading: props.loading,
    type: props.type,
    icon: props.icon,
    color: props.color,
    block: props.block,
    square: props.square,
    // Merge other theme props that weren't explicitly provided
    ...Object.fromEntries(
      Object.entries(themeOverrides).filter(([key]) => !(key in props))
    )
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
const handleClick = (event: MouseEvent) => {
  if (!props.disabled) {
    emit('click', event)
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  emit('keydown', event)
}
</script>

<style scoped>
/* Additional styling if needed */
</style>
