# useResponsiveState

Centralised responsive state helper that tracks viewport size and provides consistent mobile/desktop detection across your app. Enables SSR-safe responsive rendering without hydration mismatches.

Think of `useResponsiveState` as your single source of truth for breakpoint detection — instead of duplicating media query logic across components, use this composable to get consistent, reactive viewport state that works on both server and client.

---

## Purpose

`useResponsiveState` solves the hydration mismatch problem common in SSR frameworks. When you want to:

-   Detect if the viewport is mobile or desktop
-   Conditionally render layouts based on screen size
-   Build responsive UI without SSR/client mismatches
-   Use a single breakpoint system across your app

...this composable ensures consistent behavior on both server and client.

**Hydration-Safe Design**: The composable starts with `isMobile = false` on both server and client, then updates to the correct viewport state after hydration completes (via `requestAnimationFrame`). This prevents the "flash of incorrect layout" and hydration warnings that occur when server HTML doesn't match initial client render.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useResponsiveState } from '~/composables/core/useResponsiveState';

const { isMobile } = useResponsiveState();
</script>

<template>
    <div>
        <!-- Hide on mobile, show on desktop -->
        <aside v-show="!isMobile" class="hidden md:block">
            Desktop Sidebar
        </aside>

        <!-- Mobile menu -->
        <button v-show="isMobile" class="md:hidden">Open Menu</button>

        <!-- Responsive class binding -->
        <div :class="isMobile ? 'mobile-layout' : 'desktop-layout'">
            Content
        </div>
    </div>
</template>
```

---

## How to use it

### 1. Get responsive state

```ts
const { isMobile, isTablet } = useResponsiveState();

// isMobile: Ref<boolean> — true when viewport ≤ 768px
// isTablet: Ref<boolean> — true when viewport 769px–1023px
```

### 2. Conditionally render layouts

```vue
<template>
    <!-- Always render both with CSS hiding — prevents hydration issues -->
    <aside :class="isMobile ? 'hidden' : 'block'">Desktop sidebar</aside>
    <button :class="!isMobile ? 'hidden' : 'block'" @click="toggleMenu">
        Mobile menu
    </button>
</template>
```

### 3. Computed properties with responsive logic

```ts
const layoutClass = computed(() => (isMobile.value ? 'flex-col' : 'flex-row'));

const containerWidth = computed(() => (isMobile.value ? '100%' : '80vw'));

const itemsPerRow = computed(() =>
    isMobile.value ? 1 : isTablet.value ? 2 : 3
);
```

### 4. Watch for breakpoint changes

```ts
watch(isMobile, (mobile) => {
    if (mobile) {
        console.log('Switched to mobile view');
    } else {
        console.log('Switched to desktop view');
    }
});
```

### 5. Use with component logic

```ts
const { isMobile } = useResponsiveState();

// Adjust behavior based on viewport
function openSidebar() {
    if (isMobile.value) {
        // Show overlay sidebar
        showMobileSidebar.value = true;
    } else {
        // Desktop sidebar always visible
        showDesktopSidebar.value = true;
    }
}
```

---

## What you get back

When you call `useResponsiveState()`, you get an object with:

| Property   | Type           | Description                                |
| ---------- | -------------- | ------------------------------------------ |
| `isMobile` | `Ref<boolean>` | `true` when viewport width ≤ 768px         |
| `isTablet` | `Ref<boolean>` | `true` when viewport width is 769px–1023px |

---

## Breakpoints

The composable uses these fixed breakpoints:

| Breakpoint | Range      | Use Case                      |
| ---------- | ---------- | ----------------------------- |
| Mobile     | 0–768px    | Phones, small tablets         |
| Tablet     | 769–1023px | Large tablets, small desktops |
| Desktop    | 1024px+    | Desktops, large screens       |

These map to Tailwind's `md:` breakpoint, ensuring design consistency with your CSS classes.

---

## SSR Safety

This composable is **SSR-safe** by default:

### How it works

1. **During SSR** (server-side rendering):

    - `isMobile` returns `false` (assumes desktop)
    - `isTablet` returns `false`
    - Renders desktop layout on server

2. **Initial client render** (hydration phase):

    - `isMobile` **still** returns `false` (matches SSR)
    - No hydration mismatch occurs
    - HTML from server matches initial client DOM

3. **After hydration** (via `requestAnimationFrame`):

    - `window.matchMedia` listeners detect actual viewport
    - Updates to correct state (`isMobile: true` on mobile devices)
    - Vue's reactivity updates the DOM smoothly

4. **Result**:
    - Zero hydration mismatch warnings
    - Smooth transition from SSR → client
    - Desktop layout renders consistently until hydration completes

### Why this prevents hydration issues

Most responsive libraries fail on SSR because they immediately check viewport size on the client:

```ts
// ❌ WRONG: SSR renders false, client immediately renders true
// This causes "Hydration node mismatch" warnings
const media = window.matchMedia('(max-width: 768px)');
const isMobile = ref(media.matches); // Server: false, Client: immediately true!
```

Our approach delays the viewport check until after hydration:

```ts
// ✅ RIGHT: Both server and initial client render start with false
// Update happens after hydration via requestAnimationFrame
const { isMobile } = useResponsiveState();
// SSR: isMobile = false
// Client initial render: isMobile = false (matches SSR!)
// Client after hydration: isMobile updates to true if mobile
```

**Key insight**: By delaying the viewport detection by one frame, we ensure the initial client render produces the exact same HTML as the server, preventing hydration mismatches.

---

## Common patterns

### Hide on mobile, show on desktop

```vue
<!-- Using CSS classes (preferred - no DOM changes) -->
<div class="hidden md:flex">Desktop only</div>
<div class="md:hidden">Mobile only</div>

