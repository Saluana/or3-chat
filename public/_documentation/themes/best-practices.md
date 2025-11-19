# Best Practices: Refined Theme System

Performance, maintainability, and scalability guidelines for OR3 themes.

## Core Principles

1. **DRY (Don't Repeat Yourself)**: Centralize styling in themes, not components
2. **Performance First**: Minimize runtime overhead
3. **Type Safety**: Leverage TypeScript for compile-time validation
4. **Semantic Naming**: Use descriptive, consistent identifiers
5. **Testability**: Make themes easy to validate and test

---

## Naming Conventions

### Theme Names

**Use kebab-case** for theme identifiers:

✅ **Good:**

```typescript
name: 'ocean-blue';
name: 'high-contrast-dark';
name: 'retro-green';
```

❌ **Bad:**

```typescript
name: 'OceanBlue'; // PascalCase
name: 'ocean_blue'; // snake_case
name: 'ocean blue'; // spaces
```

### Component Identifiers

**Use semantic, descriptive names:**

✅ **Good:**

```typescript
'button#chat.send';
'button#sidebar.new-chat';
'input#search.global';
'button#modal.confirm';
```

❌ **Bad:**

```typescript
'button#btn1'; // Generic
'button#x'; // Cryptic
'button#sendMessage'; // Too verbose (camelCase)
```

**Naming patterns:**

-   **Actions**: `send`, `cancel`, `confirm`, `delete`
-   **Navigation**: `new-chat`, `settings`, `profile`
-   **States**: `active`, `disabled`, `loading`
-   **Locations**: `sidebar`, `header`, `footer`

### Context Names

**Use consistent area names:**

```typescript
type ThemeContext =
    | 'chat' // Chat interface
    | 'sidebar' // Left/right sidebar
    | 'dashboard' // Dashboard/home
    | 'header' // Top navigation
    | 'modal' // Modal dialogs
    | 'global'; // App-wide
```

Don't create too many contexts—5-7 is optimal.

---

## Selector Strategy

### Specificity Hierarchy

Use the **minimum specificity** needed:

**1. Start broad** (default styles):

```typescript
overrides: {
    'button': {
        variant: 'solid',
        size: 'md'
    }
}
```

**2. Add context** (area-specific):

```typescript
overrides: {
    'button': { variant: 'solid' },
    'button.chat': { variant: 'ghost' },    // More specific
}
```

**3. Add identifier** (component-specific):

```typescript
overrides: {
    'button': { variant: 'solid' },
    'button.chat': { variant: 'ghost' },
    'button.chat#send': { variant: 'solid', color: 'primary' }  // Most specific
}
```

### Avoid Over-Specification

❌ **Bad** (too specific):

```typescript
overrides: {
    'button.chat#send[type="submit"]:hover': { /* ... */ }
}
```

✅ **Good** (appropriate):

```typescript
overrides: {
    'button.chat#send': { /* ... */ }
}
```

Use attributes and states **only when necessary**.

### Group Related Selectors

**Organize by component type:**

```typescript
overrides: {
    // Buttons
    'button': { variant: 'solid' },
    'button.chat': { variant: 'ghost' },
    'button.chat#send': { variant: 'solid', color: 'primary' },
    'button.sidebar': { size: 'sm' },

    // Inputs
    'input': { size: 'md' },
    'input.search': { variant: 'outline' },
    'input#search.global': { size: 'lg' },

    // Cards
    'card': { variant: 'outline' },
    'card.chat': { variant: 'ghost' },
}
```

---

## Color Design

### Material Design 3 Guidelines

Follow MD3 color roles:

**Primary**: Main brand color, primary actions

```typescript
primary: '#6366f1',       // Indigo
onPrimary: '#ffffff',     // White text on primary
```

**Secondary**: Accent color, secondary actions

```typescript
secondary: '#ec4899',     // Pink
onSecondary: '#ffffff',
```

**Surface**: Background for cards, modals

```typescript
surface: '#ffffff',
onSurface: '#1f2937',     // Text on surface
```

### Contrast Requirements

Ensure **WCAG AA compliance** (4.5:1 for text):

✅ **Good contrast:**

```typescript
primary: '#6366f1',      // Indigo
onPrimary: '#ffffff',    // 8.3:1 contrast ✓
```

❌ **Poor contrast:**

```typescript
primary: '#a5b4fc',      // Light indigo
onPrimary: '#e0e7ff',    // 1.4:1 contrast ✗
```

**Test contrast:**

-   Use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
-   Chrome DevTools > Inspect > Color picker shows contrast ratio

### Dark Mode Strategy

**Option 1: Lighter shades for dark mode**

```typescript
colors: {
    primary: '#6366f1',      // Light mode: darker
    dark: {
        primary: '#818cf8',   // Dark mode: lighter
    }
}
```

**Option 2: Inverted palette**

```typescript
colors: {
    surface: '#ffffff',
    onSurface: '#1f2937',
    dark: {
        surface: '#1f2937',   // Swap
        onSurface: '#f9fafb',
    }
}
```

### Auto-Calculated Colors

Let the system calculate container colors:

✅ **Good** (minimal):

```typescript
colors: {
    primary: '#6366f1',
    onPrimary: '#ffffff',
    // primaryContainer auto-calculated
}
```

❌ **Bad** (unnecessary):

```typescript
colors: {
    primary: '#6366f1',
    onPrimary: '#ffffff',
    primaryContainer: '#e0e7ff',       // Manual (can drift)
    onPrimaryContainer: '#312e81',     // Manual
}
```

Only override if design requires **specific** container colors.

---

## Backgrounds & Fonts

### Layered Backgrounds

Use the `backgrounds` property for complex, layered backgrounds instead of custom CSS.

✅ **Good:**

```typescript
backgrounds: {
    content: {
        base: { color: '#f0f9ff' },
        overlay: {
            image: '/patterns/noise.png',
            opacity: 0.05,
            repeat: 'repeat'
        }
    }
}
```

### Font Configuration

Define fonts centrally in `fonts` rather than CSS variables.

✅ **Good:**

```typescript
fonts: {
    sans: '"Inter", sans-serif',
    heading: '"Poppins", sans-serif',
    baseSize: '16px'
}
```

---

## Performance Optimization

### Minimize Overrides

**Each override adds ~0.5ms** to resolution time. Keep totals under 100.

✅ **Good** (60 overrides):

```typescript
overrides: {
    'button': { /* ... */ },
    'button.chat': { /* ... */ },
    'input': { /* ... */ },
    // ... 57 more
}
```

❌ **Bad** (300 overrides):

```typescript
overrides: {
    'button#btn1': { /* ... */ },
    'button#btn2': { /* ... */ },
    'button#btn3': { /* ... */ },
    // ... 297 more (too granular!)
}
```

### Avoid Dynamic Selectors

**Don't compute selectors at runtime:**

❌ **Bad:**

```vue
<UButton :v-theme="`chat.${action}`">{{ label }}</UButton>
```

✅ **Good:**

```vue
<UButton v-theme="'chat.send'" v-if="action === 'send'">Send</UButton>
<UButton v-theme="'chat.cancel'" v-else>Cancel</UButton>
```

Or keep explicit props for dynamic cases.

### Reuse Resolver Instances

**Don't create new resolvers per component:**

❌ **Bad:**

```typescript
export default {
    setup() {
        const resolver = new RuntimeResolver(overrides); // New instance!
        // ...
    },
};
```

✅ **Good:**

```typescript
export default {
    setup() {
        const resolver = useRuntimeResolver(); // Reused from plugin
        // ...
    },
};
```

### Lazy-Load Themes

**For large apps, lazy-load themes:**

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
    // Don't import all themes at once
    theme: {
        lazyLoad: true, // Load theme on switch
    },
});
```

---

## Component Design

### Use v-theme Everywhere

**Every component should have `v-theme`:**

✅ **Good:**

```vue
<template>
    <UButton v-theme="'chat.send'">Send</UButton>
    <UInput v-theme="'chat.message'" />
    <UCard v-theme="'chat.bubble'">
        <p>Message content</p>
    </UCard>
