# Quick Start: Create Your First Theme

Get started with OR3's refined theme system in under 30 minutes. This guide walks you through creating a custom theme from scratch.

## Prerequisites

- OR3 development environment set up
- Basic understanding of Material Design color tokens
- Familiarity with CSS selectors

## Create a New Theme

Use the CLI to scaffold a new theme:

```bash
bun run theme:create
```

Follow the prompts:
- **Theme name**: `my-theme` (kebab-case, alphanumeric + hyphens)
- **Display name**: `My Custom Theme` (human-readable)
- **Description**: Brief description of your theme

This creates:
```
app/theme/my-theme/
  ├── theme.ts      # Theme definition
  └── styles.css    # Optional custom styles
```

## Define Your Theme

Open `app/theme/my-theme/theme.ts`:

```typescript
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
    name: 'my-theme',
    displayName: 'My Custom Theme',
    description: 'A custom theme with vibrant colors',
    
    // Material Design 3 color palette
    colors: {
        primary: '#6366f1',      // Indigo
        onPrimary: '#ffffff',
        secondary: '#ec4899',     // Pink
        onSecondary: '#ffffff',
        surface: '#ffffff',
        onSurface: '#1f2937',
        
        // Optional: Auto-calculated if omitted
        primaryContainer: '#e0e7ff',
        secondaryContainer: '#fce7f3',
        
        // App-specific
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        
        // Dark mode (optional)
        dark: {
            primary: '#818cf8',
            surface: '#1f2937',
            onSurface: '#f9fafb',
        }
    },
    
    // Component overrides (optional)
    overrides: {
        // Global button style
        'button': {
            variant: 'solid',
            class: 'rounded-lg shadow-sm'
        },
        
        // Context-specific: buttons in chat
        'button.chat': {
            variant: 'ghost',
            color: 'primary'
        },
        
        // Identifier-specific: send button
        'button#chat.send': {
            variant: 'solid',
            color: 'primary',
            size: 'lg'
        }
    }
});
```

## CSS Selector Syntax

The refined theme system uses intuitive CSS-like selectors:

### Basic Selectors

```typescript
overrides: {
    'button': { /* Applies to ALL buttons */ },
    'input': { /* Applies to ALL inputs */ },
}
```

### Context Selectors

Use `.context` to target components in specific areas:

```typescript
overrides: {
    'button.chat': { /* Buttons in chat area */ },
    'button.sidebar': { /* Buttons in sidebar */ },
    'input.dashboard': { /* Inputs in dashboard */ },
}
```

Available contexts: `chat`, `sidebar`, `dashboard`, `header`, `global`

### Identifier Selectors

Use `#identifier` for specific components:

```typescript
overrides: {
    'button#chat.send': { /* The send button */ },
    'button#sidebar.new-chat': { /* New chat button */ },
}
```

### State Selectors

Use `:state` for hover, active, etc:

```typescript
overrides: {
    'button:hover': { /* Hovered buttons */ },
    'input:focus': { /* Focused inputs */ },
}
```

### Attribute Selectors

Use `[attr="value"]` for HTML attributes:

```typescript
overrides: {
    'button[type="submit"]': { /* Submit buttons */ },
    'input[required]': { /* Required inputs */ },
}
```

### Combined Selectors

Combine for precise targeting:

```typescript
overrides: {
    'button.chat#send:hover[type="submit"]': {
        variant: 'solid',
        color: 'success',
        class: 'scale-105 transition-transform'
    }
}
```

## Specificity Rules

More specific selectors override less specific ones:

1. **Element**: `button` (specificity: 1)
2. **Context**: `button.chat` (specificity: 11)
3. **Identifier**: `button#send` (specificity: 21)
4. **State**: `button:hover` (specificity: 11)
5. **Attribute**: `button[type="submit"]` (specificity: 11)

Higher specificity always wins!

## Override Props

Available props depend on the component:

### Nuxt UI Components (UButton, UInput, etc.)

Props are passed directly:

```typescript
{
    variant: 'solid' | 'outline' | 'ghost' | 'soft' | 'link',
    color: 'primary' | 'secondary' | 'success' | 'error' | 'warning',
    size: 'xs' | 'sm' | 'md' | 'lg' | 'xl',
    class: 'additional-classes',
    ui: { /* Nuxt UI config object */ }
}
```

### All Components

These always work:

```typescript
{
    class: 'tailwind-classes here',
    style: { color: 'red', fontSize: '14px' }
}
```

## Test Your Theme

### 1. Validate Theme

Check for errors:

```bash
bun run theme:validate my-theme
```

This reports:
- Missing required colors
- Invalid selectors
- Specificity conflicts
- Type errors

### 2. Switch to Your Theme

```bash
bun run theme:switch
```

Select your theme from the list.

### 3. Test in Browser

Start the dev server:

```bash
bun run dev
```

Visit `http://localhost:3000/theme-demo` to see your theme applied to various components.

## Apply Theme to Components

The refined theme system automatically applies overrides via the `v-theme` directive:

```vue
<template>
    <!-- Auto-detect context -->
    <UButton v-theme>Click Me</UButton>
    
    <!-- Explicit identifier -->
    <UButton v-theme="'chat.send'">Send</UButton>
    
    <!-- Full control -->
    <UButton v-theme="{ identifier: 'chat.send', theme: 'my-theme' }">
        Send
    </UButton>
</template>
```

## Next Steps

- **Customize further**: Add more overrides for specific components
- **Read API Reference**: Learn about all available options
- **Check Best Practices**: Optimize your theme for performance
- **Share your theme**: Submit a PR to the theme gallery

## Quick Troubleshooting

### Theme not applying?

1. Check validation: `bun run theme:validate my-theme`
2. Verify theme is active: Check `localStorage.getItem('activeTheme')`
3. Check browser console for warnings

### Colors look wrong?

- Ensure all required colors are defined: `primary`, `secondary`, `surface`
- Check contrast: use Material Design 3 guidelines
- Test both light and dark modes

### Overrides not working?

- Check selector specificity (use Chrome DevTools)
- Verify component has `v-theme` directive
- Check if explicit props override theme defaults

## Example: Complete Theme

```typescript
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
    name: 'ocean',
    displayName: 'Ocean Blue',
    description: 'A calm, ocean-inspired theme',
    
    colors: {
        primary: '#0ea5e9',
        onPrimary: '#ffffff',
        secondary: '#06b6d4',
        onSecondary: '#ffffff',
        surface: '#f0f9ff',
        onSurface: '#0c4a6e',
        
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        
        dark: {
            primary: '#38bdf8',
            surface: '#0c4a6e',
            onSurface: '#f0f9ff',
        }
    },
    
    overrides: {
        'button': {
            variant: 'soft',
            class: 'rounded-full'
        },
        'button.chat': {
            variant: 'ghost'
        },
        'button#chat.send': {
            variant: 'solid',
            color: 'primary',
            class: 'shadow-lg'
        },
        'input': {
            class: 'border-2 focus:border-primary'
        }
    }
});
```

Congratulations! You've created your first OR3 theme. 🎨
