<template>
  <UInput
    v-bind="mergedProps"
    :class="mergedClass"
    :disabled="disabled"
    @input="handleInput"
    @change="handleChange"
    @focus="handleFocus"
    @blur="handleBlur"
    @keydown="handleKeydown"
  >
    <template v-for="(_, slot) in $slots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </UInput>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useThemeOverrides, useAutoContext } from '~/composables/useThemeOverrides'

/**
 * ThemeInput Component
 * ====================
 * 
 * A theme-aware input wrapper that automatically applies cyberpunk theme
 * overrides with neon borders and futuristic styling based on context.
 * 
 * @example
 * ```vue
 * <!-- Basic usage - auto-applies cyberpunk input styling -->
 * <ThemeInput v-model="text" placeholder="Enter text..." />
 * 
 * <!-- With explicit variant (props win over theme) -->
 * <ThemeInput v-model="text" variant="terminal" placeholder="Terminal input" />
 * 
 * <!-- In chat context - automatically gets neon styling -->
 * <ThemeInput v-model="message" placeholder="Type a message..." />
 * ```
 */

// Component props interface
interface ThemeInputProps {
  /** Input variant - if provided, wins over theme override */
  variant?: any
  /** Input size - if provided, wins over theme override */
  size?: string
  /** Additional CSS classes */
  class?: string
  /** Whether input is disabled */
  disabled?: boolean
  /** Whether input is readonly */
  readonly?: boolean
  /** Input placeholder text */
  placeholder?: string
  /** Input type */
  type?: string
  /** Input model value */
  modelValue?: string | number
  /** Whether input is required */
  required?: boolean
  /** Input name */
  name?: string
  /** Input id */
  id?: string
  /** Maximum length */
  maxlength?: number
  /** Minimum length */
  minlength?: number
  /** Pattern for validation */
  pattern?: string
  /** Whether to show loading state */
  loading?: boolean
}

// Define props with TypeScript
const props = withDefaults(defineProps<ThemeInputProps>(), {
  variant: undefined,
  size: undefined,
  disabled: false,
  readonly: false,
  type: 'text',
  required: false,
  loading: false
})

// Define emits
const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  input: [event: Event]
  change: [event: Event]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
  keydown: [event: KeyboardEvent]
}>()

// Auto-detect context from DOM
const context = useAutoContext()

// Track focus state for hover-like effects
const isFocused = ref(false)

// Get theme overrides for input component
const { overrides } = useThemeOverrides<Record<string, any>>('input', context, ref({
  variant: props.variant,
  size: props.size,
  disabled: props.disabled,
  readonly: props.readonly,
  type: props.type,
  required: props.required,
  loading: props.loading
}), computed(() => {
  if (props.disabled) return 'disabled'
  if (isFocused.value) return 'hover'
  return 'default'
}))

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
    readonly: props.readonly,
    placeholder: props.placeholder,
    type: props.type,
    modelValue: props.modelValue,
    required: props.required,
    name: props.name,
    id: props.id,
    maxlength: props.maxlength,
    minlength: props.minlength,
    pattern: props.pattern,
    loading: props.loading,
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
const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
  emit('input', event)
}

const handleChange = (event: Event) => {
  emit('change', event)
}

const handleFocus = (event: FocusEvent) => {
  isFocused.value = true
  emit('focus', event)
}

const handleBlur = (event: FocusEvent) => {
  isFocused.value = false
  emit('blur', event)
}

const handleKeydown = (event: KeyboardEvent) => {
  emit('keydown', event)
}
</script>

<style scoped>
/* Additional styling if needed */
</style>