<!-- Using computed for custom logic -->
<div v-if="!isMobile">Desktop sidebar</div>
```

### Responsive grid

```ts
const gridCols = computed(() =>
    isMobile.value
        ? 'grid-cols-1'
        : isTablet.value
        ? 'grid-cols-2'
        : 'grid-cols-3'
);
```

### Toggle mobile menu

```vue
<script setup>
const { isMobile } = useResponsiveState();
const menuOpen = ref(false);

watch(isMobile, (mobile) => {
    // Auto-close mobile menu when resizing to desktop
    if (!mobile) {
        menuOpen.value = false;
    }
});
</script>

<template>
    <button v-show="isMobile" @click="menuOpen = !menuOpen" class="md:hidden">
        ☰ Menu
    </button>
    <nav :class="{ hidden: isMobile && !menuOpen }">
        <!-- Navigation items -->
    </nav>
</template>
```

### Responsive modal

```ts
const { isMobile } = useResponsiveState();

const modalClass = computed(() => ({
    'fixed inset-0': true,
    'rounded-md': !isMobile.value, // Rounded on desktop only
}));

const modalWidth = computed(() => (isMobile.value ? '100%' : '90%'));
```

### Fullscreen on mobile

```ts
const containerClass = computed(() =>
    isMobile.value ? 'fixed inset-0' : 'absolute bottom-4 right-4'
);
```

---

## Performance notes

### Efficient breakpoint detection

`useResponsiveState` uses `window.matchMedia` directly:

-   Low overhead
-   Native browser API
-   No polling or resize listeners
-   Event-driven updates only when breakpoints cross
-   Shared state across all components (single listener set)

### SSR performance

-   Server rendering uses simple `false` refs (instant)
-   No DOM diffing needed during hydration
-   Client upgrade is smooth with CSS-based hiding

### Best practices

```ts
// ✅ GOOD: Compute classes once
const layoutClass = computed(() =>
    isMobile.value ? 'flex-col' : 'flex-row'
);

// ✅ GOOD: Use CSS hiding for static content
<div class="hidden md:flex">Desktop</div>

// ❌ AVOID: Computing classes in template
<div :class="isMobile.value ? 'x' : 'y'"><!-- repeats on every render --></div>

// ❌ AVOID: Expensive watches
watch(isMobile, async () => {
    await expensiveOperation(); // Runs on resize!
});
```

---

## Troubleshooting

### Hydration mismatch warning

**Problem**: "Hydration mismatch: rendered on server... expected on client"

**Cause**: Using `v-if="isMobile"` creates different DOM structures between SSR (desktop) and client (mobile).

**Solution**: Always render both desktop and mobile versions, use CSS to hide:

```vue
<!-- ✅ GOOD: No mismatch - CSS hides appropriately -->
<div class="hidden md:flex">Desktop</div>
<div class="md:hidden">Mobile</div>

<!-- ✅ GOOD: Always rendered, visibility controlled by class -->
<button :class="isMobile ? 'md:hidden' : 'hidden md:block'">Menu</button>

<!-- ❌ BAD: Causes mismatch - different DOM on SSR vs client -->
<div v-if="!isMobile">Desktop</div>
<div v-else>Mobile</div>
```

**Why this works**: The composable returns consistent `false` during SSR. On the client, it updates immediately but the DOM structure stays the same—only CSS classes change.

### Breakpoint stuck on false

**Problem**: `isMobile` always returns `false`

**Check**:

1. Are you running on server? (Normal — SSR assumes desktop)
2. Is the component mounted? (VueUse activates on mount)
3. Inspect in DevTools: `$vue._instance.setupState.isMobile.value`

### Unnecessary re-renders

**Problem**: Template updates too often when resizing

**Solution**: Use `hidden/block` CSS instead of `v-if`:

```vue
<!-- Minimal re-renders -->
<div class="hidden md:block">{{ expensiveCompute }}</div>

<!-- Many re-renders -->
<div v-if="!isMobile">{{ expensiveCompute }}</div>
```

---

## Related

-   `useScrollLock` — lock body scroll on mobile overlays
-   Tailwind's `md:` breakpoint — styling breakpoint-aware UIs
-   MDN `window.matchMedia` — underlying browser API

---

## TypeScript

Full type signature:

```ts
function useResponsiveState(): {
    isMobile: Ref<boolean>;
    isTablet: Ref<boolean>;
};
```

---

## Example: Responsive sidebar + overlay

```vue
<template>
    <div>
        <!-- Desktop sidebar (always visible) -->
        <aside class="hidden md:flex w-64 bg-surface">
            <SidebarContent />
        </aside>

        <!-- Mobile overlay sidebar -->
        <Teleport to="body">
            <Transition name="slide">
                <div
                    v-if="sidebarOpen"
                    class="md:hidden fixed inset-0 z-50 bg-black/50"
                >
                    <aside class="w-80 bg-surface h-full overflow-auto">
                        <button
                            @click="sidebarOpen = false"
                            class="absolute top-4 right-4"
                        >
                            ✕
                        </button>
                        <SidebarContent />
                    </aside>
                </div>
            </Transition>
        </Teleport>

        <!-- Content -->
        <main>
            <button
                v-show="isMobile"
                @click="sidebarOpen = !sidebarOpen"
                class="md:hidden"
            >
                ☰
            </button>
            <Content />
        </main>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useResponsiveState } from '~/composables/core/useResponsiveState';

const { isMobile } = useResponsiveState();
const sidebarOpen = ref(false);

// Auto-close sidebar when switching to desktop
watch(isMobile, (mobile) => {
    if (!mobile) {
        sidebarOpen.value = false;
    }
});
</script>
```

---

Document generated from `app/composables/core/useResponsiveState.ts` implementation.
