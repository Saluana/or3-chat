# useScrollLock

Utility composable that locks and unlocks body (or any element) scroll, essential for mobile overlays and modals. Manages `overflow` CSS property with automatic cleanup and optional reactive control.

Think of `useScrollLock` as your scroll blocker — when you show a mobile menu or modal overlay, call `lock()` to prevent the background from scrolling while the user interacts with the overlay.

---

## Purpose

`useScrollLock` solves the common UX problem: when a modal or menu opens on mobile, the page background shouldn't scroll. When you want to:

-   Disable scroll on body when opening a mobile overlay
-   Show a fullscreen menu or modal
-   Re-enable scroll when closing
-   Automatically unlock on component unmount
-   Track lock state

...this composable handles all of that for you.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useScrollLock } from '~/composables/core/useScrollLock';
import { ref } from 'vue';

const menuOpen = ref(false);
const { lock, unlock } = useScrollLock();

function openMenu() {
    menuOpen.value = true;
    lock();
}

function closeMenu() {
    menuOpen.value = false;
    unlock();
}
</script>

<template>
    <div>
        <button @click="openMenu">Open Menu</button>

        <!-- Mobile overlay menu -->
        <div v-if="menuOpen" class="fixed inset-0">
            <div class="absolute inset-0 bg-black/50" @click="closeMenu"></div>
            <nav class="fixed inset-y-0 left-0 w-80 bg-white">
                <!-- Menu items -->
                <button @click="closeMenu">Close</button>
            </nav>
        </div>
    </div>
</template>
```

---

## How to use it

### 1. Lock and unlock scroll

```ts
const { lock, unlock } = useScrollLock();

// Prevent background scrolling
lock();

// Re-enable scrolling
unlock();
```

### 2. With reactive state (automatic)

```ts
import { ref } from 'vue';
import { useScrollLock } from '~/composables/core/useScrollLock';

const isOpen = ref(false);
const { isLocked } = useScrollLock({
    controlledState: isOpen,
});

// Scroll is automatically locked when isOpen.value = true
// Scroll is automatically unlocked when isOpen.value = false
isOpen.value = true; // ← scroll locked automatically
isOpen.value = false; // ← scroll unlocked automatically
```

### 3. Lock specific element (not body)

```ts
const containerRef = ref<HTMLElement | null>(null);

const { lock, unlock } = useScrollLock({
    target: () => containerRef.value,
});

// Now locks the container instead of body
lock();
```

### 4. Check lock state

```ts
const { isLocked, lock, unlock } = useScrollLock();

// Read current lock state
if (isLocked.value) {
    console.log('Scroll is currently locked');
}
```

### 5. Manual toggle

```ts
const { lock, unlock, isLocked } = useScrollLock();

function toggleLock() {
    if (isLocked.value) {
        unlock();
    } else {
        lock();
    }
}
```

---

## What you get back

When you call `useScrollLock()`, you get an object with:

| Property   | Type           | Description                       |
| ---------- | -------------- | --------------------------------- |
| `lock`     | `function`     | Lock scroll on the target element |
| `unlock`   | `function`     | Unlock scroll                     |
| `isLocked` | `Ref<boolean>` | Current lock state                |

---

## Options

### UseScrollLockOptions

```ts
interface UseScrollLockOptions {
    target?: () => HTMLElement | null | undefined;
    controlledState?: Ref<boolean>;
}
```

#### `target`

**Type**: `() => HTMLElement | null | undefined`

Function that returns the element to lock. If not provided, locks `document.body`.

```ts
const element = ref<HTMLElement | null>(null);

const { lock } = useScrollLock({
    target: () => element.value,
});

// Locks the specific element, not body
```

#### `controlledState`

**Type**: `Ref<boolean>`

When provided, scroll lock is automatically managed based on this ref's value:

-   `true` → scroll is locked
-   `false` → scroll is unlocked

```ts
const isOpen = ref(false);
const { isLocked } = useScrollLock({
    controlledState: isOpen,
});

isOpen.value = true; // ← automatically locked
isOpen.value = false; // ← automatically unlocked
console.log(isLocked.value); // false
```

---

## How it works

### Lock mechanism

When you call `lock()`:

1. Resolves target element (body by default)
2. Saves current `overflow` style
3. Sets `overflow: hidden`
4. Marks as locked

```ts
function lock() {
    target.style.overflow = 'hidden';
}
```

### Unlock mechanism

When you call `unlock()`:

1. Restores previous `overflow` value
2. Cleans up references
3. Marks as unlocked

```ts
function unlock() {
    target.style.overflow = previousValue;
}
```

### Automatic cleanup

The composable automatically unlocks on component unmount:

```ts
onBeforeUnmount(() => {
    performUnlock();
});
```

This prevents scroll from staying locked if the component is destroyed while locked.

---

## Common patterns

### Mobile overlay sidebar

```vue
<script setup>
import { ref } from 'vue';
import { useScrollLock } from '~/composables/core/useScrollLock';

const sidebarOpen = ref(false);
const { lock, unlock } = useScrollLock();

function openSidebar() {
    sidebarOpen.value = true;
    lock();
}

function closeSidebar() {
    sidebarOpen.value = false;
    unlock();
}
</script>

<template>
    <div>
        <button @click="openSidebar">☰</button>

        <!-- Mobile sidebar overlay -->
        <Teleport v-if="sidebarOpen" to="body">
            <div class="fixed inset-0 z-50">
                <div
                    class="absolute inset-0 bg-black/50"
                    @click="closeSidebar"
                ></div>
                <aside class="fixed inset-y-0 left-0 w-64 bg-white">
                    <button @click="closeSidebar">Close</button>
                </aside>
            </div>
        </Teleport>
    </div>
