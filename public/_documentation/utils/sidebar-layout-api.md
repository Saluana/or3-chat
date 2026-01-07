# Sidebar Layout API

Global API for controlling sidebar layout state from any component. Lets plugins close the sidebar on mobile, expand/collapse, or toggle visibility without event chain modifications.

Think of the sidebar layout API as a remote control for the sidebar — any plugin or component can grab it and control the sidebar's open/collapsed state without needing to emit events up the component tree.

---

## Purpose

The sidebar layout API provides:

- **Global sidebar control** — Close, open, expand, or collapse from anywhere
- **Mobile-first convenience** — `closeSidebarIfMobile()` handles responsive behavior
- **Zero event chains** — No need to modify PageShell for each new plugin
- **Safe fallbacks** — Gracefully handles cases where the API isn't available yet
- **Singleton pattern** — Consistent with other OR3 global APIs (`multiPaneApi`, etc.)

---

## Basic Example

```ts
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';

// In your component or plugin
function handleItemClick(id: string) {
    // Do something with the item
    openItem(id);
    
    // Close sidebar on mobile for better UX
    closeSidebarIfMobile();
}
```

---

## How to use it

### 1. Import the helper function

The simplest approach — just import and call the convenience function:

```ts
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';

function onWorkflowSelected(id: string) {
    navigateToWorkflow(id);
    closeSidebarIfMobile();  // Closes sidebar only on mobile
}
```

### 2. Access the full API

For more control, get the full API object:

```ts
import { getGlobalSidebarLayoutApi } from '~/utils/sidebarLayoutApi';

const sidebarApi = getGlobalSidebarLayoutApi();

if (sidebarApi) {
    // Check if we're on mobile
    if (sidebarApi.isMobile()) {
        sidebarApi.close();
    }
    
    // Or use the convenience method
    sidebarApi.closeSidebarIfMobile();
}
```

### 3. Use in a sidebar page plugin

```ts
// app/plugins/workflows/components/sidebar/WorkflowsTab.vue
<script setup lang="ts">
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';

function openWorkflow(id: string) {
    multiPane.switchToApp('or3-workflows', { recordId: id });
    closeSidebarIfMobile();
}
</script>
```

---

## API Reference

### `closeSidebarIfMobile()`

Convenience function that closes the sidebar only when on mobile.

```ts
function closeSidebarIfMobile(): void
```

Safe to call even if the API isn't available yet — it simply does nothing if PageShell hasn't mounted.

### `getGlobalSidebarLayoutApi()`

Get the full sidebar layout API if available.

```ts
function getGlobalSidebarLayoutApi(): SidebarLayoutApi | undefined
```

Returns `undefined` if PageShell hasn't mounted yet.

### `setGlobalSidebarLayoutApi(api)`

Set the global sidebar layout API. Called by PageShell on mount.

```ts
function setGlobalSidebarLayoutApi(api: SidebarLayoutApi | undefined): void
```

**Note:** This is called internally by `PageShell.vue` — you shouldn't need to call this directly.

---

## SidebarLayoutApi Interface

```ts
interface SidebarLayoutApi {
    /** Close the sidebar (useful for mobile after selection) */
    close: () => void;
    
    /** Open the sidebar */
    open: () => void;
    
    /** Toggle sidebar collapsed state (desktop) */
    toggleCollapse: () => void;
    
    /** Expand sidebar (uncollapse on desktop, open on mobile) */
    expand: () => void;
    
    /** Check if currently on mobile viewport */
    isMobile: () => boolean;
    
    /** Close sidebar only if on mobile - convenience method */
    closeSidebarIfMobile: () => void;
}
```

---

## How it works

### Initialization flow

1. App loads, `PageShell.vue` mounts
2. `PageShell` creates `SidebarLayoutApi` object with methods bound to `layoutRef`
3. API exposed globally via `setGlobalSidebarLayoutApi()`
4. Plugins can now call `closeSidebarIfMobile()` or `getGlobalSidebarLayoutApi()`

### Cleanup flow