</template>
```

❌ **Bad:**

```vue
<template>
    <UButton variant="solid">Send</UButton>
    <!-- Hard-coded -->
    <UInput />
    <!-- No theme -->
    <UCard>
        <p>Message content</p>
    </UCard>
</template>
```

### Keep Dynamic Props Explicit

**If props are dynamic, keep them explicit:**

✅ **Good:**

```vue
<UButton v-theme="'chat.send'" :disabled="!canSend" :loading="isSending">
    Send
</UButton>
```

Theme provides `variant`, `color`, `size`; component controls state.

### Avoid Inline Styles

**Use theme overrides or Tailwind classes:**

❌ **Bad:**

```vue
<UButton style="background: #6366f1; color: white;">
    Send
</UButton>
```

✅ **Good (theme):**

```typescript
overrides: {
    'button#chat.send': {
        class: 'bg-primary text-on-primary'
    }
}
```

```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

### Component Wrappers

**For reusable styled components:**

```vue
<!-- components/ChatSendButton.vue -->
<template>
    <UButton v-theme="'chat.send'" v-bind="$attrs">
        <slot />
    </UButton>
</template>
```

**Usage:**

```vue
<ChatSendButton :disabled="!canSend">Send</ChatSendButton>
```

Theme is applied internally; callers control behavior.

