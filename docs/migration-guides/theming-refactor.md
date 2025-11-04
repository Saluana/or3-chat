# Theming Refactor Migration Guide

This guide helps you migrate from the old theming system to the new Material Design 3-based multi-theme architecture.

## 📋 What Changed

### High-Level Summary

The theming refactor introduces a complete overhaul of how themes are structured, loaded, and applied:

#### 🎨 **New Architecture**
- **Multi-Theme Support**: Switch between multiple themes dynamically
- **Material Design 3**: Built on Google's modern color system
- **CSS Custom Properties**: Native CSS variables for better performance
- **Component Overrides**: Theme-specific Nuxt UI component configurations
- **Theme Discovery**: Automatic theme loading and validation
- **TypeScript Support**: Full type safety and IDE autocomplete

#### 📁 **New File Structure**
```
app/theme/
├── default/           # Built-in default theme
│   ├── light.css
│   ├── dark.css
│   ├── main.css
│   └── theme.ts
├── minimal/           # Example minimal theme
├── cyberpunk/         # Example cyberpunk theme
├── nature/            # Example nature theme
└── your-theme/        # Your custom themes
    ├── light.css      # Required: Light mode colors
    ├── dark.css       # Required: Dark mode colors
    ├── main.css       # Optional: Global styles
    └── theme.ts       # Optional: Component overrides
```

#### 🔧 **New Plugin System**
- **Theme Provider**: `$theme` global with theme switching API
- **Validation System**: Automatic theme validation and error reporting
- **Hot Reload**: Instant theme updates during development
- **Dashboard Integration**: Built-in theme selector UI

#### 🎯 **New Color System**
- **Semantic Colors**: Primary, secondary, surface, background roles
- **Contrast Colors**: Automatic `on-*` colors for accessibility
- **Container Variants**: Lighter background colors for containers
- **Application Colors**: Custom variables for app-specific needs

## ⚠️ Breaking Changes

### 1. Theme File Locations

**Before:**
```
assets/css/themes/
├── light.css
├── dark.css
└── variables.css
```

**After:**
```
app/theme/your-theme/
├── light.css
├── dark.css
├── main.css
└── theme.ts
```

**Migration:** Move theme files to the new `app/theme/` directory structure.

### 2. CSS Variable Naming

**Before:**
```css
:root {
  --primary-color: #6366f1;
  --background-color: #ffffff;
  --text-color: #1e293b;
}
```

**After:**
```css
:root {
  --md-primary: #6366f1;
  --md-background: #ffffff;
  --md-on-background: #1e293b;
}
```

**Migration:** Update variable names to follow Material Design 3 conventions.

### 3. Theme Activation

**Before:**
```typescript
// Manual class application
document.documentElement.classList.toggle('dark')
```

**After:**
```typescript
// Use theme provider
await $theme.switchTheme('your-theme')
$theme.toggle()
```

**Migration:** Replace manual theme switching with the new theme provider API.

### 4. Component Styling

**Before:**
```vue
<template>
  <button class="bg-primary text-white px-4 py-2 rounded">
    Click me
  </button>
</template>
```

**After:**
```vue
<template>
  <UButton variant="solid" color="primary">
    Click me
  </UButton>
</template>
```

**Migration:** Replace custom styling with Nuxt UI components and theme variants.

## 🔄 Migrating Custom Components

### Before/After Examples

#### 1. Custom Button Component

**Before:**
```vue
<!-- components/CustomButton.vue -->
<template>
  <button 
    :class="[
      'px-4 py-2 rounded font-medium transition-colors',
      variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',
      variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300',
      size === 'sm' && 'px-3 py-1.5 text-sm',
      size === 'lg' && 'px-6 py-3 text-lg'
    ]"
  >
    <slot />
  </button>
</template>

<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary'
  },
  size: {
    type: String,
    default: 'md'
  }
})
</script>
```

