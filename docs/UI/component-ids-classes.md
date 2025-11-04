# Component IDs and Classes Reference

This document provides a comprehensive reference for all the unique IDs and component classes added during the theming refactor. These identifiers enable theme developers to target specific UI elements for custom styling while maintaining semantic HTML structure.

## Table of Contents

- [Unique IDs](#unique-ids)
- [Component Classes](#component-classes)
- [CSS Customization Examples](#css-customization-examples)
- [Best Practices](#best-practices)

---

## Unique IDs

### Layout Components

| ID | Element | File Location | Description |
|---|---|---|---|
| `app-sidebar` | `<aside>` | `app/components/ResizableSidebarLayout.vue` | Main sidebar container |
| `app-content` | `<main>` | `app/components/ResizableSidebarLayout.vue` | Primary content area |
| `app-header` | `<div>` | `app/components/sidebar/SidebarHeader.vue` | Sidebar header with app title |
| `app-bottom-nav` | `<div>` | `app/components/sidebar/SideBottomNav.vue` | Bottom navigation bar (mobile) |
| `app-chat-container` | `<main>` | `app/components/chat/ChatContainer.vue` | Chat messages container |
| `app-dashboard-modal` | `<UModal>` | `app/components/dashboard/Dashboard.vue` | Dashboard modal container |

### Usage Examples

```css
/* Target the sidebar */
#app-sidebar {
  background: var(--custom-sidebar-bg);
}

/* Target the main content area */
#app-content {
  padding: var(--custom-content-padding);
}

/* Target the header */
#app-header {
  border-bottom: 2px solid var(--custom-header-border);
}
```

---

## Component Classes

### Chat Messages

| Class | Applied To | When Applied | Description |
|---|---|---|---|
| `app-chat-message` | Root message div | Always | Base class for all chat messages |
| `app-chat-message--user` | Root message div | When `role === 'user'` | Styles for user messages |
| `app-chat-message--assistant` | Root message div | When `role === 'assistant'` | Styles for assistant messages |

**Data Attributes:**
- `data-message-role` - Contains `"user"` or `"assistant"`

**File:** `app/components/chat/ChatMessage.vue`

#### Usage Examples

```css
/* Style all chat messages */
.app-chat-message {
  margin: 0.5rem 0;
}

/* Different styles for user vs assistant messages */
.app-chat-message--user {
  background: var(--user-message-bg);
  text-align: right;
}

.app-chat-message--assistant {
  background: var(--assistant-message-bg);
  text-align: left;
}

/* Target by data attribute */
.app-chat-message[data-message-role="user"] {
  border-left: 4px solid var(--user-accent);
}
```

### Sidebar Components

| Class | Applied To | When Applied | Description |
|---|---|---|---|
| `app-sidebar-item` | Thread/document items | Always | Base class for sidebar list items |
| `app-sidebar-item--active` | Thread/document items | When item is active/selected | Active state styling |

**Files:** 
- `app/components/sidebar/SidebarThreadItem.vue`
- `app/components/sidebar/SidebarDocumentItem.vue`

#### Usage Examples

```css
/* Base sidebar item styling */
.app-sidebar-item {
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.2s;
}

/* Active state */
.app-sidebar-item--active {
  background: var(--md-primary);
  color: var(--md-on-primary);
}

/* Hover state */
.app-sidebar-item:hover:not(.app-sidebar-item--active) {
  background: var(--md-secondary-container);
}
```

### Other Components

| Class | Applied To | Description |
|---|---|---|
| `app-prompt-item` | Prompt items | System prompt list items |
| `app-document-item` | Document items | Document list items |
| `app-pane` | Pane containers | Multi-pane layout containers |
| `app-model-card` | Model cards | Model selection cards |
| `app-theme-section` | Theme sections | Theme setting sections |

**Data Attributes:**
- `data-pane-id` - Contains unique pane identifier

**Files:**
- `app/components/chat/SystemPromptsModal.vue`
- `app/components/sidebar/SidebarDocumentItem.vue`
- `app/components/PageShell.vue`
- `app/components/modal/ModelCatalog.vue`
- `app/components/dashboard/ThemePage.vue`

#### Usage Examples

```css
/* Prompt items */
.app-prompt-item {
  border: 1px solid var(--md-outline);
}

/* Panes with specific IDs */
.app-pane[data-pane-id="chat-1"] {
  border-right: 2px solid var(--md-primary);
}

/* Model cards */
.app-model-card {
  transition: transform 0.2s, box-shadow 0.2s;
}

.app-model-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Theme sections */
.app-theme-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
}
```

---

## CSS Customization Examples

### Before/After: Chat Message Styling

**Before (default):**
```css
/* Default chat message styling */
.app-chat-message {
  /* Uses existing utility classes */
}
```

**After (custom theme):**
```css
/* Custom chat message theme */
.app-chat-message {
  background: linear-gradient(135deg, var(--md-surface) 0%, var(--md-surface-variant) 100%);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin: 0.75rem 0;
}

.app-chat-message--user {
  background: linear-gradient(135deg, var(--md-primary) 0%, var(--md-primary-container) 100%);
  color: var(--md-on-primary);
  margin-left: auto;
  max-width: 80%;
}

.app-chat-message--assistant {
  background: linear-gradient(135deg, var(--md-secondary-container) 0%, var(--md-tertiary-container) 100%);
  color: var(--md-on-secondary-container);
  margin-right: auto;
  max-width: 80%;
}
```

### Before/After: Sidebar Enhancement

**Before (default):**
```css
/* Uses existing retro styling */
```

**After (custom theme):**
```css
/* Enhanced sidebar styling */
#app-sidebar {
  background: linear-gradient(180deg, var(--md-surface) 0%, var(--md-surface-variant) 100%);
  border-right: 3px solid var(--md-outline-variant);
  box-shadow: 4px 0 12px rgba(0, 0, 0, 0.1);
}

.app-sidebar-item {
  position: relative;
  overflow: hidden;
}

.app-sidebar-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 3px;
  background: var(--md-primary);
  transform: translateX(-100%);
  transition: transform 0.2s;
}

.app-sidebar-item--active::before,
.app-sidebar-item:hover::before {
  transform: translateX(0);
}
```

### Before/After: Model Cards

**Before (default):**
```css
/* Standard retro card styling */
```

**After (custom theme):**
```css
/* Enhanced model cards */
.app-model-card {
  background: var(--md-surface-container);
  border: 2px solid var(--md-outline-variant);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
}

.app-model-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--md-primary), var(--md-secondary));
  opacity: 0;
  transition: opacity 0.2s;
}

.app-model-card:hover::after {
  opacity: 1;
}
```

---

## Best Practices

### 1. Don't Override Tailwind Classes

Instead of overriding utility classes, use the component classes as styling hooks:

```css
/* ❌ Bad - overrides Tailwind */
.app-chat-message .p-2 {
  padding: 1rem !important;
}

/* ✅ Good - uses component class */
.app-chat-message {
  padding: 1rem;
}
```

### 2. Use Specificity Wisely

Leverage the component class structure for better specificity:

```css
/* ❌ Too specific */
.app-theme-section.section-card.space-y-3 h2.font-heading {
  color: red;
}

/* ✅ Good specificity */
.app-theme-section h2 {
  color: var(--custom-heading-color);
}
```

### 3. Leverage CSS Custom Properties

Always use CSS variables for theme values:

```css
/* ❌ Hardcoded values */
.app-sidebar-item {
  background: #ffffff;
  color: #000000;
}

/* ✅ Uses CSS variables */
.app-sidebar-item {
  background: var(--md-surface);
  color: var(--md-on-surface);
}
```

### 4. Combine Classes and Data Attributes

Use data attributes for conditional styling:

```css
/* Target specific roles */
.app-chat-message[data-message-role="user"] {
  border-left: 4px solid var(--user-accent);
}

/* Target specific panes */
.app-pane[data-pane-id*="chat"] {
  background: var(--chat-pane-bg);
}
```

### 5. Maintain Accessibility

Preserve semantic HTML and accessibility features:

```css
/* ✅ Good - maintains focus states */
.app-sidebar-item:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}

/* ✅ Good - respects high contrast mode */
@media (prefers-contrast: high) {
  .app-chat-message {
    border: 2px solid var(--md-outline);
  }
}
```

### 6. Progressive Enhancement

Start with base styles and enhance:

```css
/* Base styles */
.app-chat-message {
  padding: 0.5rem;
  margin: 0.25rem 0;
}

/* Enhanced styles for larger screens */
@media (min-width: 768px) {
  .app-chat-message {
    padding: 1rem;
    margin: 0.5rem 0;
  }
}
```

---

## Testing Your Custom Styles

1. **Use Browser DevTools** to verify classes are applied
2. **Test all screen sizes** to ensure responsive behavior
3. **Check accessibility** with screen readers and keyboard navigation
4. **Validate CSS** with CSS validators
5. **Test theme switching** to ensure variables work correctly

---

## Migration Guide

If you're upgrading from an older theming system:

1. Replace direct element selectors with class-based selectors
2. Move hardcoded colors to CSS custom properties
3. Update any JavaScript that relies on specific class names
4. Test all existing customizations

For more migration details, see [Migration Guide](../migration-guides/theming-refactor.md).
