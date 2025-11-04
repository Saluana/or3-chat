# Component Override System

Learn how to customize Nuxt UI components through theme-specific configuration. This guide covers the `theme.ts` file structure, customization patterns, and practical examples.

## 📁 theme.ts File Structure

The `theme.ts` file in your theme directory defines component-specific overrides and custom variants for Nuxt UI components.

### Basic Structure

```typescript
// app/theme/my-theme/theme.ts
export default defineAppConfig({
  ui: {
    // Component overrides go here
    button: { /* button configuration */ },
    input: { /* input configuration */ },
    modal: { /* modal configuration */ },
    tooltip: { /* tooltip configuration */ },
    // ... other components
  }
})
```

### File Purpose

- **Component Configuration**: Define default props, sizes, colors for components
- **Custom Variants**: Create new component variants (retro, minimal, etc.)
- **Theme Integration**: Connect components to your CSS custom properties
- **Consistency**: Ensure consistent styling across the application

## 🎨 Button Component Overrides

### Basic Button Configuration

```typescript
// app/theme/my-theme/theme.ts
export default defineAppConfig({
  ui: {
    button: {
      // Default button props
      size: 'md',
      color: 'primary',
      variant: 'solid',
      
      // Size definitions
      size: {
        xs: {
          class: 'text-xs px-2 py-1 rounded'
        },
        sm: {
          class: 'text-sm px-3 py-1.5 rounded'
        },
        md: {
          class: 'text-sm px-4 py-2 rounded-md'
        },
        lg: {
          class: 'text-base px-6 py-3 rounded-lg'
        },
        xl: {
          class: 'text-lg px-8 py-4 rounded-xl'
        }
      },
      
      // Color variants
      color: {
        primary: {
          solid: 'bg-primary text-on-primary hover:bg-primary-container',
          outline: 'border border-primary text-primary hover:bg-primary hover:text-on-primary',
          ghost: 'text-primary hover:bg-primary-container',
          soft: 'bg-primary-container text-primary hover:bg-primary'
        },
        secondary: {
          solid: 'bg-secondary text-on-secondary hover:bg-secondary-container',
          outline: 'border border-secondary text-secondary hover:bg-secondary hover:text-on-secondary',
          ghost: 'text-secondary hover:bg-secondary-container',
          soft: 'bg-secondary-container text-secondary hover:bg-secondary'
        }
      },
      
      // Custom variants
      variant: {
        retro: {
          class: 'retro-btn border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all font-bold'
        },
        minimal: {
          class: 'border-0 bg-transparent text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors'
        },
        pill: {
          class: 'rounded-full px-6 py-2 font-medium'
        }
      }
    }
  }
})
```

### Using Custom Button Variants

```vue
<template>
  <!-- Retro button with custom styling -->
  <UButton variant="retro" color="primary" size="lg">
    Retro Action
  </UButton>
  
  <!-- Minimal button for subtle actions -->
  <UButton variant="minimal" color="secondary">
    Cancel
  </UButton>
  
  <!-- Pill-shaped button -->
  <UButton variant="pill" color="primary">
    Get Started
  </UButton>
</template>
```

## 📝 Input Component Overrides

### Input Configuration

```typescript
// app/theme/my-theme/theme.ts
export default defineAppConfig({
  ui: {
    input: {
      // Default input props
      size: 'md',
      variant: 'outline',
      
      // Size definitions
      size: {
        sm: {
          class: 'text-sm px-3 py-1.5 rounded'
        },
        md: {
          class: 'text-sm px-4 py-2 rounded-md'
        },
        lg: {
          class: 'text-base px-4 py-3 rounded-lg'
        }
      },
      
      // Variants
      variant: {
        outline: {
          class: 'border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] transition-all bg-surface text-on-surface placeholder:text-muted focus:border-primary focus:outline-none'
        },
        retro: {
          class: 'retro-input border-2 border-black bg-surface text-on-surface font-mono text-lg px-4 py-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] transition-all focus:border-primary focus:outline-none'
        },
        minimal: {
          class: 'border-0 border-b-2 border-transparent bg-transparent text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors'
        }
      },
      
      // Icon configuration
      icon: {
        leading: {
          class: 'ml-4'
        },
        trailing: {
          class: 'mr-4'
        }
      }
    }
  }
})
```

### Using Custom Input Variants

```vue
<template>
  <!-- Retro-styled input -->
  <UInput 
    variant="retro" 
    placeholder="Enter your name..."
    icon="i-heroicons-user"
  />
  
  <!-- Minimal input for subtle forms -->
  <UInput 
    variant="minimal" 
    placeholder="Search..."
    icon="i-heroicons-magnifying-glass"
  />
  
  <!-- Standard outline input -->
  <UInput 
    variant="outline" 
    placeholder="Email address"
    type="email"
  />
</template>
```

## 🪟 Modal Component Overrides

### Modal Configuration

