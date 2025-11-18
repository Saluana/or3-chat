# Migration Guide: Old → Refined Theme System

Step-by-step guide to migrate from OR3's old theme system to the refined system.

## Overview

The refined theme system introduces:
- **Type-safe theme definitions** with `defineTheme()`
- **CSS-like selector syntax** for component overrides
- **Automatic prop resolution** via `v-theme` directive
- **Build-time validation** and compilation
- **<1ms runtime performance**

## Migration Strategy

### Timeline

**Phase 1: Preparation** (1 hour)
- Audit existing themes and component styles
- Identify hard-coded props to extract

**Phase 2: Theme Creation** (2-3 hours)
- Create refined theme definitions
- Map colors and overrides

**Phase 3: Component Updates** (3-4 hours)
- Add `v-theme` directives
- Remove hard-coded props

**Phase 4: Testing** (2 hours)
- Validate themes
- Test theme switching
- Verify visual consistency

**Total: 8-10 hours** for average-sized projects

---

## Step 1: Audit Current Themes

### Identify Theme Files

Old system typically has:
```
app/theme/
  ├── colors.css         # CSS variables
  ├── light.css          # Light mode
  ├── dark.css           # Dark mode
  └── custom-overrides.css
```

### Extract Color Values

1. Open your theme CSS files
2. Note all color values and their variable names
3. Map to Material Design 3 tokens

**Example mapping:**

| Old Variable | MD3 Token | Hex Value |
|-------------|-----------|-----------|
| `--color-primary` | `primary` | `#6366f1` |
| `--color-primary-text` | `onPrimary` | `#ffffff` |
| `--color-secondary` | `secondary` | `#ec4899` |
| `--color-bg` | `surface` | `#ffffff` |
| `--color-text` | `onSurface` | `#1f2937` |

### Identify Component Overrides

Search your codebase for hard-coded props:

```bash
# Find all variant props
grep -r 'variant=' app/components/

# Find all color props
grep -r 'color=' app/components/

# Find all size props
grep -r 'size=' app/components/
```

Document these patterns—you'll extract them to theme overrides.

---

## Step 2: Create Refined Theme Definition

### Generate Theme Scaffold

```bash
bun run theme:create
```

Enter:
- **Name**: `my-theme` (match your old theme name)
- **Display name**: `My Theme`
- **Description**: Brief description

### Define Colors

Open `app/theme/my-theme/theme.ts`:

```typescript
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
    name: 'my-theme',
    displayName: 'My Theme',
    description: 'Migrated from old theme system',
    
    colors: {
        // Map your old colors here
        primary: '#6366f1',      // --color-primary
        onPrimary: '#ffffff',    // --color-primary-text
        secondary: '#ec4899',    // --color-secondary
        onSecondary: '#ffffff',  // --color-secondary-text
        surface: '#ffffff',      // --color-bg
        onSurface: '#1f2937',    // --color-text
        
        // App-specific
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        
        // Dark mode (if you had dark.css)
        dark: {
            primary: '#818cf8',
            surface: '#1f2937',
            onSurface: '#f9fafb',
        }
    }
});
```

### Add Component Overrides

Extract hard-coded props from components and centralize them:

**Before (in component):**
```vue
<UButton variant="solid" color="primary" size="lg">Send</UButton>
```

**After (in theme):**
```typescript
export default defineTheme({
    // ... colors ...
    
    overrides: {
        // Global button style
        'button': {
            variant: 'solid'
        },
        
        // Chat send button
        'button#chat.send': {
            variant: 'solid',
            color: 'primary',
            size: 'lg'
        }
    }
});
```

**Component becomes:**
```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

---

## Step 3: Update Components

### Add v-theme Directive

#### Pattern 1: Global Components

For components with **no specific styling needs**:

**Before:**
```vue
<UButton>Click Me</UButton>
```

**After:**
```vue
<UButton v-theme>Click Me</UButton>
```

The directive auto-detects context and applies theme defaults.

#### Pattern 2: Context-Specific Components

For components **in specific areas** (chat, sidebar, etc.):

**Before:**
```vue
<UButton variant="ghost" color="gray">
    New Chat
</UButton>
```

**After (theme):**
```typescript
overrides: {
    'button.sidebar': {
        variant: 'ghost',
        color: 'gray'
    }
}
```

**After (component):**
```vue
<UButton v-theme>New Chat</UButton>
```

Context is auto-detected from route or parent.

#### Pattern 3: Specific Components

For **unique components** (send button, delete button):

**Before:**
```vue
<UButton variant="solid" color="primary" size="lg">
    Send