**After:**
```vue
<!-- components/CustomButton.vue -->
<template>
  <UButton 
    :variant="buttonVariant"
    :color="buttonColor"
    :size="buttonSize"
    :ui="{ button: customButtonClass }"
  >
    <slot />
  </UButton>
</template>

<script setup>
const props = defineProps({
  variant: {
    type: String,
    default: 'primary'
  },
  size: {
    type: String,
    default: 'md'
  }
})

const buttonVariant = computed(() => {
  const variantMap = {
    primary: 'solid',
    secondary: 'outline',
    ghost: 'ghost'
  }
  return variantMap[props.variant] || 'solid'
})

const buttonColor = computed(() => {
  return props.variant === 'primary' ? 'primary' : 'secondary'
})

const buttonSize = computed(() => props.size)

const customButtonClass = computed(() => ({
  base: 'font-medium transition-colors',
  rounded: 'rounded-md'
}))
</script>
```

#### 2. Custom Card Component

**Before:**
```vue
<!-- components/InfoCard.vue -->
<template>
  <div class="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-900">
        {{ title }}
      </h3>
      <div class="text-2xl text-blue-600">
        {{ icon }}
      </div>
    </div>
    <p class="text-gray-600 leading-relaxed">
      {{ description }}
    </p>
  </div>
</template>

<script setup>
defineProps({
  title: String,
  description: String,
  icon: String
})
</script>
```

**After:**
```vue
<!-- components/InfoCard.vue -->
<template>
  <UCard :ui="{ base: customCardClass }">
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-primary">
          {{ title }}
        </h3>
        <div class="text-2xl text-primary">
          {{ icon }}
        </div>
      </div>
    </template>
    
    <p class="text-secondary leading-relaxed">
      {{ description }}
    </p>
  </UCard>
</template>

<script setup>
defineProps({
  title: String,
  description: String,
  icon: String
})

const customCardClass = computed(() => ({
  base: 'bg-surface border-outline shadow-sm',
  header: 'border-b-outline',
  body: 'text-secondary'
}))
</script>
```

#### 3. Custom Modal Component

**Before:**
```vue
<!-- components/ConfirmModal.vue -->
<template>
  <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
      <div class="px-6 py-4 border-b border-gray-200">
        <h2 class="text-xl font-semibold text-gray-900">
          {{ title }}
        </h2>
      </div>
      <div class="px-6 py-4">
        <p class="text-gray-600">
          {{ message }}
        </p>
      </div>
      <div class="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
        <button 
          @click="$emit('cancel')"
          class="px-4 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
        >
          Cancel
        </button>
        <button 
          @click="$emit('confirm')"
          class="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700"
        >
          Confirm
        </button>
      </div>
    </div>
  </div>
</template>
```

**After:**
```vue
<!-- components/ConfirmModal.vue -->
<template>
  <UModal v-model="isOpen" :ui="{ base: customModalClass }">
    <div class="p-6">
      <h2 class="text-xl font-semibold text-primary mb-4">
        {{ title }}
      </h2>
      
      <p class="text-secondary mb-6">
        {{ message }}
      </p>
      
      <div class="flex justify-end space-x-3">
        <UButton 
          variant="outline" 
          color="secondary"
          @click="handleCancel"
        >
          Cancel
        </UButton>
        <UButton 
          variant="solid" 
          color="primary"
          @click="handleConfirm"
        >
          Confirm
        </UButton>
      </div>
    </div>
  </UModal>
</template>

<script setup>
const props = defineProps({
  show: Boolean,
  title: String,
  message: String
})

const emit = defineEmits(['cancel', 'confirm'])

const isOpen = computed({
  get: () => props.show,
  set: (value) => !value && emit('cancel')
})

const customModalClass = computed(() => ({
  base: 'bg-surface border-outline shadow-xl',
  header: 'border-b-outline',
  body: 'text-secondary'
}))

const handleCancel = () => emit('cancel')
const handleConfirm = () => emit('confirm')
</script>
```

## 🎨 Converting Inline Styles to CSS Variables

### Step-by-Step Conversion

