# Theme Override System - Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Theme Override System                         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐         ┌──────────────────────────────────┐
│   Theme Files       │         │      Runtime Components          │
│                     │         │                                  │
│  theme.ts           │────────▶│  Override Resolver               │
│  ├─ ui config       │         │  ├─ Rule matching               │
│  └─ componentOver-  │         │  ├─ Precedence logic            │
│     rides           │         │  ├─ Prop merging                │
│     ├─ global       │         │  └─ Caching                     │
│     ├─ contexts     │         │                                  │
│     └─ states       │         │  useThemeOverrides()             │
│                     │         │  ├─ Context detection           │
└─────────────────────┘         │  ├─ Override resolution         │
                                │  └─ Prop merging                │
                                │                                  │
                                │  Theme Plugin                    │
                                │  ├─ Load theme config           │
                                │  ├─ Initialize resolver         │
                                │  └─ Handle theme switching      │
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
Theme Load
   │
   ├──▶ Parse theme.ts
   │        │
   │        └──▶ Extract componentOverrides
   │                  │
   │                  └──▶ Validate structure
   │                          │
   │                          └──▶ Initialize Resolver
   │                                   │
   │                                   └──▶ Store rules in memory
   │
Component Render
   │
   ├──▶ Call useThemeOverrides(type, context)
   │        │
   │        ├──▶ Build override context
   │        │     └─ { mode, theme, element, props }
   │        │
   │        ├──▶ Generate cache key
   │        │     └─ "button:chat:dark:cyberpunk"
   │        │
   │        ├──▶ Check cache
   │        │     │
   │        │     ├──▶ Cache HIT → Return cached props
   │        │     │
   │        │     └──▶ Cache MISS ↓
   │        │
   │        ├──▶ Collect applicable rules
   │        │     ├─ Global rules
   │        │     ├─ Context rules
   │        │     └─ State rules
   │        │
   │        ├──▶ Filter by condition
   │        │
   │        ├──▶ Sort by priority
   │        │
   │        ├──▶ Merge props
   │        │     ├─ Concatenate classes
   │        │     ├─ Deep merge ui objects
   │        │     └─ Override primitives
   │        │
   │        ├──▶ Cache result
   │        │
   │        └──▶ Return resolved props
   │
   └──▶ Merge with component props
         │
         └──▶ Render component
```

## Precedence Rules

```
Priority (Highest to Lowest):
   │
   ├─ 1. Component Props (Explicit)
   │     <UButton color="red" />  ← Always wins
   │
   ├─ 2. Context-Specific Overrides
   │     contexts: { chat: { button: [...] } }
   │
   ├─ 3. State-Based Overrides
   │     states: { hover: { button: [...] } }
   │
   └─ 4. Global Overrides
         global: { button: [...] }
```

## Context Detection

```
Component in DOM
   │
   ├──▶ Check closest ancestor IDs:
   │      │
   │      ├─ #app-chat-container → context = "chat"
   │      ├─ #app-sidebar → context = "sidebar"
   │      ├─ #app-dashboard-modal → context = "dashboard"
   │      ├─ #app-header → context = "header"
   │      └─ (none) → context = "global"
   │
   └──▶ Use context for override resolution
```

## Cache Strategy

```
Override Resolution
   │
   ├──▶ Generate key: "componentType:context:mode:theme"
   │
   ├──▶ Lookup in Map<string, ResolvedOverride>
   │      │
   │      ├─ Found → Return cached (< 0.1ms)
   │      │
   │      └─ Not Found ↓
   │
   ├──▶ Compute overrides (< 1ms)
   │
   ├──▶ Store in cache
   │      │
   │      └─ If cache.size > MAX_SIZE (100)
   │           └─ Evict LRU entry
   │
   └──▶ Return result

Theme Switch
   │
   └──▶ Clear entire cache
         └─ Start fresh with new theme
```

## Component Integration Patterns

### Pattern 1: Manual Application

```vue
<template>
  <UButton v-bind="buttonProps">Click</UButton>
</template>

<script setup>
const { overrides } = useThemeOverrides('button', 'chat');
const buttonProps = computed(() => ({
  ...overrides.value,
  color: 'custom' // Component prop wins
}));
</script>
```

### Pattern 2: Auto-Context

```vue
<template>
  <UButton v-bind="overrides">Click</UButton>
</template>

<script setup>
const context = useAutoContext(); // Detects from DOM
const { overrides } = useThemeOverrides('button', context);
</script>
```

### Pattern 3: Wrapper Component

```vue
<!-- ThemeButton.vue -->
<template>
  <UButton v-bind="mergedProps">
    <slot />
  </UButton>
</template>

