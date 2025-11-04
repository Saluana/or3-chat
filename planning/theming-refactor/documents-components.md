---

# Documents Components Themeability Analysis

## Verdict

**Low** – Minimal hardcoded colors. Most components already use semantic tokens. Quick fixes needed.

## Executive Summary

-   **DocumentEditorRoot** has hardcoded `bg-white/10 dark:bg-black/10` backdrop
-   **LazyEditorHost** skeleton uses `bg-neutral-*` hardcoding and `bg-white dark:bg-neutral-900` modal
-   **ToolbarButton** hardcodes `bg-primary/40` for active state
-   Most other components properly use CSS variables ✓
-   No critical bugs or type holes

---

## Findings

### 1. DocumentEditorRoot.vue - Backdrop Hardcoding

**Severity**: Medium  
**Evidence**: Line 3

```vue
class="flex flex-col h-full w-full bg-white/10 dark:bg-black/10
backdrop-blur-sm"
```

**Why**: Not themeable; forces specific opacity values.

**Fix**: Extract to CSS variable:

```css
/* theme/default/main.css */
:root {
    --app-editor-backdrop: rgba(255, 255, 255, 0.1);
}
.dark {
    --app-editor-backdrop: rgba(0, 0, 0, 0.1);
}
```

```vue
class="flex flex-col h-full w-full bg-[var(--app-editor-backdrop)]
backdrop-blur-sm"
```

**Tests**: Visual test in light/dark mode.

---

### 2. LazyEditorHost.vue - Skeleton Hardcoding

**Severity**: Medium  
**Evidence**: Lines 16, 20, 27, 37, 44

```vue
class="bg-neutral-300/30 dark:bg-neutral-700/30 rounded animate-pulse"
class="bg-white dark:bg-neutral-900 rounded-lg p-6"
```

**Why**: Hardcoded neutral grays not themeable; error modal background arbitrary.

**Fix**: Extract skeleton colors:

```css
:root {
    --app-skeleton-bg: rgba(212, 212, 212, 0.3);
    --app-skeleton-modal-bg: var(--md-surface-container);
}
.dark {
    --app-skeleton-bg: rgba(64, 64, 64, 0.3);
}
```

```vue
class="bg-[var(--app-skeleton-bg)] rounded animate-pulse"
class="bg-[var(--app-skeleton-modal-bg)] rounded-lg p-6"
```

**Tests**: Visual test of loading skeleton in both modes.

---

### 3. LazyEditorHost.vue - Error Text Hardcoding

**Severity**: Low  
**Evidence**: Line 48

```vue
<p class="text-red-600 dark:text-red-400 mb-4">
```

**Why**: Direct red not themeable.

**Fix**: Use semantic error token:

```vue
<p class="text-[var(--md-error)] mb-4">
```

**Tests**: Error state visual test.

---

### 4. ToolbarButton.vue - Active State Hardcoding

**Severity**: Medium  
**Evidence**: Line 6

```vue
:class="[ active ? 'bg-primary/40 aria-[pressed=true]:outline' : 'opacity-80
hover:opacity-100', ]"
```

**Why**: `bg-primary/40` hardcodes opacity; not overridable by themes.

**Fix**: Extract to variable:

```css
:root {
    --app-toolbar-btn-active-bg: color-mix(
        in srgb,
        var(--md-primary) 40%,
        transparent
    );
}
```

```vue
:class="[ active ? 'bg-[var(--app-toolbar-btn-active-bg)]
aria-[pressed=true]:outline' : 'opacity-80 hover:opacity-100', ]"
```

**Tests**: Toolbar button state test across themes.

---

### 5. LazySearchPanel.vue - Text Color (Minor)

**Severity**: Nit  
**Evidence**: Line 15

```vue
<div class="text-sm text-[var(--md-on-surface-variant)]">
```

**Why**: Already using semantic token ✓ (no fix needed, documentation only)

**Fix**: None required.

**Tests**: None.

---

### 6. SearchPanelRoot.vue - Already Themeable ✓

**Severity**: None  
**Evidence**: Lines 8, 14, 15

```vue
class="text-[var(--md-on-surface)]" class="text-[var(--md-on-surface-variant)]"
```

**Why**: Properly uses CSS variables throughout.

**Fix**: None required.

**Tests**: None.

---

## Performance Notes

No performance impact. Minimal CSS variable additions.

---

## Deletions

None.

---

## Documents Components Checklist

-   [x] Replace `bg-white/10 dark:bg-black/10` in DocumentEditorRoot
-   [x] Replace all `bg-neutral-*` in LazyEditorHost skeleton
-   [x] Replace `text-red-*` with `--md-error` in error states
-   [x] Extract `bg-primary/40` in ToolbarButton to CSS variable
-   [x] Test editor loading states in both themes
-   [x] Test toolbar button active states across themes