</UButton>
```

**After (theme):**
```typescript
overrides: {
    'button#chat.send': {
        variant: 'solid',
        color: 'primary',
        size: 'lg'
    }
}
```

**After (component):**
```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

#### Pattern 4: Conditional Overrides

If props are **dynamic**, keep them explicit:

**Keep this pattern:**
```vue
<UButton 
    v-theme="'chat.send'"
    :disabled="!message.length"
    :loading="isSending"
>
    Send
</UButton>
```

Theme applies base props; explicit props override.

### Remove Hard-Coded Props

After adding `v-theme`, remove hard-coded props **covered by theme**:

**Before:**
```vue
<UButton variant="solid" color="primary" size="lg" v-theme="'chat.send'">
    Send
</UButton>
```

**After:**
```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

**Keep dynamic props:**
```vue
<UButton v-theme="'chat.send'" :disabled="!canSend">Send</UButton>
```

---

## Step 4: Migrate CSS Variables

### Replace Direct CSS Usage

**Old approach:**
```vue
<style>
.my-component {
    background: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-primary);
}
</style>
```

**Refined approach:**

Use **Material Design tokens** from theme:
```vue
<style>
.my-component {
    background: rgb(var(--md-surface));
    color: rgb(var(--md-on-surface));
    border: 1px solid rgb(var(--md-primary));
}
</style>
```

Tokens are automatically set from your theme's colors.

### Nuxt UI Integration

For **Nuxt UI components**, use Tailwind classes:

```vue
<UCard class="bg-surface text-on-surface border-primary">
    <!-- Content -->
</UCard>
```

Tailwind automatically uses MD3 tokens via the theme plugin.

---

## Step 5: Testing

### 1. Validate Theme

```bash
bun run theme:validate my-theme
```

Fix any errors reported:
- Missing required colors
- Invalid selector syntax
- Specificity conflicts

### 2. Switch to New Theme

```bash
bun run theme:switch
```

Select your migrated theme.

### 3. Visual Regression Testing

**Manual testing:**
1. Start dev server: `bun run dev`
2. Visit all major pages
3. Check each component matches old appearance
4. Test light/dark mode switching
5. Verify hover/focus states

**Screenshot comparison:**

If you have Playwright tests:
```bash
# Baseline with old theme
bunx playwright test --project=chromium --update-snapshots

# Switch to refined theme
bun run theme:switch

# Compare
bunx playwright test --project=chromium
```

### 4. Performance Testing

Refined system should be **faster**:

**Before migration:**
```bash
bun run dev
# Note: Time to Interactive in Chrome DevTools
```

**After migration:**
```bash
bun run dev
# Compare: Should see 10-20% improvement in component render time
```

---

## Step 6: Cleanup

### Remove Old Theme Files

Once migration is validated:

```bash
# Remove old CSS files
rm app/theme/colors.css
rm app/theme/light.css
rm app/theme/dark.css
rm app/theme/custom-overrides.css
```

### Update Imports

Search for old theme imports:

```bash
grep -r '@/theme/colors.css' app/
```

Remove or update them.

### Update nuxt.config.ts

Remove old theme CSS imports:

**Before:**
```typescript
export default defineNuxtConfig({
    css: [
        '@/theme/colors.css',
        '@/theme/light.css',
        '@/theme/dark.css',
    ]
});
```

**After:**
```typescript
export default defineNuxtConfig({
    // Refined theme system auto-imports
    css: [
        '@/assets/css/main.css'
    ]
});
```

---

## Common Migration Patterns

### Pattern: Button Variants

**Old:**
```vue
<template>
    <UButton variant="solid">Primary</UButton>
    <UButton variant="outline">Secondary</UButton>
    <UButton variant="ghost">Tertiary</UButton>
</template>
```

**New (theme):**
```typescript
overrides: {
    'button#primary': { variant: 'solid' },
    'button#secondary': { variant: 'outline' },
    'button#tertiary': { variant: 'ghost' }
}
```

**New (component):**
```vue
<template>
    <UButton v-theme="'primary'">Primary</UButton>
    <UButton v-theme="'secondary'">Secondary</UButton>
    <UButton v-theme="'tertiary'">Tertiary</UButton>
</template>
```

### Pattern: Context-Based Styling

**Old:**
```vue
<!-- In ChatView.vue -->
<UButton variant="ghost" color="gray">...</UButton>

