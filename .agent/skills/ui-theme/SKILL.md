---
name: OR3 UI Theme + Design
description: Design and implement polished OR3 UI using the OR3 theme system (Nuxt UI variants in app.config.ts, v-theme overrides, theme icons/backgrounds). Use for new screens/components, redesigns, theme creation/migration, and "make this look pro" visual polish while preserving the retro look.
---

# UI Theme + Design Skill

You are a senior product designer and front-end engineer working inside the OR3 Chat codebase.

Goal: ship UI that feels intentional (clear hierarchy, good spacing, strong typography), while staying inside OR3's theming system. Do not introduce a new styling system or one-off CSS that bypasses theme tokens.

---

## Default Workflow (Design Like A Pro)

1. **Clarify the brief (fast)**:
   - What screen/component and which states: default, hover/active/focus, loading, empty, error?
   - Which density (compact/normal/cozy) and breakpoints (mobile/desktop) must look great?
   - Ask for a reference screenshot or example (the user already provided good ones) and name what to borrow: typography, spacing, depth, background, motion.

2. **Design in layers (don't jump to colors first)**:
   - **Layout**: spacing, alignment, grid, grouping, whitespace.
   - **Hierarchy**: type scale/weight, contrast, primary vs secondary actions.
   - **Skin**: theme tokens, borders, shadows, backgrounds, motion.

3. **Implement using OR3 primitives**:
   - Prefer **Nuxt UI components** and variants in `app/app.config.ts` (or theme-level `ui` patches).
   - Use `v-theme` for any themed component. Use contexts + identifiers (`chat.send`, `sidebar.new-chat`) so themes can override cleanly.
   - Extend variants in one place (avoid "random Tailwind soup" in components).

4. **Polish pass**:
   - Add states (hover/active/focus/disabled) with consistent affordances.
   - Verify contrast, focus rings, and keyboard navigation.
   - Add subtle motion only where it clarifies state changes (respect reduced motion).

5. **Deliverables**:
   - Summarize the visual intent in 3-6 bullets.
   - List files changed and why (tokens/variants/overrides vs component code).

---

## Fast Design Heuristics (What "Pro" Usually Means)

- **Hierarchy**: 1 primary action per surface; secondary actions visually quieter.
- **Whitespace**: increase spacing before adding borders/shadows; group by proximity.
- **Typography**: fewer sizes, larger jumps; use weight/size/opacity to create lanes of attention.
- **Color**: start neutral; use one strong accent; keep saturation under control in dense UIs.
- **Depth**: pick one shadow language; be consistent (OR3's retro look prefers hard borders + restrained shadows).
- **Backgrounds**: avoid flat emptiness; use subtle patterns/gradients/shapes, but keep contrast low so content wins.

For deeper guidance and inspiration, read:
- `./references/design-playbook.md`
- `./references/inspiration.md`

---

## Theme Documentation (Internal)

These docs are indexed in `public/_documentation/docmap.json` under the "Themes" section:

- Architecture: `public/_documentation/themes/architecture.md` (route: `/themes/architecture`)
- Quick start: `public/_documentation/themes/quick-start.md` (route: `/themes/quick-start`)
- API reference: `public/_documentation/themes/api-reference.md` (route: `/themes/api-reference`)
- Best practices: `public/_documentation/themes/best-practices.md` (route: `/themes/best-practices`)
- CSS selectors: `public/_documentation/themes/css-selectors.md` (route: `/themes/css-selectors`)
- Theme icons: `public/_documentation/themes/theme-icons.md` (route: `/themes/theme-icons`)
- Troubleshooting: `public/_documentation/themes/troubleshooting.md` (route: `/themes/troubleshooting`)
- Migration guide: `public/_documentation/themes/migration-guide.md` (route: `/themes/migration-guide`)

Use them to avoid re-deriving selector rules, CLI commands, and resolver behavior.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Theme Definition Layer                       │
│              app/theme/<name>/theme.ts                          │
│       (colors, fonts, overrides, cssSelectors, backgrounds)     │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                      Theme Plugin Layer                         │
│         plugins/90.theme.client.ts + 90.theme.server.ts         │
│  (loads themes, compiles overrides, injects CSS, manages state) │
└───────────────────────────┬────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  v-theme        │ │ useThemeOverrides│ │ useThemeResolver│
│  Directive      │ │ Composable       │ │ Composable       │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            ▼
                    ┌─────────────────┐
                    │   Components    │
                    │   (Nuxt UI +    │
                    │   Custom)       │
                    └─────────────────┘
```

---

## Key Files Reference

| Area | Location | Purpose |
|------|----------|---------|
| **Theme Definitions** | `app/theme/<name>/theme.ts` | Define colors, fonts, overrides |
| **Shared Utils** | `app/theme/_shared/` | Compiler, resolver, types |
| **Theme Plugins** | `app/plugins/90.theme.*.ts` | Load and apply themes |
| **Auto Theme** | `app/plugins/91.auto-theme.client.ts` | Light/dark mode detection |
| **Core Theme** | `app/core/theme/` | Backgrounds, user overrides |
| **Nuxt UI Variants** | `app/app.config.ts` | App-wide Nuxt UI component slots/variants (retro defaults) |
| **Root App Config** | `app.config.ts` | Base Nuxt UI config (keep changes minimal; themes may patch via `theme.ui`) |
| **Icon Registry** | `app/theme/_shared/icon-registry.ts` | Theme-aware icons |

---

## 1. Theme Package Structure

```
app/theme/<name>/
├── theme.ts           # Required - defineTheme()
├── app.config.ts      # Optional - Nuxt app config patch
├── icons.config.ts    # Optional - icon overrides
├── styles.css         # Optional - theme stylesheet
└── styles/            # Optional - TS style helpers
```

Themes are discovered via `import.meta.glob` from `app/theme/*/theme.ts` (excluding `_shared`).

---

## 2. Creating a Theme

Follow the internal quick start first: `public/_documentation/themes/quick-start.md`.

### Minimal Example (for reference)

```typescript
// app/theme/my-theme/theme.ts
import { defineTheme } from '../_shared/define-theme';

export default defineTheme({
    name: 'my-theme',
    displayName: 'My Theme',
    description: 'Custom theme',

    colors: {
        primary: '#086DB8',
        secondary: '#ff6b6b',
        surface: '#ffffff',
        onSurface: '#022344',
        dark: {
            primary: '#2C638B',
            surface: '#0a0a0a',
            onSurface: '#e2e2e6',
        },
    },

    fonts: {
        sans: '"IBM Plex Sans", system-ui, sans-serif',
        heading: '"IBM Plex Sans", system-ui, sans-serif',
        baseSize: '16px',
    },

    overrides: {
        button: { variant: 'solid', size: 'md' },
        'button.chat': { variant: 'ghost' },
        'button#chat.send': { variant: 'solid', color: 'primary' },
    },
});
```

### Available Theme Fields

| Field | Description |
|-------|-------------|
| `colors` | CSS variables for colors (with optional `dark` overrides) |
| `fonts` | Font families, sizes |
| `borderWidth`, `borderRadius` | Border tokens |
| `overrides` | Selector-driven component props |
| `cssSelectors` | Direct DOM styling (Monaco, TipTap, etc.) |
| `stylesheets` | CSS files to load when theme activates |
| `ui` | Nuxt UI config merged into `app.config.ui` |
| `propMaps` | Map variant/size/color to classes |
| `backgrounds` | Theme background layers |
| `icons` | Icon token overrides |

---

## 3. Override Selector Syntax

Selectors are CSS-like, normalized to `data-*` attributes:

| Selector | Expands To |
|----------|------------|
| `button` | All buttons |
| `button.chat` | `button[data-context="chat"]` |
| `button#chat.send` | `button[data-id="chat.send"]` |
| `button:hover` | State selector (requires `state` param) |

### Known Contexts
Defined in `app/theme/_shared/contexts.ts`:
- `global`, `chat`, `sidebar`, `dashboard`, `header`, `settings`, `prompt`, `modal`, `editor`

---

## 4. Component Integration

### Option 1: `v-theme` Directive (Recommended)

```vue
<template>
    <!-- Auto-detect component and context -->
    <UButton v-theme>Themed Button</UButton>

    <!-- Explicit identifier -->
    <UButton v-theme="'chat.send'">Send</UButton>

    <!-- Full control -->
    <UButton v-theme="{ identifier: 'chat.send', context: 'chat' }">
        Send
    </UButton>
</template>
```

### Option 2: `useThemeOverrides` Composable

```vue
<script setup lang="ts">
const overrides = useThemeOverrides({
    component: 'button',
    context: 'chat',
    identifier: 'chat.send',
    isNuxtUI: true,
});
</script>

<template>
    <UButton v-bind="overrides">Send</UButton>
</template>
```

### Option 3: `useThemeResolver` (One-off)

```typescript
const { resolveOverrides } = useThemeResolver();
const props = resolveOverrides({
    component: 'input',
    context: 'global',
    identifier: 'search.query',
});
```

---

## 5. CSS Selector Targeting

For non-component DOM (Monaco, TipTap, modals):

```typescript
// In theme.ts
cssSelectors: {
    '.monaco-editor': {
        style: { border: '2px solid var(--md-outline)' },
        class: 'rounded-md shadow-lg',
    },
    '.tiptap-editor': {
        class: 'prose dark:prose-invert',
    },
}
```

- `style` → compiled to `/public/themes/<name>.css`
- `class` → applied at runtime

---

## 6. Icon System

### Define Icon Overrides

```typescript
// app/theme/<name>/icons.config.ts
export default {
    'chat.send': 'carbon:send',
    'ui.close': 'carbon:close',
};
```

### Use in Components

```vue
<script setup>
const icon = useIcon('chat.send');
</script>

<template>
    <UButton :icon="icon">Send</UButton>
</template>
```

---

## 7. Plugin API

Access theme from Nuxt plugins:

```typescript
export default defineNuxtPlugin((nuxtApp) => {
    const theme = nuxtApp.$theme;

    // Switch theme
    await theme.setActiveTheme('my-theme');

    // Get current theme
    const current = theme.activeTheme.value;

    // Resolve overrides manually
    const resolver = theme.getResolver(current);
    if (resolver) {
        const resolved = resolver.resolve({
            component: 'widget',
            context: 'global',
            isNuxtUI: false,
        });
    }
});
```

---

## 8. Tooling Commands

```bash
# Create new theme scaffold
bun run theme:create

# Validate all themes + generate types
bun run theme:validate

# Build CSS from cssSelectors.style
bun run theme:build-css

# Switch default theme
bun run theme:switch
```

---

## 9. User Theme Overrides

Users can customize themes at runtime:

```typescript
// app/core/theme/useUserThemeOverrides.ts
const { overrides, setOverride, resetOverride } = useUserThemeOverrides();

// Set custom color
setOverride({ key: 'colors.primary', value: '#ff0000' });
```

Overrides are persisted in the `kv` table for cross-device sync.

---

## 10. Plugin Development

### File Naming Convention
- `00-*.ts` - Early initialization
- `90-99.*.ts` - Theme/UI plugins (run after framework)
- `.client.ts` - Client-only
- `.server.ts` - Server-only

### Example Plugin Structure

```typescript
// app/plugins/my-feature.client.ts
export default defineNuxtPlugin((nuxtApp) => {
    // Access runtime config
    const config = useRuntimeConfig();

    // Register sidebar action
    registerSidebarFooterAction({
        id: 'my-feature:action',
        icon: useIcon('ui.star').value,
        label: 'My Feature',
        order: 100,
        handler: () => { /* ... */ },
    });

    // Clean up on HMR
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            unregisterSidebarFooterAction?.('my-feature:action');
        });
    }
});
```

---

## 11. Debugging Tips

| Issue | Debug Approach |
|-------|----------------|
| Overrides not applying | Check `data-v-theme`, `data-theme-target` attributes |
| Wrong context | Add `data-context="<name>"` to wrapper element |
| CSS not loading | Run `bun run theme:build-css` |
| Icon not found | Check `icons.config.ts` and `useIcon()` token |

---

## 12. Code Quality Standards

- **Nuxt UI First** - Use `<UButton>`, `<UInput>`, etc.
- **Theme Tokens** - Use CSS variables, not hardcoded colors
- **Context Markers** - Add `data-context` for override resolution
- **HMR Cleanup** - Always clean up in `import.meta.hot.dispose`
- **Type Safety** - Use `defineTheme()` for full typing