1. `PageShell` unmounts (e.g., navigating away)
2. `onUnmounted` calls `setGlobalSidebarLayoutApi(undefined)`
3. Subsequent calls to `closeSidebarIfMobile()` safely no-op

---

## Common patterns

### Sidebar page with item selection

```ts
// When user taps an item, open it and close sidebar on mobile
function selectItem(id: string) {
    multiPane.switchToApp('my-app', { recordId: id });
    closeSidebarIfMobile();
}
```

### Conditional sidebar control

```ts
const sidebarApi = getGlobalSidebarLayoutApi();

if (sidebarApi?.isMobile()) {
    // Mobile-specific behavior
    sidebarApi.close();
} else if (sidebarApi) {
    // Desktop behavior - maybe collapse instead
    sidebarApi.toggleCollapse();
}
```

### Checking availability

```ts
const sidebarApi = getGlobalSidebarLayoutApi();

if (!sidebarApi) {
    console.warn('Sidebar API not available yet');
    return;
}

sidebarApi.expand();
```

---

## Existing usage in OR3

The sidebar layout API follows the same pattern used throughout OR3 for things like:

- **Chats** — `onSidebarSelected()` in PageShell calls `closeSidebarIfMobile()`
- **Documents** — `onDocumentSelected()` closes sidebar on mobile
- **New chat** — `onNewChat()` closes sidebar on mobile
- **Workflows** — Now uses `closeSidebarIfMobile()` from the global API

This keeps behavior consistent across all sidebar interactions.

---

## Best practices

### Always use the convenience function

```ts
// Good - safe and concise
import { closeSidebarIfMobile } from '~/utils/sidebarLayoutApi';
closeSidebarIfMobile();

// Also fine - when you need more control
const api = getGlobalSidebarLayoutApi();
api?.closeSidebarIfMobile();
```

### Don't cache the API object

```ts
// Bad - API might become undefined if PageShell remounts
const sidebarApi = getGlobalSidebarLayoutApi();
// ... later ...
sidebarApi?.close();  // Might be stale

// Good - get fresh reference when needed
getGlobalSidebarLayoutApi()?.close();
```

### Use for mobile UX improvements

The main use case is improving mobile UX by closing the sidebar after selection:

```ts
function onItemSelected(id: string) {
    doSomethingWithItem(id);
    closeSidebarIfMobile();  // <-- Mobile users see their content immediately
}
```

---

## Limitations

- **Client-side only** — The API is only available in the browser
- **Depends on PageShell** — Won't work before PageShell mounts
- **No reactive state** — The API provides methods, not reactive refs
- **Single instance** — Only one sidebar layout can be controlled

---

## Troubleshooting

### API returns undefined

The API isn't available until `PageShell.vue` mounts. This is normal during SSR or early in the app lifecycle.

```ts
// Safe pattern
const api = getGlobalSidebarLayoutApi();
if (api) {
    api.close();
}

// Or use the safe convenience function
closeSidebarIfMobile();  // No-ops if unavailable
```

### Sidebar not closing on mobile

- Verify you're actually on mobile viewport (≤768px)
- Check that `closeSidebarIfMobile()` is being called
- Ensure PageShell has mounted (API available)

### Method has no effect

- Make sure you're calling the right method for your use case
- `close()` closes the sidebar completely
- `toggleCollapse()` only affects desktop collapsed state
- `expand()` opens AND uncollapses

---

## Related

- `useResponsiveState` — Shared mobile detection used by the API
- `ResizableSidebarLayout` — The Vue component this API controls
- `multiPaneApi` — Similar global API pattern for pane management
- `PageShell` — Where the API is initialized and exposed

---

## TypeScript

Full type signature:

```ts
interface SidebarLayoutApi {
    close: () => void;
    open: () => void;
    toggleCollapse: () => void;
    expand: () => void;
    isMobile: () => boolean;
    closeSidebarIfMobile: () => void;
}

function getGlobalSidebarLayoutApi(): SidebarLayoutApi | undefined;
function setGlobalSidebarLayoutApi(api: SidebarLayoutApi | undefined): void;
function closeSidebarIfMobile(): void;
```

---

Document generated from `app/utils/sidebarLayoutApi.ts` implementation.