</template>
```

### Modal with automatic lock

```vue
<script setup>
import { ref } from 'vue';
import { useScrollLock } from '~/composables/core/useScrollLock';

const modalOpen = ref(false);

// Scroll automatically locks/unlocks with modalOpen
const { isLocked } = useScrollLock({
    controlledState: modalOpen,
});
</script>

<template>
    <div>
        <button @click="modalOpen = true">Open Modal</button>

        <Transition name="fade">
            <div
                v-if="modalOpen"
                class="fixed inset-0 bg-black/50 flex items-center justify-center"
            >
                <div class="bg-white rounded-lg p-6 max-w-md">
                    <h2>Modal Title</h2>
                    <p>Scroll is locked while this is open</p>
                    <button @click="modalOpen = false">Close</button>
                </div>
            </div>
        </Transition>
    </div>
</template>
```

### Lock specific scrollable container

```vue
<script setup>
import { ref } from 'vue';
import { useScrollLock } from '~/composables/core/useScrollLock';

const scrollableRef = (ref < HTMLElement) | (null > null);
const isLocked = ref(false);

const { lock, unlock } = useScrollLock({
    target: () => scrollableRef.value,
});

function toggleLock() {
    if (isLocked.value) {
        unlock();
    } else {
        lock();
    }
    isLocked.value = !isLocked.value;
}
</script>

<template>
    <div>
        <button @click="toggleLock">
            {{ isLocked ? 'Unlock' : 'Lock' }} Scrolling
        </button>

        <div ref="scrollableRef" class="overflow-auto h-96">
            <!-- Scrollable content -->
        </div>
    </div>
</template>
```

---

## Important notes

### Preserves existing overflow

The composable saves the previous `overflow` value before locking:

```ts
// If element already had overflow: auto
element.style.overflow = 'hidden'; // saved as 'auto'

// unlock() restores it
element.style.overflow = 'auto'; // restored!
```

### Automatic cleanup on unmount

```ts
onBeforeUnmount(() => {
    performUnlock(); // Always cleans up
});
```

If you open a scroll lock and destroy the component, it automatically unlocks.

### SSR-safe

The composable checks for `window` before trying to lock:

```ts
function resolveTarget(): HTMLElement | null {
    if (typeof window === 'undefined') return null; // SSR returns null
    return document.body;
}
```

### Multiple locks don't conflict

If you call `lock()` twice, the second call is ignored:

```ts
lock();
lock(); // ← no-op

unlock(); // Fully unlocks
```

### Works with transitions

Perfect for use with Vue Transition:

```vue
<Transition
    enter-active-class="transition-opacity duration-200"
    leave-active-class="transition-opacity duration-200"
>
    <div v-if="modalOpen" @enter="lock" @leave="unlock">
        <!-- Modal content -->
    </div>
</Transition>
```

---

## Troubleshooting

### Scroll still scrolls when locked

**Problem**: `lock()` was called but page still scrolls

**Solutions**:

1. Make sure the element is actually the page (use default or `document.body`)
2. Check CSS: Is there a higher-specificity overflow rule?
3. Verify target element exists before locking

```ts
const { lock, isLocked } = useScrollLock();
lock();
console.log(isLocked.value); // Should be true
console.log(document.body.style.overflow); // Should be 'hidden'
```

### Scroll locked after closing component

**Problem**: Page stays locked even after modal closes

**Solutions**:

1. Call `unlock()` before destroying the component
2. Use `controlledState` option (automatic cleanup)
3. Ensure `unlock()` is in a route guard or `beforeUnmount` hook

```ts
// ✅ GOOD: Uses controlled state
const isOpen = ref(false);
const { lock } = useScrollLock({ controlledState: isOpen });

// ✅ GOOD: Explicit cleanup
onBeforeUnmount(() => unlock());
```

### Conflicts with other scroll manipulation

**Problem**: Multiple libraries trying to control scroll

**Solution**: Use a single `useScrollLock` instance per overlay:

```ts
// Each modal/overlay gets its own lock instance
const modal1 = useScrollLock();
const modal2 = useScrollLock();

// Only one can be locked at a time (CSS side-effect)
modal1.lock();
modal2.lock(); // ← overwrites modal1's lock
```

---

## Performance notes

### No event listeners

Unlike solutions that use resize/scroll events, `useScrollLock` only modifies CSS:

-   Instant (no listeners/timers)
-   Doesn't interfere with scroll events
-   Safe to call repeatedly

### Minimal memory footprint

Only stores:

-   Previous overflow value (string)
-   Locked element reference (if custom target)
-   Lock state (boolean)

---

## Related

-   `useResponsiveState` — detect mobile/desktop viewports
-   Tailwind's `overflow-hidden` class — CSS alternative for static hiding
-   Vue Transition — smoothly animate overlays (often paired with lock)

---

## TypeScript

Full type signature:

```ts
function useScrollLock(options?: UseScrollLockOptions): {
    lock: () => void;
    unlock: () => void;
    isLocked: Ref<boolean>;
};

interface UseScrollLockOptions {
    target?: () => HTMLElement | null | undefined;
    controlledState?: Ref<boolean>;
}

type ScrollLockHandle = ReturnType<typeof useScrollLock>;
```

---

Document generated from `app/composables/core/useScrollLock.ts` implementation.
