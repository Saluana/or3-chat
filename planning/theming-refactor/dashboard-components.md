# Dashboard Components Themeability Analysis

## Verdict

**Medium** – Several hardcoded colors exist but good foundation. Needs systematic refactoring.

## Executive Summary

-   **AiPage** uses hardcoded `bg-primary/50` for active chip state
-   **Dashboard** has hardcoded border colors and hover states (`border-[var(--md-primary)]` acceptable, but `bg-[var(--md-primary)]/5` mixed)
-   **PluginCapabilities** properly uses CSS variables ✓
-   **PluginIcons** has extensive hardcoded gradients and shadows (`ring-1 ring-black/5 dark:ring-white/10`)
-   **ThemePage** has hardcoded skeleton `bg-neutral-*` and extensive inline styles that should use CSS variables
-   **ThemeSelector** uses hardcoded `border-black`, `bg-yellow-200`, `bg-gray-900` and other color values
-   **WorkspaceBackupApp** properly uses CSS variables in scoped styles ✓ but has some inline color-mix usage

---

## Findings

### 1. AiPage.vue - Active Chip Background

**Severity**: Medium  
**Evidence**: Lines 28, 43

```vue
:class="{ 'bg-primary/50 hover:bg-primary/50': settings.defaultModelMode ===
'lastSelected', }"
```

**Why**: Hardcoded opacity; not overridable by themes.

**Fix**: Extract to CSS variable:

```css
:root {
    --app-chip-active-bg: color-mix(
        in srgb,
        var(--md-primary) 50%,
        transparent
    );
}
```

```vue
:class="{ 'bg-[var(--app-chip-active-bg)] hover:bg-[var(--app-chip-active-bg)]':
settings.defaultModelMode === 'lastSelected', }"
```

**Tests**: Visual test of chip states across themes.

---

### 2. Dashboard.vue - Border and Hover Hardcoding

**Severity**: Low  
**Evidence**: Line 48

```vue
class="border-2 rounded-lg hover:border-[var(--md-primary)]
hover:bg-[var(--md-primary)]/5"
```

**Why**: Mixed approach - border uses variable but background uses inline opacity.

**Fix**: Extract hover background:

```css
:root {
    --app-dashboard-item-hover-bg: color-mix(
        in srgb,
        var(--md-primary) 5%,
        transparent
    );
}
```

```vue
class="border-2 rounded-lg hover:border-[var(--md-primary)]
hover:bg-[var(--app-dashboard-item-hover-bg)]"
```

**Tests**: Dashboard card hover test.

---

### 3. PluginIcons.vue - Extensive Hardcoding

**Severity**: High  
**Evidence**: Lines 8-13, 21, 35

```vue
:class="[ retro ?
'shadow-[0_0_0_2px_var(--md-outline),0_2px_0_0_#000,0_2px_0_2px_var(--md-outline)]
... bg-[linear-gradient(...)]' : 'ring-1 ring-black/5 dark:ring-white/10
bg-gradient-to-br from-gray-800/40 to-gray-700/20', ]"
```

```vue
class="bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.12)...),repeating-linear-gradient(90deg,rgba(0,0,0,0.05)...)]"
```

**Why**: Extensive hardcoded shadows, gradients, and colors. Non-retro mode uses arbitrary grays.

**Fix**: Extract to CSS classes with theme variables:

```css
:root {
    --app-icon-shadow-retro: 0 0 0 2px var(--md-outline), 0 2px 0 0 var(--md-inverse-surface),
        0 2px 0 2px var(--md-outline);
    --app-icon-bg-retro: linear-gradient(
        145deg,
        var(--md-surface-container-high) 0%,
        var(--md-surface-container) 60%,
        var(--md-surface) 100%
    );
    --app-icon-ring: var(--md-outline-variant);
    --app-icon-bg-non-retro: linear-gradient(
        135deg,
        var(--md-surface-container-low),
        var(--md-surface)
    );
    --app-icon-noise: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.12) 0 1px,
            transparent 1px 2px
        ), repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0 2px, rgba(
                    255,
                    255,
                    255,
                    0.05
                ) 2px 4px);
}
```

Create utility classes `.retro-icon-shell` and `.non-retro-icon-shell`.

**Tests**: Icon rendering test in both retro and non-retro modes across themes.

---

### 4. ThemePage.vue - Drag Hint Hardcoding

**Severity**: Medium  
**Evidence**: Lines 1064-1072 (scoped style)

```css
background: linear-gradient(rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.58));
text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(0, 0, 0, 0.9);
-webkit-text-stroke: 0.25px rgba(0, 0, 0, 0.6);
```

**Why**: Hardcoded black overlays/shadows not themeable.

**Fix**: Extract to CSS variables:

```css
:root {
    --app-drop-hint-bg: rgba(0, 0, 0, 0.58);
    --app-drop-hint-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(0, 0, 0, 0.9);
    --app-drop-hint-stroke: rgba(0, 0, 0, 0.6);
}
.dark {
    --app-drop-hint-bg: rgba(255, 255, 255, 0.12);
    --app-drop-hint-text-shadow: 0 1px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px
            rgba(255, 255, 255, 0.25);
    --app-drop-hint-stroke: rgba(255, 255, 255, 0.25);
}
```

**Tests**: Drag/drop overlay visual test.

---

### 5. ThemeSelector.vue - Multiple Hardcodings

**Severity**: High  
**Evidence**: Lines 26, 32, 34, 38, 62

```vue
class="border-black hover:border-primary/50" class="w-3 h-3 rounded-full
bg-white border border-black" class="w-3 h-3 rounded-full bg-black" class="w-3
h-3 rounded-full bg-yellow-200 border-2 border-black" class="w-3 h-3
rounded-full bg-gray-900 border-2 border-white" class="text-xs px-1 py-0.5
bg-black/10 rounded border border-black/50"
```

**Why**: Extensive hardcoded colors; not themeable. Uses arbitrary color names.

**Fix**: Replace all instances:

```css
:root {
    --app-theme-option-border: var(--md-outline);
    --app-theme-option-hover-border: var(--md-primary);
    --app-theme-preview-light: var(--md-surface);
    --app-theme-preview-dark: var(--md-inverse-surface);
    --app-theme-preview-hc-light: var(--md-extended-color-warning-color);
    --app-theme-preview-hc-dark: var(--md-inverse-on-surface);
    --app-theme-badge-bg: color-mix(
        in srgb,
        var(--md-surface-variant) 30%,
        transparent
    );
    --app-theme-badge-border: var(--md-outline-variant);
}
```

```vue
class="border-[var(--app-theme-option-border)]
hover:border-[var(--app-theme-option-hover-border)]" class="w-3 h-3 rounded-full
bg-[var(--app-theme-preview-light)] border border-[var(--md-outline)]"
class="w-3 h-3 rounded-full bg-[var(--app-theme-preview-dark)]" class="w-3 h-3
rounded-full bg-[var(--app-theme-preview-hc-light)] border-2
border-[var(--md-outline)]" class="w-3 h-3 rounded-full
bg-[var(--app-theme-preview-hc-dark)] border-2 border-[var(--md-surface)]"
class="text-xs px-1 py-0.5 bg-[var(--app-theme-badge-bg)] rounded border
border-[var(--app-theme-badge-border)]"
```

**Tests**: Theme selector preview dots and badges across themes.

---

### 6. ThemeSelector.vue - Background Pattern Hardcoding

**Severity**: Low  
**Evidence**: Lines 155-159 (scoped style)

```css
background: linear-gradient(45deg, var(--md-surface) 25%, transparent 25%),
    linear-gradient(-45deg, var(--md-surface) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--md-surface) 75%),
    linear-gradient(-45deg, transparent 75%, var(--md-surface) 75%);
```

**Why**: Pattern already uses theme variable ✓ (no fix needed, documentation only).

**Fix**: None required.

**Tests**: None.

---

### 7. WorkspaceBackupApp.vue - Color-Mix Inline Usage

**Severity**: Low  
**Evidence**: Lines 800-950 (scoped styles - multiple instances)

```css
background: color-mix(
    in oklab,
    var(--md-surface) 94%,
    var(--md-surface-variant) 6%
);
```

**Why**: Inline color-mix is acceptable but could be extracted for consistency.

**Fix**: Optional - extract commonly repeated mixes:

```css
:root {
    --app-backup-panel-bg: color-mix(
        in oklab,
        var(--md-surface) 94%,
        var(--md-surface-variant) 6%
    );
    --app-backup-card-bg: color-mix(
        in oklab,
        var(--md-surface) 92%,
        var(--md-surface-variant) 8%
    );
}
```

**Tests**: Visual test of backup UI.

---

### 8. PluginCapabilities.vue - Already Themeable ✓

**Severity**: None  
**Evidence**: Lines 27-66 (scoped styles)

```css
border: 1px solid var(--md-outline-variant);
background: var(--md-surface-container-low);
color: var(--md-on-surface);
```

**Why**: Properly uses CSS variables throughout.

**Fix**: None required.

**Tests**: None.

---

## Performance Notes

No performance impact. CSS variable extraction is zero-cost.

---

## Deletions

None.

---

## Dashboard Components Checklist

-   [ ] Replace `bg-primary/50` in AiPage with CSS variable
-   [ ] Extract hover states in Dashboard to CSS variables
-   [ ] Refactor PluginIcons gradients and shadows to CSS classes
-   [ ] Replace hardcoded drag hint colors in ThemePage
-   [ ] Replace all hardcoded colors in ThemeSelector (border-black, bg-yellow-200, etc.)
-   [ ] Optional: Extract repeated color-mix patterns in WorkspaceBackupApp
-   [ ] Test all dashboard components in light, dark, and HC modes
-   [ ] Verify icon rendering in both retro and non-retro modes
-   [ ] Test drag/drop overlays in ThemePage