<!-- In Sidebar.vue -->
<UButton variant="ghost" color="gray">...</UButton>
```

**New (theme):**
```typescript
overrides: {
    'button.chat': { variant: 'ghost', color: 'gray' },
    'button.sidebar': { variant: 'ghost', color: 'gray' }
}
```

**New (components):**
```vue
<!-- Both components -->
<UButton v-theme>...</UButton>
```

Context is auto-detected!

### Pattern: Size Consistency

**Old:**
```vue
<!-- Scattered sizes across components -->
<UButton size="lg">Send</UButton>
<UButton size="md">Cancel</UButton>
<UButton size="sm">Close</UButton>
```

**New (theme):**
```typescript
overrides: {
    'button': { size: 'md' },          // Default
    'button#chat.send': { size: 'lg' }, // Large for primary actions
    'button.modal': { size: 'sm' }      // Small in modals
}
```

**New (components):**
```vue
<UButton v-theme="'chat.send'">Send</UButton>
<UButton v-theme>Cancel</UButton>
<UButton v-theme>Close</UButton>
```

### Pattern: State-Based Styling

**Old:**
```vue
<UButton 
    :variant="isActive ? 'solid' : 'outline'"
    :color="isActive ? 'primary' : 'gray'"
>
    {{ label }}
</UButton>
```

**New:**

Keep dynamic logic; theme provides base:

```typescript
overrides: {
    'button.tab': { variant: 'outline', color: 'gray' },
    'button.tab:active': { variant: 'solid', color: 'primary' }
}
```

```vue
<UButton 
    v-theme="isActive ? 'tab:active' : 'tab'"
>
    {{ label }}
</UButton>
```

Or use explicit props for complex logic:

```vue
<UButton 
    v-theme="'tab'"
    :variant="isActive ? 'solid' : 'outline'"
    :color="isActive ? 'primary' : 'gray'"
>
    {{ label }}
</UButton>
```

---

## Troubleshooting

### Theme not applying?

**Check:**
1. Did you run `bun run theme:compile`?
2. Is theme active? `localStorage.getItem('activeTheme')`
3. Does component have `v-theme` directive?
4. Any console errors?

**Fix:**
```bash
# Recompile themes
bun run theme:compile

# Restart dev server
bun run dev
```

### Colors don't match old theme?

**Check:**
1. Did you map all colors correctly?
2. Are RGB values correct (no typos)?
3. Did you define `dark` overrides?

**Debug:**
```typescript
// In browser console
const theme = document.documentElement.dataset.theme;
console.log('Active theme:', theme);

// Check CSS variables
const primary = getComputedStyle(document.documentElement)
    .getPropertyValue('--md-primary');
console.log('Primary color:', primary);
```

### Overrides not working?

**Check:**
1. Selector syntax correct?
2. Context matches component location?
3. Specificity conflict?

**Debug:**
```bash
# Validate theme
bun run theme:validate my-theme

# Check specificity
# In browser console (with component selected in DevTools):
const resolver = window.$nuxt.$theme.resolver;
const props = resolver.resolve('button', 'chat', 'send');
console.log('Resolved props:', props);
```

### Performance degraded?

**Check:**
1. Are you creating new resolver instances per component?
2. Too many overrides (>200)?
3. Complex selectors with many attributes?

**Optimize:**
```typescript
// Bad: New resolver per component
const resolver = new RuntimeResolver(overrides);

// Good: Reuse from theme plugin
const resolver = useRuntimeResolver();
```

---

## Migration Checklist

- [ ] Audited old themes and extracted colors
- [ ] Mapped colors to Material Design 3 tokens
- [ ] Created refined theme with `bun run theme:create`
- [ ] Defined all colors in theme.ts
- [ ] Extracted component overrides to theme
- [ ] Added `v-theme` directives to components
- [ ] Removed hard-coded props covered by theme
- [ ] Replaced CSS variables with MD3 tokens
- [ ] Validated theme with `bun run theme:validate`
- [ ] Tested theme switching
- [ ] Performed visual regression testing
- [ ] Removed old theme CSS files
- [ ] Updated nuxt.config.ts
- [ ] Committed changes

Congratulations! Your migration is complete. 🎉

---

## Next Steps

- **Explore advanced features**: State selectors, attribute matching
- **Optimize further**: Review [Best Practices](./best-practices.md)
- **Create variants**: Add high-contrast, compact, or seasonal themes
- **Share your theme**: Submit to OR3 theme gallery

## Need Help?

- **Troubleshooting**: See [Troubleshooting Guide](./troubleshooting.md)
- **API Details**: Check [API Reference](./api-reference.md)
- **Community**: Ask in OR3 Discord or GitHub Discussions
