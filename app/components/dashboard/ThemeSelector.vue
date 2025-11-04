<template>
  <div class="theme-selector">
    <div class="theme-selector-header">
      <h3 class="text-xl font-bold mb-4">Theme Selection</h3>
      <p class="text-sm opacity-75 mb-6">Choose a theme to customize the appearance of the application.</p>
    </div>

    <!-- Current Theme Display -->
    <div class="current-theme mb-6 p-4 border-2 border-black rounded-lg bg-surface">
      <h4 class="font-bold mb-2">Current Theme</h4>
      <div class="flex items-center gap-2">
        <div class="w-4 h-4 rounded-full bg-primary"></div>
        <span class="font-mono">{{ activeTheme }}</span>
        <UButton 
          variant="outline" 
          size="sm" 
          @click="reloadTheme"
          :loading="isReloading"
          class="ml-auto"
        >
          Reload
        </UButton>
      </div>
    </div>

    <!-- Theme Options -->
    <div class="theme-options">
      <div 
        v-for="theme in availableThemes" 
        :key="theme.name"
        class="theme-option mb-4 p-4 border-2 rounded-lg cursor-pointer transition-all"
        :class="{
          'border-primary bg-primary/10': theme.name === activeTheme,
          'border-black hover:border-primary/50': theme.name !== activeTheme,
          'opacity-50 cursor-not-allowed': isLoading && theme.name === activeTheme
        }"
        @click="selectTheme(theme.name)"
        @mouseenter="validateTheme(theme.name)"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="theme-preview">
              <div class="flex gap-1">
                <div 
                  v-if="theme.hasLight" 
                  class="w-3 h-3 rounded-full bg-white border border-black"
                  title="Light variant"
                ></div>
                <div 
                  v-if="theme.hasDark" 
                  class="w-3 h-3 rounded-full bg-black"
                  title="Dark variant"
                ></div>
                <div 
                  v-if="theme.variants.includes('light-hc')" 
                  class="w-3 h-3 rounded-full bg-yellow-200 border-2 border-black"
                  title="Light high-contrast variant"
                ></div>
                <div 
                  v-if="theme.variants.includes('dark-hc')" 
                  class="w-3 h-3 rounded-full bg-gray-900 border-2 border-white"
                  title="Dark high-contrast variant"
                ></div>
              </div>
            </div>
            <div>
              <h4 class="font-bold capitalize">{{ theme.name }}</h4>
              <p class="text-xs opacity-75">{{ theme.path }}</p>
              <div class="flex gap-1 mt-1">
                <span 
                  v-for="variant in theme.variants.slice(0, 3)" 
                  :key="variant"
                  class="text-xs px-1 py-0.5 bg-black/10 rounded border border-black/50"
                >
                  {{ variant }}
                </span>
                <span 
                  v-if="theme.variants.length > 3"
                  class="text-xs px-1 py-0.5 bg-black/10 rounded border border-black/50"
                >
                  +{{ theme.variants.length - 3 }}
                </span>
              </div>
            </div>
          </div>
          
          <div class="flex items-center gap-2">
            <UButton 
              v-if="theme.name === activeTheme"
              variant="solid" 
              size="sm"
              disabled
            >
              Active
            </UButton>
            <UButton 
              v-else
              variant="outline" 
              size="sm"
              @click.stop="selectTheme(theme.name)"
              :loading="isLoading && selectedTheme === theme.name"
            >
              Select
            </UButton>
          </div>
        </div>

        <!-- Theme Status -->
        <div v-if="validationCache[theme.name]?.errors?.length" class="mt-3 text-xs text-error">
          <div class="font-bold">Errors:</div>
          <ul class="list-disc list-inside">
            <li v-for="error in validationCache[theme.name]?.errors || []" :key="error.file">
              {{ error.message }}
            </li>
          </ul>
        </div>
        
        <div v-if="validationCache[theme.name]?.warnings?.length" class="mt-3 text-xs text-warning">
          <div class="font-bold">Warnings:</div>
          <ul class="list-disc list-inside">
            <li v-for="warning in validationCache[theme.name]?.warnings || []" :key="warning.file">
              {{ warning.message }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- No Themes Available -->
    <div v-if="availableThemes.length === 0" class="text-center py-8">
      <p class="opacity-75">No themes available</p>
      <p class="text-xs opacity-50">Check the theme directory for available themes.</p>
    </div>

    <!-- Theme Validation Status -->
    <div v-if="errors.length || warnings.length" class="mt-6 p-4 border-2 border-warning rounded-lg">
      <h4 class="font-bold mb-2 text-warning">Theme System Status</h4>
      <div v-if="errors.length" class="mb-2">
        <div class="text-sm font-bold text-error">Errors ({{ errors.length }}):</div>
        <ul class="text-xs list-disc list-inside">
          <li v-for="error in errors" :key="error.file">{{ error.message }}</li>
        </ul>
      </div>
      <div v-if="warnings.length">
        <div class="text-sm font-bold text-warning">Warnings ({{ warnings.length }}):</div>
        <ul class="text-xs list-disc list-inside">
          <li v-for="warning in warnings" :key="warning.file">{{ warning.message }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNuxtApp } from '#app'
import type { ThemeManifest, ThemeError, ThemeWarning } from '~/theme/_shared/theme-loader'

// Get theme provider with proper typing
const nuxtApp = useNuxtApp()
const $theme = nuxtApp.$theme as any

// Reactive state
const activeTheme = ref($theme.activeTheme.value)
const availableThemes = ref($theme.availableThemes.value)
const errors = ref($theme.errors.value)
const warnings = ref($theme.warnings.value)
const isLoading = ref(false)
const isReloading = ref(false)
const selectedTheme = ref<string | null>(null)

// Theme validation cache
const validationCache = ref<Record<string, { errors: ThemeError[], warnings: ThemeWarning[] }>>({})
const validating = ref<Set<string>>(new Set())

// Computed properties
const currentThemeManifest = computed(() => {
  return availableThemes.value.find((t: ThemeManifest) => t.name === activeTheme.value)
})

// Watch for theme changes
watch(() => $theme.activeTheme.value, (newTheme: string) => {
  activeTheme.value = newTheme
})

watch(() => $theme.availableThemes.value, (newThemes: ThemeManifest[]) => {
  availableThemes.value = newThemes
  // Clear validation cache when theme list changes
  validationCache.value = {}
})

watch(() => $theme.errors.value, (newErrors: ThemeError[]) => {
  errors.value = newErrors
})

watch(() => $theme.warnings.value, (newWarnings: ThemeWarning[]) => {
  warnings.value = newWarnings
})

// Methods
const selectTheme = async (themeName: string) => {
  if (themeName === activeTheme.value || isLoading.value) return
  
  isLoading.value = true
  selectedTheme.value = themeName
  
  try {
    const success = await $theme.switchTheme(themeName)
    if (success) {
      // Theme switch successful - page will reload
      console.log(`Theme switched to ${themeName}`)
    } else {
      console.error(`Failed to switch to theme ${themeName}`)
    }
  } catch (error) {
    console.error('Error switching theme:', error)
  } finally {
    isLoading.value = false
    selectedTheme.value = null
  }
}

const reloadTheme = async () => {
  if (isReloading.value) return
  
  isReloading.value = true
  
  try {
    const success = await $theme.reloadTheme()
    if (success) {
      console.log('Theme reloaded successfully')
    } else {
      console.error('Failed to reload theme')
    }
  } catch (error) {
    console.error('Error reloading theme:', error)
  } finally {
    isReloading.value = false
  }
}

const validateTheme = async (themeName: string) => {
  // Already cached
  if (validationCache.value[themeName]) {
    return validationCache.value[themeName]
  }

  // Already validating
  if (validating.value.has(themeName)) {
    return
  }

  validating.value.add(themeName)

  try {
    const result = await $theme.validateTheme(themeName)
    if (result) {
      validationCache.value[themeName] = {
        errors: result.errors,
        warnings: result.warnings
      }
    }
  } catch (error) {
    console.error(`Error validating theme ${themeName}:`, error)
    validationCache.value[themeName] = {
      errors: [{
        file: themeName,
        message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      }],
      warnings: []
    }
  } finally {
    validating.value.delete(themeName)
  }
}

// Initialize
onMounted(() => {
  // No longer validate all themes on mount - lazy loading instead
})

// Helper to check if theme has specific variants
const hasVariant = (theme: ThemeManifest, variant: string): boolean => {
  return theme.variants.includes(variant as any)
}
</script>

<style scoped>
.theme-selector {
  max-width: 600px;
  margin: 0 auto;
}

.theme-option {
  transition: all 0.2s ease;
}

.theme-option:hover {
  transform: translateY(-1px);
}

.theme-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
}

.current-theme {
  background: linear-gradient(45deg, var(--md-surface) 25%, transparent 25%),
              linear-gradient(-45deg, var(--md-surface) 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, var(--md-surface) 75%),
              linear-gradient(-45deg, transparent 75%, var(--md-surface) 75%);
  background-size: 10px 10px;
  background-position: 0 0, 0 5px, 5px -5px, -5px 0px;
}
</style>
