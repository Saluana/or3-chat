# Refined Theme System - Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Refined Theme System                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐         ┌──────────────────────────────────┐
│   Theme DSL         │         │      Build-Time Components       │
│                     │         │                                  │
│  defineTheme()      │────────▶│  Theme Compiler                  │
│  ├─ colors          │         │  ├─ Theme discovery              │
│  ├─ overrides       │         │  ├─ CSS variable generation      │
│  │   ├─ selectors   │         │  ├─ Selector parsing              │
│  │   └─ props       │         │  ├─ Specificity calculation       │
│  └─ ui config       │         │  ├─ Type generation               │
│                     │         │  └─ Validation                    │
└─────────────────────┘         │                                  │
                                │  Vite Plugin                     │
                                │  ├─ Build integration            │
                                │  ├─ HMR support                   │
                                │  └─ Error reporting               │
                                └──────────────────────────────────┘
                                         │
                                         ▼
                                ┌──────────────────────────────────┐
                                │      Runtime Components           │
                                │                                  │
                                │  Runtime Resolver                │
                                │  ├─ Override matching             │
                                │  ├─ Specificity sorting           │
                                │  ├─ Prop merging                  │
                                │  └─ Performance optimization      │
                                │                                  │
                                │  v-theme Directive                │
                                │  ├─ Component detection           │
                                │  ├─ Context detection             │
                                │  ├─ Override resolution           │
                                │  └─ Reactive updates              │
                                │                                  │
                                │  Theme Plugin                     │
                                │  ├─ Load compiled configs         │
                                │  ├─ Initialize resolvers          │
                                │  └─ Handle theme switching        │
                                └──────────────────────────────────┘
                                         │
                                         ▼
                                ┌─────────────────┐
                                │   Components    │
                                │                 │
                                │  <UButton>      │
                                │  <UInput>       │
                                │  <UModal>       │
                                │  ...            │
                                └─────────────────┘
```

## Data Flow

```
Theme Authoring (Build Time)
   │
   ├──▶ Write theme.ts with defineTheme()
   │        │
   │        ├──▶ Define colors
   │        │     └─ Auto-generate CSS variables
   │        │
   │        ├──▶ Define overrides
   │        │     ├─ CSS selector syntax
   │        │     └─ Override props
   │        │
   │        └──▶ Define UI config
   │
   ├──▶ Theme Compiler (build time)
   │        │
   │        ├──▶ Discover themes
   │        │
   │        ├──▶ Parse selectors
   │        │     ├─ Extract component, context, identifier
   │        │     └─ Calculate specificity
   │        │
   │        ├──▶ Generate CSS variables
   │        │     ├─ .light and .dark classes
   │        │     └─ Auto-calculate missing colors
   │        │
   │        ├──▶ Compile overrides
   │        │     └─ Runtime format with specificity
   │        │
   │        ├──▶ Generate types
   │        │     ├─ ThemeName union
   │        │     ├─ ThemeIdentifier union
   │        │     └─ ThemeDirective interface
   │        │
   │        └──▶ Validate structure
   │           └─ Fail build on errors
   │
   └──▶ Output compiled theme
         ├─ theme.compiled.ts
         ├─ theme.css
         └─ types/theme-generated.d.ts

Theme Runtime
   │
   ├──▶ Load compiled configs
   │        │
   │        └──▶ Initialize RuntimeResolver per theme
   │                 │
   │                 └──▶ Store sorted overrides by specificity
   │
   Component Render
   │
   ├──▶ v-theme directive attaches
   │        │
   │        ├──▶ Detect component type
   │        │     └─ From vnode.type.__name
   │        │
   │        ├──▶ Detect context
   │        │     └─ From DOM ancestry
   │        │
   │        ├──▶ Get identifier (optional)
   │        │     └─ From v-theme="'chat.send'"
   │        │
   │        └──▶ Resolve overrides
   │              ├─ Match by component, context, identifier, state
   │              ├─ Sort by specificity
   │              ├─ Merge props (component props win)
   │              └─ Apply to component instance
   │
   └──▶ Component renders with resolved props
```

## Selector Syntax Processing

```
Theme Author Input
   │
   ├──▶ Simple syntax (recommended)
   │      │
   │      ├─ 'button.chat' → [data-context="chat"]
   │      ├─ 'button#chat.send' → [data-id="chat.send"]
   │      └─ 'button.chat:hover' → [data-context="chat"]:hover
   │
   ├──▶ HTML attribute targeting
   │      │
   │      ├─ 'button[id="submit"]' → unchanged
   │      ├─ 'input[type="email"]' → unchanged
   │      └─ 'button[class*="primary"]' → unchanged
   │
   └──▶ Advanced syntax (power users)
         │
         └─ 'button[data-context="chat"][type="text"]' → unchanged

