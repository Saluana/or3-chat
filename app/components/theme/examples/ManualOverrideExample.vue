<template>
  <div class="p-4 space-y-4">
    <h3 class="text-lg font-bold mb-4">Manual Theme Override Example</h3>
    
    <!-- Example 1: Manual useThemeOverrides with context -->
    <section class="space-y-2">
      <h4 class="font-semibold">Context-Specific Override (Chat)</h4>
      <button
        :class="chatButtonClasses"
        @click="handleChatAction"
      >
        Chat Action (Manual)
      </button>
      <p class="text-xs opacity-70">
        Uses useThemeOverrides with explicit 'chat' context
      </p>
    </section>

    <!-- Example 2: Manual useThemeOverrides with identifier -->
    <section class="space-y-2">
      <h4 class="font-semibold">Identifier-Specific Override</h4>
      <button
        :class="specialButtonClasses"
        @click="handleSpecialAction"
      >
        Special Action (Manual)
      </button>
      <p class="text-xs opacity-70">
        Uses useThemeOverrides with identifier for precise targeting
      </p>
    </section>

    <!-- Example 3: Props Merging -->
    <section class="space-y-2">
      <h4 class="font-semibold">Props Merging Example</h4>
      <button
        :class="mergedButtonClasses"
        @click="handleMergedAction"
      >
        Merged Style Button
      </button>
      <p class="text-xs opacity-70">
        Shows how manual props merge with theme overrides
      </p>
    </section>

    <!-- Example 4: State-based Overrides -->
    <section class="space-y-2">
      <h4 class="font-semibold">State-based Override</h4>
      <button
        :class="stateButtonClasses"
        @click="handleStateAction"
        :disabled="isDisabled"
      >
        {{ isDisabled ? 'Disabled' : 'Enabled' }} Button
      </button>
      <p class="text-xs opacity-70">
        Demonstrates state-based theme overrides
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useThemeOverrides } from '~/composables/useThemeOverrides'

// Example 1: Context-specific override
const chatButtonOverrides = useThemeOverrides('button', 'chat', {
  variant: 'outline',
  size: 'sm'
}, ref('default'))

const chatButtonClasses = computed(() => {
  const base = ['retro-btn', 'border-2', 'px-4', 'py-2', 'rounded']
  const themeClasses = chatButtonOverrides.overrides.value || {}
  return [...base, themeClasses.variant || '', themeClasses.size || ''].filter(Boolean)
})

// Example 2: Identifier-specific override (placeholder for future implementation)
const specialButtonOverrides = useThemeOverrides('button', 'global', {
  variant: 'solid',
  color: 'primary'
}, ref('default'))

const specialButtonClasses = computed(() => {
  const base = ['retro-btn', 'border-2', 'px-4', 'py-2', 'rounded']
  const themeClasses = specialButtonOverrides.overrides.value || {}
  return [...base, themeClasses.variant || '', themeClasses.color || ''].filter(Boolean)
})

// Example 3: Props merging demonstration
const manualProps = computed(() => ({
  variant: 'outline',
  size: 'lg',
  color: 'secondary'
}))

const mergedButtonOverrides = useThemeOverrides('button', 'dashboard', manualProps.value, ref('default'))

const mergedButtonClasses = computed(() => {
  const base = ['retro-btn', 'border-2', 'px-4', 'py-2', 'rounded']
  const themeClasses = mergedButtonOverrides.overrides.value || {}
  
  // Show how props merge with theme overrides
  // Theme overrides can override manual props based on priority
  return [...base, themeClasses.variant || 'outline', themeClasses.size || 'lg'].filter(Boolean)
})

// Example 4: State-based overrides
const isDisabled = ref(false)
const stateButtonOverrides = useThemeOverrides('button', 'sidebar', {
  variant: 'ghost'
}, computed(() => isDisabled.value ? 'disabled' : 'default'))

const stateButtonClasses = computed(() => {
  const base = ['retro-btn', 'border-2', 'px-4', 'py-2', 'rounded']
  const themeClasses = stateButtonOverrides.overrides.value || {}
  
  return [...base, themeClasses.variant || 'ghost', isDisabled.value ? 'opacity-50' : ''].filter(Boolean)
})

// Event handlers
const handleChatAction = () => {
  console.log('Chat action triggered with manual theme override')
}

const handleSpecialAction = () => {
  console.log('Special action triggered with identifier-based override')
}

const handleMergedAction = () => {
  console.log('Merged style action triggered')
}

const handleStateAction = () => {
  isDisabled.value = !isDisabled.value
  console.log(`State changed to: ${isDisabled.value ? 'disabled' : 'enabled'}`)
}
</script>

<style scoped>
section {
  border: 2px solid var(--md-outline);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
</style>