```typescript
// app/theme/my-theme/theme.ts
export default defineAppConfig({
  ui: {
    modal: {
      // Modal container
      container: {
        base: 'relative z-50',
        padding: 'p-4',
        rounded: 'rounded-lg'
      },
      
      // Modal overlay
      overlay: {
        base: 'fixed inset-0 z-50 transition-opacity',
        background: 'bg-black/80'
      },
      
      // Modal content
      base: {
        background: 'bg-surface border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]',
        rounded: 'rounded-lg',
        divide: 'divide-y divide-outline',
        width: 'w-full max-w-lg',
        height: 'h-auto',
        padding: 'p-0'
      },
      
      // Modal header
      header: {
        base: 'flex items-center justify-between px-6 py-4 border-b border-outline',
        padding: 'px-6 py-4',
        background: 'bg-surface',
        rounded: 'rounded-t-lg'
      },
      
      // Modal body
      body: {
        base: 'px-6 py-4 text-on-surface',
        background: 'bg-surface',
        padding: 'px-6 py-4'
      },
      
      // Modal footer
      footer: {
        base: 'flex items-center justify-end gap-3 px-6 py-4 border-t border-outline bg-surface',
        background: 'bg-surface',
        rounded: 'rounded-b-lg',
        padding: 'px-6 py-4'
      }
    }
  }
})
```

### Using Custom Modal

```vue
<template>
  <UModal :ui="{ container: { rounded: 'rounded-none' } }">
    <div class="p-6">
      <h3 class="text-lg font-bold text-on-surface mb-4">
        Custom Modal
      </h3>
      <p class="text-on-surface mb-6">
        This modal uses custom theming with retro styling.
      </p>
      <div class="flex justify-end gap-3">
        <UButton variant="outline" @click="close">
          Cancel
        </UButton>
        <UButton variant="retro" @click="confirm">
          Confirm
        </UButton>
      </div>
    </div>
  </UModal>
</template>
```

## 💬 Tooltip Component Overrides

### Tooltip Configuration

```typescript
// app/theme/my-theme/theme.ts
export default defineAppConfig({
  ui: {
    tooltip: {
      // Tooltip container
      container: {
        base: 'relative inline-block',
        rounded: 'rounded',
        width: 'w-auto'
      },
      
      // Tooltip content
      base: {
        background: 'bg-inverse-surface text-inverse-on-surface',
        color: 'text-inverse-on-surface',
        rounded: 'rounded-md',
        font: 'font-medium text-sm',
        shadow: 'shadow-lg',
        border: 'border border-outline',
        padding: 'px-3 py-2',
        width: 'max-w-xs',
        transition: 'transition-all duration-200'
      },
      
      // Tooltip arrow
      arrow: {
        base: 'before:absolute before:z-10 before:h-2 before:w-2 before:rotate-45',
        background: 'before:bg-inverse-surface before:border before:border-outline',
        placement: {
          top: 'before:-bottom-1 before:left-1/2 before:-translate-x-1/2',
          bottom: 'before:-top-1 before:left-1/2 before:-translate-x-1/2',
          left: 'before:-right-1 before:top-1/2 before:-translate-y-1/2',
          right: 'before:-left-1 before:top-1/2 before:-translate-y-1/2'
        }
      }
    }
  }
})
```

### Using Custom Tooltip

```vue
<template>
  <UTooltip text="This is a custom styled tooltip">
    <UButton variant="outline">
      Hover me
    </UButton>
  </UTooltip>
  
  <UTooltip 
    text="Tooltip with custom placement" 
    placement="bottom"
  >
    <UButton variant="retro">
      Bottom tooltip
    </UButton>
  </UTooltip>
</template>
```

## 🔄 Slot-Based vs Variant-Based Customization

### Variant-Based Customization

Variant-based customization defines reusable styling variants that can be applied to any component instance.

```typescript
// theme.ts - Variant-based
export default defineAppConfig({
  ui: {
    button: {
      variant: {
        retro: {
          class: 'border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
        },
        minimal: {
          class: 'border-0 bg-transparent'
        }
      }
    }
  }
})
```

**Usage:**
```vue
<template>
  <!-- Apply predefined variants -->
  <UButton variant="retro">Retro Button</UButton>
  <UButton variant="minimal">Minimal Button</UButton>
</template>
```

### Slot-Based Customization

Slot-based customization uses component slots to override specific parts of a component.

```vue
<template>
  <!-- Slot-based customization -->
  <UCard>
    <template #header>
      <div class="custom-header-style">
        Custom Header Content
      </div>
    </template>
    
    <template #body>
      <div class="custom-body-style">
        Custom Body Content
      </div>
    </template>
    
    <template #footer>
      <div class="custom-footer-style">
        Custom Footer Content
      </div>
    </template>
  </UCard>
</template>

<style scoped>
.custom-header-style {
  background: var(--md-primary);
  color: var(--md-on-primary);
  padding: 1rem;
  font-weight: bold;
}

.custom-body-style {
  background: var(--md-surface);
  color: var(--md-on-surface);
  padding: 1rem;
}

.custom-footer-style {
  background: var(--md-surface-variant);
  color: var(--md-on-surface-variant);
  padding: 1rem;
  border-top: 1px solid var(--md-outline);
}
</style>
```