Compiler Processing
   │
   ├──▶ Parse selector
   │      ├─ Extract component type
   │      ├─ Extract context (data-context)
   │      ├─ Extract identifier (data-id)
   │      ├─ Extract state (:hover, :active, etc.)
   │      └─ Extract other attributes
   │
   ├──▶ Calculate specificity
   │      ├─ Element: 1 point
   │      ├─ Attribute: 10 points
   │      ├─ ID/Identifier: 20 points
   │      └─ Pseudo-class: 10 points
   │
   └──▶ Store as CompiledOverride
         ├─ component, context, identifier, state
         ├─ props, selector, specificity
         └─ Optimized for runtime matching
```

## Override Resolution Algorithm

```
Runtime Resolution
   │
   ├──▶ Build resolution context
   │      │
   │      ├─ component: 'button'
   │      ├─ context: 'chat' (from DOM)
   │      ├─ identifier: 'chat.send' (from v-theme)
   │      ├─ state: 'hover' (from element)
   │      └─ theme: 'nature'
   │
   ├──▶ Filter matching overrides
   │      │
   │      ├─ Check component match
   │      ├─ Check context match (or global)
   │      ├─ Check identifier match (or any)
   │      ├─ Check state match (or default)
   │      └─ Collect all matches
   │
   ├──▶ Sort by specificity (highest first)
   │      │
   │      └─ CSS specificity rules apply
   │
   ├──▶ Merge props
   │      │
   │      ├─ Concatenate class properties
   │      ├─ Deep merge ui objects
   │      ├─ Higher specificity overrides primitives
   │      └─ Component props win over everything
   │
   └──▶ Apply merged props to component