#### 1. Identify Hardcoded Colors

**Before:**
```vue
<template>
  <div class="bg-blue-600 text-white border-blue-700">
    <h2 class="text-gray-900">Title</h2>
    <p class="text-gray-600">Description</p>
  </div>
</template>
```

**After:**
```vue
<template>
  <div class="bg-primary text-on-primary border-primary">
    <h2 class="text-on-surface">Title</h2>
    <p class="text-secondary">Description</p>
  </div>
</template>
```

#### 2. Create CSS Variable Mappings

**Create a mapping file:**
```css
/* styles/variable-mappings.css */
:root {
  /* Map old colors to new variables */
  --old-blue-600: var(--md-primary);
  --old-white: var(--md-on-primary);
  --old-blue-700: var(--md-primary);
  --old-gray-900: var(--md-on-surface);
  --old-gray-600: var(--md-secondary);
}
```

#### 3. Update Component Styles

**Before:**
```css
.custom-component {
  background-color: #3b82f6;
  color: #ffffff;
  border: 2px solid #2563eb;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

**After:**
```css
.custom-component {
  background-color: var(--md-primary);
  color: var(--md-on-primary);
  border: 2px solid var(--md-primary);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

#### 4. Handle Dynamic Colors

**Before:**
```vue
<template>
  <div :style="{ backgroundColor: isActive ? '#10b981' : '#ef4444' }">
    Status indicator
  </div>
</template>
```

**After:**
```vue
<template>
  <div :class="statusClass">
    Status indicator
  </div>
</template>

<script setup>
const props = defineProps({
  isActive: Boolean
})

const statusClass = computed(() => ({
  'bg-success text-on-success': props.isActive,
  'bg-error text-on-error': !props.isActive
}))
</script>
```

### Variable Conversion Reference

| Old Pattern | New Variable | Usage |
|-------------|--------------|-------|
| `bg-blue-600` | `bg-primary` | Primary backgrounds |
| `text-white` | `text-on-primary` | Text on primary |
| `bg-gray-100` | `bg-surface` | Surface backgrounds |
| `text-gray-900` | `text-on-surface` | Surface text |
| `border-gray-300` | `border-outline` | Borders |
| `bg-red-500` | `bg-error` | Error backgrounds |
| `text-green-600` | `text-success` | Success text |

## ❌ Deprecated Patterns

### 1. Manual Theme Classes

**Deprecated:**
```html
<div class="theme-light theme-default">
  <button class="btn-primary">Button</button>
</div>
```

**Replacement:**
```html
<div>
  <UButton color="primary">Button</UButton>
</div>
```

### 2. Hardcoded Color Values

**Deprecated:**
```css
.component {
  background-color: #6366f1;
  color: #ffffff;
}
```

**Replacement:**
```css
.component {
  background-color: var(--md-primary);
  color: var(--md-on-primary);
}
```

### 3. Manual Dark Mode Toggles

**Deprecated:**
```typescript
// Manual dark mode handling
const isDark = ref(false)

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
}
```

**Replacement:**
```typescript
// Use theme provider
const { $theme } = useNuxtApp()

function toggleTheme() {
  $theme.toggle()
}
```

### 4. Custom Component Libraries

**Deprecated:**
```vue
<!-- Custom button component -->
<template>
  <button class="custom-btn custom-btn-primary">
    <slot />
  </button>
</template>

<style>
.custom-btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-weight: 500;
}

.custom-btn-primary {
  background-color: #3b82f6;
  color: white;
}
</style>
```

**Replacement:**
```vue
<!-- Use Nuxt UI with theme variants -->
<template>
  <UButton variant="solid" color="primary">
    <slot />
  </UButton>
</template>
```

### 5. Theme-Specific CSS Files

**Deprecated:**
```css
/* themes/dark.css */
body {
  background-color: #1f2937;
  color: #f9fafb;
}

.button {
  background-color: #374151;
  color: #f9fafb;
}
```

**Replacement:**
```css
/* app/theme/your-theme/dark.css */
:root {
  --md-background: #1f2937;
  --md-on-background: #f9fafb;
  --md-surface: #374151;
  --md-on-surface: #f9fafb;
}
```

## 📚 Migration Checklist

### Phase 1: Preparation
- [ ] Backup current theme files
- [ ] Review existing component usage
- [ ] Identify hardcoded colors and styles
- [ ] Plan new theme structure

### Phase 2: File Structure
- [ ] Create new `app/theme/` directory
- [ ] Move existing theme files to new structure
- [ ] Create required `light.css` and `dark.css` files
- [ ] Add optional `main.css` and `theme.ts` files

### Phase 3: Color Variables
- [ ] Convert color variables to Material Design 3 naming
- [ ] Update all CSS custom properties
- [ ] Ensure contrast colors are defined
- [ ] Test color accessibility

### Phase 4: Component Migration
- [ ] Replace custom components with Nuxt UI equivalents
- [ ] Update component props and styling
- [ ] Create theme-specific variants in `theme.ts`
- [ ] Test component functionality

### Phase 5: JavaScript Updates
- [ ] Replace manual theme switching with `$theme` API
- [ ] Update theme-related composables
- [ ] Remove deprecated theme utilities
- [ ] Add TypeScript type definitions

### Phase 6: Testing
- [ ] Test all theme modes (light, dark, high contrast)
- [ ] Verify component styling across themes
- [ ] Check accessibility compliance
- [ ] Test theme switching functionality

### Phase 7: Documentation
- [ ] Update component documentation
- [ ] Create theme-specific README files
- [ ] Document custom variants and overrides
- [ ] Update contribution guidelines

## ❓ FAQ

### Q: Will my existing components still work?
**A:** Yes, but they won't automatically use the new theming system. You'll need to update them to use CSS custom properties and Nuxt UI components for full theme support.

### Q: Do I have to use Nuxt UI components?
**A:** No, but it's highly recommended. Nuxt UI components provide built-in theme support and consistency. You can continue using custom components with CSS variables.

### Q: How do I handle custom colors not in Material Design 3?
**A:** Use the application-specific variables (`--app-*`) in your theme files. These are designed for custom brand colors and special use cases.

### Q: What happens to my existing dark mode implementation?
**A:** The new theme system includes dark mode support. You'll need to migrate your dark mode styles to the new `dark.css` file structure and use the `$theme.toggle()` API.

### Q: Can I still use CSS-in-JS solutions?
**A:** Yes, but you should use CSS custom properties within your CSS-in-JS for theme compatibility. The theme system works best with standard CSS and Tailwind classes.

### Q: How do I handle theme-specific images or assets?
**A:** Use CSS custom properties to reference different images or use conditional rendering based on the active theme. Check the theme provider for the current theme.

### Q: Will this affect my application's performance?
**A:** The new system is designed for better performance with native CSS variables and optimized theme loading. You may see slight improvements in theme switching speed.

### Q: Can I have multiple themes active simultaneously?
**A:** No, only one theme can be active at a time, but you can switch between themes instantly without page reload using the `$theme.switchTheme()` API.

### Q: How do I handle third-party component libraries?
**A:** Override their styles using CSS custom properties or create theme-specific CSS files that target the third-party components with theme-aware colors.

### Q: What if I need help with migration?
**A:** Check the [Theming Documentation](../UI/theming-quickstart.md) for detailed guides, or review the example themes in `app/theme/` for reference implementations.

---

## 🎯 Next Steps

1. **Start Small**: Begin with a single component to test the migration process
2. **Use Example Themes**: Reference the minimal, cyberpunk, and nature themes for patterns
3. **Test Incrementally**: Validate each migration step before proceeding
4. **Get Feedback**: Share migrated components with your team for review
5. **Document Changes**: Keep track of migration decisions for future reference

**🎉 Congratulations!** You're ready to migrate to the new theming system. The improved architecture will provide better maintainability, performance, and user experience.