---

## Testing Themes

### Unit Tests

**Test theme definitions:**

```typescript
import { describe, it, expect } from 'vitest';
import myTheme from '~/theme/my-theme/theme';

describe('my-theme', () => {
    it('has required colors', () => {
        expect(myTheme.colors.primary).toBeDefined();
        expect(myTheme.colors.onPrimary).toBeDefined();
        expect(myTheme.colors.secondary).toBeDefined();
        expect(myTheme.colors.surface).toBeDefined();
    });

    it('has valid overrides', () => {
        expect(myTheme.overrides?.['button']).toBeDefined();
    });
});
```

### Integration Tests

**Test theme switching:**

```typescript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { useTheme } from '~/composables';

describe('Theme Switching', () => {
    it('applies theme to button', async () => {
        const { set } = useTheme();
        const wrapper = mount(MyComponent);

        set('ocean');
        await wrapper.vm.$nextTick();

        const button = wrapper.find('button');
        expect(button.attributes('variant')).toBe('solid');
    });
});
```

### Visual Regression

**Use Playwright or Chromatic:**

```typescript
import { test, expect } from '@playwright/test';

test('chat page with ocean theme', async ({ page }) => {
    await page.goto('/chat');
    await page.evaluate(() => {
        localStorage.setItem('activeTheme', 'ocean');
    });
    await page.reload();

    await expect(page).toHaveScreenshot('chat-ocean.png');
});
```

Run for all themes to catch visual regressions.

---

## Versioning & Maintenance

### Theme Versioning

**Add version to theme definition:**

```typescript
export default defineTheme({
    name: 'ocean',
    version: '1.2.0', // Semantic versioning
    // ...
});
```

**Breaking changes** (2.0.0):

-   Removed colors
-   Changed selector names
-   Incompatible override structure

**Minor updates** (1.2.0):

-   Added new overrides
-   New optional colors

**Patches** (1.2.1):

-   Color tweaks
-   Bug fixes

### Deprecation Strategy

**Mark deprecated overrides:**

```typescript
overrides: {
    // @deprecated Use 'button.chat#send' instead
    'button#send': { /* ... */ },

    'button.chat#send': { /* ... */ }  // New
}
```

**Remove after 1-2 major versions.**

### Documentation

**Document custom colors:**

```typescript
export default defineTheme({
    name: 'ocean',
    colors: {
        primary: '#0ea5e9',
        // Custom app colors
        chatBubble: '#e0f2fe', // Document purpose
        codeBlock: '#1e293b',
    },
});
```

---

## Security Considerations

### Sanitize User Input

**If themes accept user input:**

```typescript
// ❌ Bad: Unsanitized CSS injection
const userColor = userInput; // #ff0000; background: url(evil.com)
theme.colors.primary = userColor;

// ✅ Good: Validate hex colors
function isValidColor(color: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
}

if (isValidColor(userInput)) {
    theme.colors.primary = userInput;
}
```

### CSP Compliance

