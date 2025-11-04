I'll analyze all chat components to identify changes needed for better themeability.

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/ChatContainer.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/ChatInputDropper.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/ChatMessage.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/LoadingGenerating.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/MessageAttachmentsGallery.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/MessageEditor.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/ModelSelect.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/ReasoningAccordion.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/SystemPromptsModal.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/ToolCallIndicator.vue)

Read [](file:///Users/brendon/Documents/or3-chat/app/components/chat/VirtualMessageList.vue)

I'll analyze all the chat components for themeability issues.

Thinking

## Chat Components Themeability Analysis

### Verdict

**Medium** – Multiple hardcoded colors exist but no type holes or critical bugs. Refactoring needed for theme flexibility.

### Executive Summary

-   **ChatInputDropper** has hardcoded drag state colors (`blue-500`, `blue-50`)
-   **ChatMessage** uses hardcoded button backgrounds (`bg-primary`, `bg-white`) and message bubble colors
-   **ModelSelect** hardcodes `bg-white dark:bg-gray-800` and `border-black`
-   **SystemPromptsModal** has extensive gray-scale hardcoding (`text-gray-*`, `bg-gray-*`)
-   Multiple components use `text-black dark:text-white` instead of semantic tokens
-   Error/success states use direct color names instead of CSS variables

---

## Findings

### 1. ChatInputDropper.vue - Drag State Colors

**Severity**: Medium  
**Evidence**: Lines 2-11, 142-152

```vue
:class="[ isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' :
'hover:border-[var(--md-primary)]' ]"
```

**Why**: Hardcoded blue breaks theme consistency. Non-themeable feedback.

**Fix**: Create CSS variables for drag states:

```css
:root {
    --app-drag-border: var(--md-primary);
    --app-drag-bg: color-mix(in srgb, var(--md-primary) 10%, transparent);
}
.dark {
    --app-drag-bg: color-mix(in srgb, var(--md-primary) 20%, transparent);
}
```

```vue
:class="[ isDragging ? 'border-[var(--app-drag-border)] bg-[var(--app-drag-bg)]'
: 'hover:border-[var(--md-primary)]' ]"
```

**Tests**: Visual regression test for drag overlay in both themes.

---

### 2. ChatInputDropper.vue - Error Button Colors

**Severity**: Low  
**Evidence**: Lines 358-362

```vue
<button
    class="retro-shadow bg-error border-black border bg-opacity-60"
>
```

**Why**: `border-black` not themeable, breaks on light backgrounds.

**Fix**: Replace with semantic border:

```vue
class="retro-shadow bg-error border-[var(--md-inverse-surface)] border
bg-opacity-60"
```

**Tests**: Screenshot test of error state in light/dark mode.

---

### 3. ChatMessage.vue - Message Bubble Colors

**Severity**: High  
**Evidence**: Lines 136-144

```typescript
const outerClass = computed(() => ({
    'bg-primary text-white dark:text-black ...': props.message.role === 'user',
    'bg-white/5 border-2 ...': props.message.role === 'assistant',
}));
```

**Why**: User messages hardcode `bg-primary`, assistant uses `bg-white/5`. Not overridable by themes.

**Fix**: Extract to CSS variables in theme files:

```css
/* theme/default/main.css */
:root {
    --app-msg-user-bg: var(--md-primary);
    --app-msg-user-text: var(--md-on-primary);
    --app-msg-assistant-bg: rgba(255, 255, 255, 0.05);
    --app-msg-assistant-border: var(--md-inverse-surface);
}
.dark {
    --app-msg-user-text: var(--md-inverse-on-primary);
}
```

```typescript
const outerClass = computed(() => ({
    'bg-[var(--app-msg-user-bg)] text-[var(--app-msg-user-text)] ...':
        props.message.role === 'user',
    'bg-[var(--app-msg-assistant-bg)] border-2 border-[var(--app-msg-assistant-border)] ...':
        props.message.role === 'assistant',
}));
```

**Tests**: Vitest snapshot test for computed classes; visual test for both message types.

---

### 4. ChatMessage.vue - Button Group Background

**Severity**: Medium  
**Evidence**: Lines 536-540

```vue
<UButtonGroup
    :class="{
        'bg-primary': props.message.role === 'user',
        'bg-white': props.message.role === 'assistant',
    }"
>
```

**Why**: Hardcoded backgrounds; `bg-white` breaks dark mode intent.

**Fix**: Use semantic variables:

```vue
<UButtonGroup
    :class="{
        'bg-[var(--app-msg-user-bg)]': props.message.role === 'user',
        'bg-[var(--app-msg-assistant-actions-bg)]': props.message.role === 'assistant',
    }"
>
```

Add to CSS:

```css
:root {
    --app-msg-assistant-actions-bg: var(--md-surface-container-high);
}
```

**Tests**: Visual test for action buttons on both message types.

---

### 5. ModelSelect.vue - Hardcoded Backgrounds

**Severity**: Medium  
**Evidence**: Line 7

```vue
class="... bg-white dark:bg-gray-800 ..."
```

**Why**: Not themeable. Gray-800 arbitrary.

**Fix**: Replace with:

```vue
class="... bg-[var(--md-surface-container)] ..."
```

**Tests**: Visual test in light/dark/HC modes.

---

### 6. SystemPromptsModal.vue - Gray Hardcoding

**Severity**: High  
**Evidence**: Lines 8, 85, 106, 133

```vue
class="bg-white/70 dark:bg-neutral-900/60" class="text-gray-900 dark:text-white"
class="text-gray-500 dark:text-gray-400" class="bg-white/80 not-odd:bg-primary/5
dark:bg-neutral-900/70"
```

**Why**: Extensive use of hardcoded grays prevents theme customization.

**Fix**: Extract to CSS variables:

```css
:root {
    --app-modal-header-bg: rgba(255, 255, 255, 0.7);
    --app-modal-item-bg: rgba(255, 255, 255, 0.8);
    --app-modal-item-odd-bg: color-mix(
        in srgb,
        var(--md-primary) 5%,
        transparent
    );
    --app-modal-text: var(--md-on-surface);
    --app-modal-text-muted: var(--md-on-surface-variant);
}
.dark {
    --app-modal-header-bg: rgba(23, 23, 23, 0.6);
    --app-modal-item-bg: rgba(23, 23, 23, 0.7);
}
```

Replace all instances with variable references.

**Tests**: Full modal interaction test in both themes; accessibility color contrast test.

---

### 7. ChatInputDropper.vue - Text Color Overrides

**Severity**: Low  
**Evidence**: Lines 33, 48, 68, 249

```vue
class="text-black dark:text-white"
```

**Why**: Forces text color, may conflict with button color variants.

**Fix**: Remove explicit text color; let component variants handle it OR use semantic token:

```vue
class="text-[var(--md-on-primary-container)]"
```

**Tests**: Button contrast test across all color variants.

---

### 8. ChatInputDropper.vue - Drag Overlay Icon Color

**Severity**: Nit  
**Evidence**: Lines 343-352

```vue
<UIcon
    name="i-lucide:upload-cloud"
    class="w-12 h-12 mx-auto mb-3 text-blue-500"
/>
<p class="text-blue-600 dark:text-blue-400 ...">
```

**Why**: Hardcoded blues for upload feedback.

**Fix**: Use theme primary:

```vue
<UIcon
    class="w-12 h-12 mx-auto mb-3 text-[var(--md-primary)]"
/>
<p class="text-[var(--md-primary)] ...">
```

**Tests**: Visual drag state test.

---

### 9. ModelSelect.vue - Border Hardcoding

**Severity**: Low  
**Evidence**: Line 44

```vue
ui: { content: 'border-[2px] border-black rounded-[3px] w-[320px]', }
```

**Why**: `border-black` not themeable.

**Fix**: Replace:

```typescript
ui: {
  content: 'border-[2px] border-[var(--md-inverse-surface)] rounded-[3px] w-[320px]',
}
```

**Tests**: Visual test of dropdown in both modes.

---

## Performance Notes

No performance impact. Replacing hardcoded values with CSS variables is zero-cost at runtime (already using Tailwind arbitrary values).

---

## Deletions

None. All code is functional; only needs value replacements.

---

## Checklist for Merge

-   [ ] Extract all color values to CSS variables in `theme/default/main.css`
-   [ ] Replace hardcoded `bg-white`, `bg-gray-*`, `text-gray-*` with semantic tokens
-   [ ] Replace all `border-black` with `border-[var(--md-inverse-surface)]`
-   [ ] Replace hardcoded blues/reds with `--md-primary`, `--md-error` or new `--app-*` variables
-   [ ] Test all components in light, dark, and HC modes
-   [ ] Run accessibility color contrast checks on all new variables
-   [ ] Update component snapshots if using visual regression
-   [ ] Document new `--app-*` variables in design.md appendix