### When to Use Each Approach

| Approach | Best For | Pros | Cons |
|----------|----------|------|------|
| **Variant-Based** | Consistent styling patterns | Reusable, maintainable, theme-integrated | Limited to predefined options |
| **Slot-Based** | Unique layouts, complex content | Full control, flexible | More verbose, less reusable |

## 🎯 Advanced Component Examples

### Custom Card Component

```typescript
// theme.ts
export default defineAppConfig({
  ui: {
    card: {
      base: {
        background: 'bg-surface border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]',
        rounded: 'rounded-lg',
        divide: 'divide-y divide-outline',
        padding: 'p-0'
      },
      header: {
        background: 'bg-surface-variant',
        padding: 'px-6 py-4',
        rounded: 'rounded-t-lg border-b border-outline'
      },
      body: {
        padding: 'px-6 py-4'
      },
      footer: {
        background: 'bg-surface',
        padding: 'px-6 py-4 rounded-b-lg border-t border-outline'
      }
    }
  }
})
```

### Custom Alert Component

```typescript
// theme.ts
export default defineAppConfig({
  ui: {
    alert: {
      variant: {
        retro: {
          class: 'border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] p-4 rounded-md',
          icon: {
            base: 'w-6 h-6 mr-3 flex-shrink-0'
          },
          title: 'font-bold text-lg mb-1',
          description: 'text-sm leading-relaxed'
        },
        minimal: {
          class: 'border-l-4 border-primary bg-primary-container p-3 rounded-r',
          icon: {
            base: 'w-5 h-5 mr-2 flex-shrink-0'
          },
          title: 'font-medium text-base mb-0',
          description: 'text-sm leading-relaxed'
        }
      }
    }
  }
})
```

## 🔗 Nuxt UI Component Documentation

For complete API reference and all available configuration options:

### Official Documentation
- **Nuxt UI Documentation**: [https://ui.nuxt.com/](https://ui.nuxt.com/)
- **Component API**: [https://ui.nuxt.com/components/button](https://ui.nuxt.com/components/button)
- **Theming Guide**: [https://ui.nuxt.com/getting-started/theming](https://ui.nuxt.com/getting-started/theming)

### Available Components
- `UButton` - Button component with variants
- `UInput` - Form input with validation
- `UModal` - Modal/dialog overlay
- `UTooltip` - Tooltip/popover component
- `UCard` - Card container component
- `UAlert` - Alert/notification component
- `UBadge` - Small status indicators
- `UAvatar` - User avatar component
- `UDropdown` - Dropdown menu component
- `UTabs` - Tab navigation component

## 🔧 Troubleshooting

### Common Errors and Solutions

#### 1. Component Not Using Custom Styles

**Error**: Custom variant not applying to component

**Solution**: 
```typescript
// Ensure theme.ts exports default with ui property
export default defineAppConfig({
  ui: { /* your config */ }
})

// Restart dev server after changes
```

#### 2. CSS Variables Not Working

**Error**: CSS custom properties not resolving in component styles

**Solution**:
```css
/* Use correct variable names from your theme */
.custom-class {
  /* ✅ Correct */
  background-color: var(--md-primary);
  
  /* ❌ Wrong - variable doesn't exist */
  background-color: var(--primary-color);
}
```

#### 3. Variant Conflicts

**Error**: Multiple variants conflicting or overriding each other

**Solution**:
```typescript
// Use specific class targeting
variant: {
  retro: {
    class: 'retro-btn border-2 border-black', // Base styles
    color: {
      primary: 'bg-primary text-on-primary',   // Color-specific
      secondary: 'bg-secondary text-on-secondary'
    }
  }
}
```

#### 4. TypeScript Errors

**Error**: TypeScript not recognizing custom component props

**Solution**:
```typescript
// Add type definitions for your theme
interface ThemeConfig {
  ui: {
    button: {
      variant: {
        retro: {
          class: string;
        }
      }
    }
  }
}

declare module '#app' {
  interface NuxtApp {
    $theme: ThemeConfig;
  }
}
```

### Debugging Tips

1. **Use Browser DevTools**: Inspect generated CSS classes and variables
2. **Check Theme Loading**: Verify your theme is active in Dashboard → Theme Selector
3. **Restart Development Server**: Some changes require server restart
4. **Check Console**: Look for CSS parsing errors or missing variable warnings

### Performance Considerations

- **Avoid Complex Selectors**: Keep CSS classes simple and performant
- **Use CSS Variables**: Leverage browser's native variable system
- **Minimize Overrides**: Only override what you need to change
- **Test Across Variants**: Ensure all color modes work correctly

---

**📚 Related Documentation:**
- [Theming Quick Start](./theming-quickstart.md) - Create your first theme
- [CSS Variables Reference](./css-variables-reference.md) - Complete variable documentation
- [Nuxt UI Documentation](https://ui.nuxt.com/) - Official component documentation

**🎯 Next Steps:**
1. Create your `theme.ts` file with component overrides
2. Test custom variants in your components
3. Refactor existing components to use theme-consistent styling
4. Share your theme variants with the team for consistency