**Use inline styles only when necessary:**

```typescript
// Avoid in overrides:
overrides: {
    'button': {
        style: { background: '#ff0000' }  // Inline style
    }
}

// Prefer classes:
overrides: {
    'button': {
        class: 'bg-primary'  // CSP-safe
    }
}
```

---

## Checklist: Production-Ready Themes

-   [ ] All required colors defined (primary, secondary, surface)
-   [ ] WCAG AA contrast ratios met (4.5:1 minimum)
-   [ ] Dark mode tested and working
-   [ ] Less than 100 overrides
-   [ ] Semantic, consistent naming
-   [ ] Unit tests for theme definition
-   [ ] Visual regression tests for key pages
-   [ ] Documentation for custom colors/overrides
-   [ ] Validated with `bun run theme:validate`
-   [ ] Performance tested (<1ms resolution time)
-   [ ] SSR-safe (no client-only dependencies)
-   [ ] Versioned and changelog maintained

---

## Common Pitfalls

### 1. Over-Specification

**Problem:** Too many specific selectors

```typescript
overrides: {
    'button.chat#send[type="submit"]:hover': { /* ... */ }
}
```

**Solution:** Use minimum specificity

```typescript
overrides: {
    'button.chat#send': { /* ... */ }
}
```

### 2. Inline Styles

**Problem:** Inline styles bypass theme

```vue
<UButton style="color: red;">Delete</UButton>
```

**Solution:** Use theme overrides

```typescript
overrides: {
    'button#delete': { color: 'error' }
}
```

### 3. Hard-Coded Props

**Problem:** Component can't be themed

```vue
<UButton variant="solid" color="primary">Send</UButton>
```

**Solution:** Use `v-theme`

```vue
<UButton v-theme="'chat.send'">Send</UButton>
```

### 4. Dynamic Selectors

**Problem:** Runtime selector computation

```vue
<UButton :v-theme="`${context}.${action}`">{{ label }}</UButton>
```

**Solution:** Explicit conditions

```vue
<UButton v-theme="'chat.send'" v-if="action === 'send'">Send</UButton>
```

### 5. Ignoring Dark Mode

**Problem:** Theme looks bad in dark mode

```typescript
colors: {
    primary: '#6366f1',  // Good in light mode
    // No dark override—too bright in dark mode!
}
```

**Solution:** Define dark overrides

```typescript
colors: {
    primary: '#6366f1',
    dark: {
        primary: '#818cf8'  // Lighter shade for dark mode
    }
}
```

---

## Advanced Patterns

### Responsive Themes

**Use Tailwind breakpoints in classes:**

```typescript
overrides: {
    'button.chat#send': {
        class: 'text-sm md:text-base lg:text-lg'
    }
}
```

### Animation Themes

**Add transition classes:**

```typescript
overrides: {
    'button': {
        class: 'transition-all duration-200 hover:scale-105'
    }
}
```

### Theme Inheritance

**Extend base themes:**

```typescript
export default defineTheme({
    name: 'ocean-dark',
    extends: 'ocean', // Inherit from ocean theme
    colors: {
        // Only override dark mode
        dark: {
            surface: '#0c4a6e',
            onSurface: '#f0f9ff',
        },
    },
});
```

---

## Resources

-   **Material Design 3**: [m3.material.io](https://m3.material.io)
-   **Contrast Checker**: [webaim.org/resources/contrastchecker](https://webaim.org/resources/contrastchecker/)
-   **Color Palette Generator**: [coolors.co](https://coolors.co)
-   **Nuxt UI Docs**: [ui.nuxt.com](https://ui.nuxt.com)

---

## Summary

1. **Name consistently**: kebab-case, semantic identifiers
2. **Minimize specificity**: Use broadest selectors that work
3. **Optimize performance**: <100 overrides, reuse resolvers
4. **Ensure accessibility**: WCAG AA contrast, dark mode support
5. **Test thoroughly**: Unit, integration, visual regression
6. **Document well**: Custom colors, breaking changes, versions
7. **Iterate**: Start simple, refine based on usage

Follow these practices to build **maintainable, performant, and accessible** themes for OR3. 🎨
