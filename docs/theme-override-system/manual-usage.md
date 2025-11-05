# Manual Theme Override Usage

This guide demonstrates how to manually use the theme override system beyond the wrapper components (`ThemeButton`, `ThemeInput`, `ThemeModal`).

## When to Use Manual Overrides

You might want to use manual theme overrides when:
- Creating custom components that need theme awareness
- Implementing complex UI patterns not covered by wrapper components
- Need fine-grained control over override application
- Building reusable component libraries

## Basic Usage

### 1. Import the Composable

```typescript
import { useThemeOverrides } from '~/composables/useThemeOverrides'
```

### 2. Call with Required Parameters

```typescript
const overrides = useThemeOverrides(
  'button',           // component type
  'chat',            // context (optional, defaults to auto-detection)
  {                  // component props
    variant: 'outline',
    size: 'sm'
  },
  {                  // additional options
    state: 'default',
    identifier: 'special-action'  // optional identifier for precise targeting
  }
)
```

### 3. Apply Overrides in Template

```vue
<template>
  <button :class="buttonClasses">
    Themed Button
  </button>
</template>

<script setup>
const buttonClasses = computed(() => {
  const themeClasses = overrides.overrides.value || {}
  return [
    'base-button-classes',
    themeClasses.variant || '',
    themeClasses.size || ''
  ].filter(Boolean)
})
</script>
```

## Advanced Examples

### Context-Specific Overrides

```typescript
// Different overrides for different contexts
const chatButtonOverrides = useThemeOverrides('button', 'chat', props)
const dashboardButtonOverrides = useThemeOverrides('button', 'dashboard', props)
const sidebarButtonOverrides = useThemeOverrides('button', 'sidebar', props)
```

### Identifier-Based Overrides

```typescript
// Use identifier for precise component targeting
const specialActionOverrides = useThemeOverrides('button', 'global', props, {
  identifier: 'special-action'
})

const cancelButtonOverrides = useThemeOverrides('button', 'global', props, {
  identifier: 'cancel-button'
})
```

### State-Based Overrides

```typescript
// Dynamic state changes
const isDisabled = ref(false)
const stateOverrides = useThemeOverrides('button', 'context', props, {
  state: computed(() => isDisabled.value ? 'disabled' : 'default')
})
```

### Props Merging

```typescript
// Manual props that merge with theme overrides
const manualProps = computed(() => ({
  variant: 'outline',
  size: 'lg',
  color: 'secondary'
}))

const overrides = useThemeOverrides('button', 'dashboard', manualProps.value)
```

## Override Resolution Priority

The theme override system follows this priority order:

1. **State-based rules** (highest priority)
2. **Identifier-specific rules** 
3. **Context-specific rules**
4. **Global rules** (lowest priority)

## Creating Reusable Manual Components

Here's a pattern for creating reusable theme-aware components:

```vue
<!-- ThemedCustomCard.vue -->
<template>
  <div :class="cardClasses">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useThemeOverrides } from '~/composables/useThemeOverrides'

interface Props {
  variant?: 'default' | 'elevated' | 'bordered'
  size?: 'sm' | 'md' | 'lg'
  context?: string
  identifier?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'md'
})

const overrides = useThemeOverrides('card', props.context || 'global', {
  variant: props.variant,
  size: props.size
}, {
  identifier: props.identifier
})

const cardClasses = computed(() => {
  const themeClasses = overrides.overrides.value || {}
  return [
    'card-base',
    `card-${themeClasses.variant || props.variant}`,
    `card-${themeClasses.size || props.size}`
  ].filter(Boolean)
})
</script>
```

## Testing Manual Overrides

When testing components with manual theme overrides:

```typescript
import { vi } from 'vitest'

vi.mock('~/composables/useThemeOverrides', () => ({
  useThemeOverrides: vi.fn(() => ({
    overrides: ref({ variant: 'test', size: 'md' }),
    context: ref('test-context')
  }))
}))
```

## Best Practices

1. **Always provide a fallback** when accessing override values
2. **Use computed properties** for reactive override application
3. **Leverage context** for component grouping (chat, dashboard, sidebar)
4. **Use identifiers** for unique component instances
5. **Consider state** for dynamic styling (disabled, loading, error)
6. **Test with mocked overrides** to ensure components work in all themes

## Integration with Theme Config

Manual overrides work with the same theme configuration as wrapper components:

```typescript
// In your theme file (e.g., cyberpunk/theme.ts)
export const cyberpunkTheme: ThemeConfig = {
  componentOverrides: {
    contexts: {
      chat: {
        button: {
          variant: 'neon',
          size: 'sm'
        }
      }
    },
    identifiers: {
      'special-action': {
        button: {
          variant: 'glowing',
          color: 'accent'
        }
      }
    },
    states: {
      disabled: {
        button: {
          opacity: 0.5,
          cursor: 'not-allowed'
        }
      }
    }
  }
}
```

## Performance Considerations

- Override resolution is optimized and cached
- Use computed properties to avoid recalculating classes
- Context detection is fast and uses DOM queries efficiently
- Identifier lookups are O(1) hash table operations

## Troubleshooting

### Overrides Not Applying
1. Check that the component type matches your theme config
2. Verify context is correctly detected or provided
3. Ensure theme is properly loaded and active
4. Check for CSS specificity conflicts

### Performance Issues
1. Avoid creating many override instances in loops
2. Use computed properties for class calculations
3. Memoize complex prop calculations

### Hydration Mismatches
1. Provide explicit context during SSR
2. Use the same context on server and client
3. Test with different theme modes