<script setup>
const props = defineProps(['color', 'size', ...]);
const context = useAutoContext();
const { overrides } = useThemeOverrides('button', context);
const mergedProps = computed(() => 
  mergeOverrides(overrides.value, props)
);
</script>
```

## Error Handling Flow

```
Override Resolution
   │
   ├──▶ Try resolve
   │      │
   │      ├─ Success → Return props
   │      │
   │      └─ Error ↓
   │
   ├──▶ Catch error
   │      │
   │      ├──▶ Log error with context
   │      │     └─ [theme-overrides] Resolution failed
   │      │
   │      └──▶ Return empty object {}
   │
   └──▶ Component uses default props
```

## Performance Characteristics

```
Operation                    Target Time    Implementation
────────────────────────────────────────────────────────────
Override resolution (hit)    < 0.1ms        Map lookup
Override resolution (miss)   < 1ms          Rule matching + merge
Theme switch                 < 50ms         Cache clear + reinit
Component render overhead    < 5%           Minimal composable logic
Cache hit rate              > 90%          Smart key generation
Memory footprint            < 50KB         Efficient data structures
```

## File Structure

```
app/
├── theme/
│   ├── default/
│   │   └── theme.ts                    # Has componentOverrides
│   ├── minimal/
│   │   └── theme.ts                    # Has componentOverrides
│   ├── cyberpunk/
│   │   └── theme.ts                    # Has componentOverrides
│   ├── nature/
│   │   └── theme.ts                    # Has componentOverrides
│   └── _shared/
│       ├── override-types.ts           # TypeScript interfaces
│       ├── override-resolver.ts        # Core resolution logic
│       ├── override-validator.ts       # Config validation
│       └── __tests__/
│           └── *.test.ts
│
├── composables/
│   └── useThemeOverrides.ts            # Composable for components
│
├── plugins/
│   └── theme.client.ts                 # Initialize resolver
│
└── components/
    ├── theme/
    │   ├── ThemeButton.vue             # Wrapper components
    │   ├── ThemeInput.vue
    │   └── ThemeModal.vue
    └── ...                              # Use useThemeOverrides
```

## Type System

```typescript
// Core types
ComponentType = 'button' | 'input' | 'modal' | ...
ContextSelector = 'global' | 'chat' | 'sidebar' | ...
ComponentState = 'default' | 'hover' | 'active' | ...

// Configuration
interface OverrideRule<TProps> {
  component: ComponentType;
  context?: ContextSelector;
  state?: ComponentState;
  props: Partial<TProps>;
  priority?: number;
  condition?: (ctx: OverrideContext) => boolean;
}

interface ComponentOverrides {
  global?: { [component: string]: OverrideRule[] };
  contexts?: { [context: string]: ComponentOverrides['global'] };
  states?: { [state: string]: ComponentOverrides['global'] };
}

// Resolution result
interface ResolvedOverride {
  props: Record<string, unknown>;
  rules: OverrideRule[];
  cacheKey: string;
}
```

## Security Boundaries

```
Theme Config (Untrusted)
   │
   ├──▶ Validation
   │      │
   │      ├─ Reject event handlers (onClick, onInput, etc.)
   │      ├─ Sanitize HTML values
   │      ├─ Validate prop types
   │      └─ Check structure
   │
   ├──▶ Safe Props Only
   │      │
   │      └─ color, size, variant, class, ui, etc.
   │
   └──▶ Component Render (Trusted)
```

## Testing Strategy

```
Unit Tests
   ├─ override-resolver.test.ts
   │   ├─ Rule matching
   │   ├─ Priority sorting
   │   ├─ Prop merging
   │   └─ Caching
   │
   └─ useThemeOverrides.test.ts
       ├─ Context detection
       ├─ Override resolution
       └─ Reactivity

Integration Tests
   ├─ theme-overrides.test.ts
   │   ├─ Component rendering with overrides
   │   ├─ Theme switching
   │   └─ Context-specific application
   │
   └─ component-targeting.test.ts
       └─ Wrapper components

E2E Tests
   └─ theme-overrides.spec.ts
       ├─ User switches theme
       ├─ Overrides apply correctly
       ├─ Performance within targets
       └─ No visual regressions
```

## Development Workflow

```
1. Theme Developer
   │
   ├──▶ Edit theme.ts
   │      └─ Add/modify componentOverrides
   │
   ├──▶ Save file
   │      └─ HMR triggers
   │
   └──▶ See changes instantly (< 100ms)

2. App Developer
   │
   ├──▶ Use ThemeButton/useThemeOverrides
   │      └─ Overrides applied automatically
   │
   ├──▶ Add component props
   │      └─ Props override theme defaults
   │
   └──▶ Theme-aware without tight coupling

3. Debug Mode
   │
   ├──▶ Open DevTools
   │      └─ [theme-overrides] logs visible
   │
   ├──▶ Hover component
   │      └─ Inspector shows active overrides
   │
   └──▶ Check cache stats
        └─ $theme.overrideStats
```

---

This architecture provides a flexible, performant, and type-safe foundation for theme-based component customization while maintaining simplicity and backward compatibility.