```

## Type Generation Flow

```
Theme Discovery (Build Time)
   │
   ├──▶ Scan app/theme/*/theme.ts files
   │        │
   │        └──▶ Extract all defineTheme() calls
   │
   ├──▶ Extract identifiers
   │        │
   │        ├─ From override selectors
   │        │     ├─ 'button#chat.send' → 'chat.send'
   │        │     ├─ 'input#search.query' → 'search.query'
   │        │     └─ 'modal#confirm.delete' → 'confirm.delete'
   │        │
   │        └──▶ Build union type
   │
   └──▶ Generate types/theme-generated.d.ts
         │
         ├─ export type ThemeName = 'default' | 'nature' | 'cyberpunk'
         ├─ export type ThemeIdentifier = 'chat.send' | 'search.query' | ...
         └─ export interface ThemeDirective {
              theme?: ThemeName;
              identifier?: ThemeIdentifier;
         }

Developer Experience
   │
   ├──▶ Autocomplete for theme names
   │        └─ v-theme="'na▼" → shows 'nature'
   │
   ├──▶ Autocomplete for identifiers
   │        └─ v-theme="'chat.s▼" → shows 'chat.send'
   │
   └──▶ Compile-time errors
         └─ v-theme="'invalid'" → TS error
```

## Performance Optimization

```
Resolution Performance
   │
   ├──▶ Pre-sorted overrides
   │      └─ Compiler sorts by specificity once
   │
   ├──▶ Early exit matching
   │      ├─ Component type filter first (fastest)
   │      ├─ Context filter second
   │      └─ Identifier/state filter last
   │
   ├──▶ Minimal allocations
   │      ├─ Reuse resolution context objects
   │      ├─ Avoid array copies during merge
   │      └─ Use efficient string operations
   │
   └──▶ Target performance
         ├─ Resolution: < 1ms per component
         ├─ Theme switch: < 50ms total
         └─ Build overhead: < 500ms added

Memory Efficiency
   │
   ├──▶ Compiled format
   │      ├─ Flat arrays instead of nested objects
   │      ├─ Numeric specificity instead of calculation
   │      └─ Shared props references where possible
   │
   └──▶ Runtime footprint
         ├─ < 50KB for all themes
         ├─ No per-component memory growth
         └─ Efficient string interning
```

## Component Integration Patterns

### Pattern 1: Direct Directive (Recommended)

```vue
<template>
  <!-- Simple: auto-detect context -->
  <UButton v-theme="'chat.send'">Send Message</UButton>
  
  <!-- Explicit: specify context -->
  <UInput v-theme="{ identifier: 'search.query', theme: 'nature' }" />
  
  <!-- Global: no identifier -->
  <UModal v-theme="'global.settings'">Settings</UModal>
</template>
```

### Pattern 2: Programmatic Usage

```vue
<template>
  <UButton v-bind="resolvedProps">Click</UButton>
</template>

<script setup>
import { useThemeResolver } from '@/composables/useThemeResolver'

const resolver = useThemeResolver()
const resolvedProps = computed(() => 
  resolver.resolve({
    component: 'button',
    context: 'chat',
    identifier: 'chat.send'
  })
)
</script>
```

### Pattern 3: Mixed with Props

```vue
<template>
  <!-- Theme provides base, props override -->
  <UButton 
    v-theme="'chat.send'"
    color="custom"  <!-- Wins over theme -->
    size="lg"       <!-- Wins over theme -->
  >
    Send
  </UButton>
</template>
```

## Build Integration

```
Vite Build Process
   │
   ├──▶ buildStart
   │      │
   │      └──▶ Theme Plugin activates
   │           └─ Discover theme files
   │
   ├──▶ build (compilation)
   │      │
   │      ├──▶ Compile themes
   │      │      ├─ Parse and validate
   │      │      ├─ Generate CSS
   │      │      ├─ Compile overrides
   │      │      └─ Generate types
   │      │
   │      ├──▶ Fail on errors
   │      │      └─ Clear error messages
   │      │
   │      └──▶ Include compiled assets
   │             ├─ theme.compiled.js
   │             ├─ theme.css
   │             └─ types/theme-generated.d.ts
   │
   └──▶ handleHotUpdate (dev mode)
          │
          └──▶ Theme file changed
                 ├─ Recompile single theme
                 ├─ Regenerate types
                 └─ Trigger HMR update
```

## Error Handling Strategy

```
Build-Time Validation
   │
   ├──▶ Theme structure validation
   │      ├─ Required colors present
   │      ├─ Valid CSS selectors
   │      └─ Proper prop types
   │
   ├──▶ Error reporting
   │      ├─ File and line numbers
   │      ├─ Clear error messages
   │      └─ Suggested fixes
   │
   └──▶ Build failure
         └─ Stop on critical errors

Runtime Graceful Degradation
   │
   ├──▶ Resolution errors
   │      ├─ Log to console in dev
   │      ├─ Return empty props
   │      └─ Component uses defaults
   │
   ├──▶ Missing identifiers
   │      ├─ Warn in dev mode
   │      ├─ Fall back to context-only
   │      └─ Continue rendering
   │
   └──▶ Theme switching errors
         ├─ Preserve current theme
         ├─ Show user notification
         └─ Retry automatically
```

## File Structure

```
app/
├── theme/
│   ├── default/
│   │   └── theme.ts                    # defineTheme() DSL
│   ├── nature/
│   │   └── theme.ts                    # defineTheme() DSL
│   ├── cyberpunk/
│   │   └── theme.ts                    # defineTheme() DSL
│   ├── _shared/
│   │   ├── types.ts                    # ThemeDefinition interfaces
│   │   ├── define-theme.ts             # defineTheme() function
│   │   ├── validate-theme.ts           # Runtime validation
│   │   ├── prop-class-maps.ts          # Custom component mappings
│   │   └── __tests__/
│   │       └── *.test.ts
│   └── _compiled/                      # Generated by compiler
│       ├── default.compiled.ts
│       ├── nature.compiled.ts
│       └── cyberpunk.compiled.ts

├── composables/
│   └── useThemeResolver.ts             # Programmatic API

├── plugins/
│   ├── theme.client.ts                 # Load compiled configs
│   └── auto-theme.client.ts            # v-theme directive

├── components/
│   └── (no wrapper components needed)

scripts/
├── theme-compiler.ts                   # Build-time compiler
├── cli/
│   ├── validate-theme.ts               # CLI validation tool
│   ├── create-theme.ts                 # CLI scaffold tool
│   └── migrate-theme.ts                # Migration utility

plugins/
└── vite-theme-compiler.ts              # Vite integration

types/
└── theme-generated.d.ts                # Auto-generated types
```

## Type System

```typescript
// Author-facing DSL
interface ThemeDefinition {
  name: string;
  displayName?: string;
  description?: string;
  
  colors: {
    primary: string;
    secondary: string;
    surface: string;
    // ... Material Design 3 tokens
    dark?: Partial<typeof this>;
  };
  
  overrides?: {
    [selector: string]: OverrideProps;
  };
  
  ui?: Record<string, unknown>;
}

// Override props
interface OverrideProps {
  variant?: string;      // 'solid' | 'outline' | 'ghost'
  size?: string;         // 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  color?: string;        // 'primary' | 'secondary' | 'success'
  class?: string;        // Additional CSS classes
  style?: Record<string, string>;  // Inline styles
  ui?: Record<string, unknown>;    // Nuxt UI config
  [key: string]: unknown;  // Component-specific props
}

// Compiled format (runtime)
interface CompiledOverride {
  component: string;      // 'button' | 'input' | 'modal'
  context?: string;       // 'chat' | 'sidebar' | 'global'
  identifier?: string;    // 'chat.send' | 'search.query'
  state?: string;         // 'hover' | 'active' | 'focus'
  props: OverrideProps;   // Merged result
  selector: string;       // Original CSS selector
  specificity: number;    // Pre-calculated specificity score
}

// Auto-generated types
type ThemeName = 'default' | 'nature' | 'cyberpunk';
type ThemeIdentifier = 'chat.send' | 'search.query' | 'confirm.delete';

interface ThemeDirective {
  theme?: ThemeName;
  identifier?: ThemeIdentifier;
}
```

## Security Boundaries

```
Theme Config (Untrusted)
   │
   ├──▶ Build-time Validation
   │      │
   │      ├─ Reject event handlers (onClick, etc.)
   │      ├─ Sanitize CSS selectors
   │      ├─ Validate prop types
   │      └─ Check structure
   │
   ├──▶ Compile to Safe Format
   │      │
   │      ├─ Only allow safe OverrideProps
   │      ├─ Strip dangerous properties
   │      └─ Generate typed interfaces
   │
   └──▶ Runtime Application (Trusted)
          │
          └─ Component receives only validated props
```

## Testing Strategy

```
Unit Tests
   ├─ theme-compiler.test.ts
   │   ├─ Theme discovery
   │   ├─ Selector parsing
   │   ├─ Specificity calculation
   │   ├─ CSS generation
   │   └─ Type generation
   │
   ├─ runtime-resolver.test.ts
   │   ├─ Override matching
   │   ├─ Specificity sorting
   │   ├─ Prop merging
   │   └─ Performance targets
   │
   └─ v-theme-directive.test.ts
       ├─ Component detection
       ├─ Context detection
       ├─ Override resolution
       └─ Reactivity

Integration Tests
   ├─ theme-system.test.ts
   │   ├─ End-to-end theme application
   │   ├─ Theme switching
   │   └─ Component prop overrides
   │
   └─ build-integration.test.ts
       ├─ Vite plugin functionality
       ├─ HMR updates
       └─ Error handling

E2E Tests
   └─ theme-system.spec.ts
       ├─ User creates theme
       ├─ Theme applies to components
       ├─ Performance validation
       └─ Visual regression testing
```

## Development Workflow

```
1. Theme Author
   │
   ├──▶ bun run theme:create nature
   │      └─ Scaffold theme/nature/theme.ts
   │
   ├──▶ Edit theme.ts
   │      ├─ Define colors
   │      ├─ Add overrides
   │      └─ Use simple selector syntax
   │
   ├──▶ bun run theme:validate nature
   │      └─ Instant validation feedback
   │
   └──▶ See changes live (HMR)
         └─ < 100ms reload time

2. Component Developer
   │
   ├──▶ Add v-theme directive
   │      └─ <UButton v-theme="'chat.send'">
   │
   ├──▶ Get autocomplete
   │      ├─ Theme names
   │      └─ Identifiers
   │
   └──▶ Override with props
         └─ Component props win over theme

3. Debug Mode
   │
   ├──▶ Open DevTools
   │      └─ [theme-system] logs
   │
   ├──▶ Inspect element
   │      └─ See applied overrides
   │
   └──▶ Performance profiling
         └─ Resolution timing visible
```

## Migration Path

```
Phase 1: Parallel Systems
   │
   ├──▶ New refined system active
   ├──▶ Old override system maintained
   └──▶ Compatibility layer loads both

Phase 2: Gradual Migration
   │
   ├──▶ Migrate themes one by one
   │      └─ Use theme:migrate CLI tool
   │
   ├──▶ Update component usage
   │      ├─ Replace ThemeButton → v-theme
   │      └─ Replace useThemeOverrides → directive
   │
   └──▶ Remove old system files
         └─ After full migration

Phase 3: Cleanup
   │
   ├──▶ Remove wrapper components
   ├──▶ Remove old composables
   └─── Remove compatibility layer
```

---

This architecture provides a simplified, type-safe, and performant foundation for theme-based component customization while reducing code complexity by 40-50% and maintaining full backward compatibility during migration.
