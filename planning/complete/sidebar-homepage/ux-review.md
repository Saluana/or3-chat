# Sidebar Homepage Rework - UI/UX Review

## Executive Summary

**Risk Level: MEDIUM** - Several touch target and information density issues need addressing before implementation.

---

## Critical UI/UX Findings

### 1. Touch Targets Below WCAG Guidelines

**Issue:** Design specifies 32x32px icon containers. Apple HIG and WCAG require **44x44px minimum** touch targets.

**Current Design:**
```
┌──────────────────────────────────────┐
│ [32px icon] Title             2:14 PM│  ← 32x32 icon is NOT tappable
│             Chat              [•••]  │  ← [•••] button is ~16x16
└──────────────────────────────────────┘
```

**Recommendation:**
- Keep 32x32 visual icon size, but make the **entire row** the tap target (already a `RetroGlassBtn`)
- Increase action button (•••) hit area to 44x44 with padding even if visual is smaller
- On mobile: always show action button, don't use hover reveal

```vue
<!-- Action button with proper touch target -->
<span 
  class="p-3 -m-2"  <!-- Visual 16px, touch 40px+ -->
  role="button"
  tabindex="0"
>
  <UIcon :name="iconMore" class="w-4 h-4" />
</span>
```

---

### 2. Information Density on Mobile

**Issue:** Three elements compete for right-side space:
- Time display ("2:14 PM")
- Subtitle ("Chat" / "Document")  
- Action button (•••)

On narrow sidebars (200-240px mobile width), this causes truncation.

**Recommendation - Stacked Mobile Layout:**
```
Desktop (280px+):                Mobile (<280px):
┌─────────────────────────┐     ┌──────────────────┐
│ [icon] Title    2:14 PM │     │ [icon] Title [•]│
│        Chat      [•••]  │     │        2:14 PM   │
└─────────────────────────┘     └──────────────────┘
```

**Implementation:**
```vue
<div class="flex-1 min-w-0">
  <!-- Desktop: side-by-side -->
  <div class="hidden sm:flex items-center justify-between">
    <span class="truncate">{{ title }}</span>
    <span class="shrink-0 text-xs">{{ timeDisplay }}</span>
  </div>
  <!-- Mobile: stacked, action always visible -->
  <div class="sm:hidden flex items-center justify-between">
    <span class="truncate">{{ title }}</span>
    <ActionButton class="opacity-100" />  <!-- Always visible -->
  </div>
  <div class="sm:hidden text-xs opacity-50">{{ timeDisplay }}</div>
</div>
```

---

### 3. Section Headers Need Clear Affordance

**Issue:** Collapsible section headers ("Today", "Yesterday") need clear visual indication they are interactive.

**Recommendation:**
- Add chevron icon (down when expanded, right when collapsed)
- Add hover state on desktop
- Add tap highlight on mobile
- Ensure 44px minimum height

```vue
<button 
  class="w-full h-11 flex items-center justify-between px-3 
         hover:bg-[var(--md-surface-hover)]
         active:bg-[var(--md-surface-pressed)]"
>
  <span class="text-sm font-medium opacity-70">{{ label }}</span>
  <UIcon 
    :name="collapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'"
    class="w-4 h-4 opacity-50"
  />
</button>
```

---

### 4. Navigation Buttons Placement

**Issue:** "Chats" and "Docs" navigation buttons could clutter the already-dense sidebar.

**Recommendation - Segmented Control Pattern:**
Instead of separate buttons, use a compact segmented control:

```
┌───────────────────────────────┐
│ [ All ] [ Chats ] [ Docs ]    │  ← Segmented control
├───────────────────────────────┤
│ PROJECTS                      │
│ └ Project 1                   │
├───────────────────────────────┤
│ Today ▾                       │
│ ...items...                   │
```

**Benefits:**
- Single row, minimal vertical space
- Clear active state
- Familiar pattern (iOS, macOS)

---

### 5. Empty States

**Issue:** No design for empty states.

**Empty States Needed:**
1. No items in a time group → Hide the section entirely (don't show "Today" with no items)
2. No chats at all → Show helpful message + CTA
3. No documents → Show helpful message + CTA
4. Search no results → Show "No results for '[query]'"

```vue
<div v-if="items.length === 0" class="px-4 py-8 text-center">
  <UIcon name="lucide:message-circle" class="w-10 h-10 mx-auto opacity-30" />
  <p class="mt-2 text-sm opacity-60">No chats yet</p>
  <UButton size="sm" class="mt-3" @click="newChat">Start a chat</UButton>
</div>
```

---

### 6. Scroll Position Preservation

**Issue:** When navigating between Home → Chats → Docs pages, scroll position should be preserved per-page.

**Recommendation:** Use `KeepAlive` (already in plan) + save scroll position:

```typescript
// Save position before leaving
function onBeforeLeave() {
  scrollPositions.set(pageId, scroller.scrollTop);
}

// Restore position when activated
function onActivated() {
  const saved = scrollPositions.get(pageId);
  if (saved) scroller.scrollTo({ top: saved });
}
```

---

### 7. Loading States

**Issue:** With pagination, users need feedback during loading.

**Recommendation - Skeleton Items:**
```vue
<template v-if="loading">
  <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-2 py-2 animate-pulse">
    <div class="w-8 h-8 rounded-lg bg-[var(--md-surface)]" />
    <div class="flex-1 space-y-2">
      <div class="h-4 w-3/4 rounded bg-[var(--md-surface)]" />
      <div class="h-3 w-1/4 rounded bg-[var(--md-surface)]" />
    </div>
  </div>
</template>
```

---

### 8. Active Item Visibility

**Issue:** When opening a chat from deep scroll, the sidebar should scroll to show the active item.

**Recommendation:**
```typescript
watch(activeThreadIds, (ids) => {
  if (ids.length) {
    const index = items.findIndex(i => i.id === ids[0]);
    if (index !== -1) {
      scroller.scrollToIndex(index, { align: 'center' });
    }
  }
});
```

---

## Spacing Guidelines

| Element | Desktop | Mobile | Min Touch Target |
|---------|---------|--------|------------------|
| Item row height | 56px | 56px | ✓ 44px met |
| Icon container | 32x32 visual | 32x32 visual | Row is target |
| Action button | 16x16 visual, 40x40 hit | Always visible, 44x44 hit | ✓ |
| Section header | 44px | 44px | ✓ 44px met |
| Horizontal padding | 8px | 12px | — |
| Gap between items | 2px | 4px | — |

---

## Checklist Before Implementation

- [ ] Action button touch target expanded to 44x44
- [ ] Mobile layout switches to stacked at <280px
- [ ] Section headers show chevron + 44px height
- [ ] Navigation uses segmented control pattern
- [ ] Empty states designed for each scenario
- [ ] Scroll position preserved with KeepAlive
- [ ] Loading skeleton for pagination
- [ ] Active item scrolls into view
