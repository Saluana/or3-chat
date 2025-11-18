# Element Identification Guide

This guide explains how to add unique IDs and classes to template elements for testing, styling, and theme targeting. It also covers when to use theme integration for lazy-loaded components.

**Time estimate:** 2-5 minutes per component

---

## Quick Overview

When working with Vue components, you should:

1. **Add unique IDs** to one-off elements that appear once in the component
2. **Add descriptive classes** to repeated elements (like items in a v-for loop)
3. **Decide** if the component needs theme integration based on lazy-loading and styling needs

---

## Part 1: Adding IDs and Classes

### When to Use IDs vs Classes

**Use `id` for:**

-   Elements that appear **once** in the component
-   Main container elements
-   Unique sections or regions
-   Individual buttons with specific purposes
-   Form inputs that are one-of-a-kind

**Use `class` for:**

-   Elements that **repeat** (v-for loops)
-   Shared styling patterns
-   Multiple similar elements
-   Group identifiers

### Naming Conventions

**IDs should be:**

-   Short but descriptive
-   kebab-case format
-   Prefixed with component context when useful
-   Clear about purpose

**Classes should be:**

-   Descriptive of the element's role
-   Reusable across similar elements
-   kebab-case format

### Examples

#### Good ID Names ✅

```vue
<div id="nav-container">
<div id="nav-header">
<div id="nav-scroll-area">
<div id="page-loading-fallback">
<button id="btn-new-chat">
<button id="btn-search">
<input id="search-input">
```

#### Good Class Names ✅

```vue
<div class="nav-item">                      <!-- Repeated nav items -->
<div class="footer-action-item">            <!-- Repeated footer actions -->
<button class="page-nav-btn">               <!-- Repeated page buttons -->
<span class="footer-label">                 <!-- Repeated labels -->
<div class="chat-message">                  <!-- Repeated messages -->
```

#### Bad Names ❌

```vue
<div id="div1">                             <!-- Not descriptive -->
<button id="b">                             <!-- Too short, unclear -->
<div id="theContainerForTheNavigationStuff"> <!-- Too long -->
<div class="x">                             <!-- Meaningless -->
<button id="submit_button">                 <!-- Use kebab-case -->
```

---

## Part 2: Systematic Approach

Follow these steps when adding IDs/classes to a component:

### Step 1: Identify the Main Container

Every component should have a unique container ID:

```vue
<template>
    <div id="component-name-container">
        <!-- content -->
    </div>
</template>
```

**Examples:**

-   `id="nav-content-container"`
-   `id="nav-collapsed-container"`
-   `id="chat-message-container"`
-   `id="sidebar-container"`

### Step 2: Identify Major Sections

Add IDs to major sections/regions within the component:

```vue
<div id="component-name-container">
    <div id="section-header">...</div>
    <div id="section-content">...</div>
    <div id="section-footer">...</div>
</div>
```

**Examples:**

-   `id="nav-top-section"`
-   `id="nav-scroll-area"`
-   `id="nav-bottom-section"`

### Step 3: Add IDs to Unique Interactive Elements

Buttons, inputs, and other controls that appear once:

```vue
<UButton id="btn-new-chat" />
<UButton id="btn-search" />
<UButton id="btn-dashboard" />
<UInput id="search-input" />
```

### Step 4: Add Classes to Repeated Elements

For v-for loops or multiple similar elements:

```vue
<!-- Multiple similar buttons -->
<UButton
    v-for="page in pages"
    :id="`btn-page-${page.id}`"
    <!--
    Dynamic
    ID
    for
    each
    --
>
    class="page-nav-item"             <!-- Shared class -->
/>

<!-- Multiple footer actions -->
<UButton
    v-for="action in actions"
    :id="`btn-footer-${action.id}`"  <!-- Dynamic ID -->
    class="footer-action-item"        <!-- Shared class -->
>
    <UIcon class="footer-icon" />     <!-- Shared class -->
    <span class="footer-label" />     <!-- Shared class -->
</UButton>
```

### Step 5: Add Wrapper Classes

For groups of elements that share styling or behavior:

```vue
<div class="new-chat-wrapper">
    <UButton id="btn-new-chat" />
</div>

<div class="footer-actions-wrapper">
    <UButton class="footer-action-item" />
    <UButton class="footer-action-item" />
</div>
```

---

## Part 3: Real-World Examples

### Example 1: SideNavContentCollapsed.vue

```vue
<template>
    <!-- Main container: unique ID -->
    <div id="nav-collapsed-container" class="...">
        <!-- Top section: unique ID -->
        <div id="nav-top-section" class="...">
            <!-- Wrapper for new chat: descriptive class -->
            <div class="new-chat-wrapper">
                <UButton id="btn-new-chat" />
                <!-- Unique button: ID -->
            </div>

            <!-- Other unique buttons -->
            <UButton id="btn-search" />
            <UButton id="btn-new-doc" />
            <UButton id="btn-new-project" />

            <!-- Section with repeated elements -->
            <div id="nav-pages-section">
                <UButton id="btn-home" />
                <!-- Unique home button -->

                <!-- Repeated page buttons: class + dynamic ID -->
                <UButton
                    v-for="page in pages"
                    :id="`btn-page-${page.id}`"
                    class="page-nav-item"
                />
            </div>
        </div>

        <!-- Middle section: unique ID -->
        <div id="nav-middle-section">
            <UButton id="btn-dashboard" />
        </div>

        <!-- Footer section: unique ID -->
        <div id="nav-footer-section">
            <!-- Repeated footer actions: class + dynamic ID -->
            <UButton
                v-for="entry in footerActions"
                :id="`btn-footer-${entry.action.id}`"
                class="footer-action-item"
            >
                <UIcon class="footer-icon" />
                <span class="footer-label" />
            </UButton>
        </div>
    </div>
</template>
```

### Example 2: SideNavContent.vue

```vue
<template>
    <div id="nav-content-container" class="...">
        <!-- Unique header component -->
        <SideNavHeader id="nav-header" />

        <!-- Scrollable area: unique ID -->
        <div id="nav-scroll-area">
            <!-- Dynamic page with keepalive: unique ID -->
            <component id="page-keepalive" v-if="keepAlive" />

            <!-- Dynamic page without keepalive: unique ID -->
            <component id="page-no-keepalive" v-else />

            <!-- Loading fallback: unique ID -->
            <div id="page-loading-fallback">Loading page...</div>
        </div>

        <!-- Bottom section: unique ID -->
        <div id="nav-bottom-section">
            <!-- Wrapper for footer actions: descriptive class -->
            <div class="footer-actions-wrapper">
                <!-- Repeated actions: class + dynamic ID -->
                <UButton
                    v-for="action in actions"
                    :id="`btn-footer-${action.id}`"
                    class="footer-action-item"
                >
                    <UIcon class="footer-icon" />
                    <span class="footer-label" />
                </UButton>
            </div>
        </div>
    </div>
</template>
```

### Example 3: Chat Message List

```vue
<template>
    <div id="chat-messages-container">
        <!-- Repeated messages: class + dynamic ID -->
        <div
            v-for="msg in messages"
            :id="`message-${msg.id}`"
            class="chat-message"
            :class="msg.role === 'user' ? 'user-message' : 'assistant-message'"
        >
            <!-- Message content: class -->
            <div class="message-content">
                {{ msg.text }}
            </div>

            <!-- Message actions: wrapper class -->
            <div class="message-actions">
                <UButton
                    :id="`btn-copy-${msg.id}`"
                    class="message-action-btn"
                />
                <UButton
                    :id="`btn-edit-${msg.id}`"
                    class="message-action-btn"
                />
            </div>
        </div>
    </div>
</template>
```

---

## Part 4: When to Use Theme Integration

### Decision Tree

**Does the component need theme integration?**

```
Does it have Nuxt UI components (UButton, UInput, UCard, etc.)?
└─ YES → ✅ USE useThemeOverrides
   └─ Works automatically in lazy-loaded or eager-loaded components

Does it have third-party libraries or custom elements with CSS classes from theme.cssSelectors?
└─ YES → Is the component lazy-loaded (defineAsyncComponent)?
   └─ YES → ✅ ALSO USE useThemeClasses
   └─ NO  → ❌ Not needed (page:finish hook handles it)
└─ NO  → ❌ Skip theme integration (structural only)
```

### When to Skip Theme Integration

**Skip if the component:**

1. Only uses structural layout (flex, grid, positioning)
2. Has no Nuxt UI components (UButton, UInput, etc.)
3. Has no third-party libraries or custom elements that need CSS classes from theme
4. Only passes data to child components that handle their own theming

**Examples that skip:**

-   Simple wrapper components
-   Layout containers
-   Data display components with no interactive elements

### When to Use `useThemeOverrides`

**Use if the component has:**

1. Nuxt UI components (UButton, UInput, UCard, etc.) that need theme-aware styling
2. Hardcoded styling on Nuxt UI components that should come from theme

**Works for:**

-   ✅ Eager-loaded components
-   ✅ Lazy-loaded components (no special handling needed)

**Examples:**

-   Modal components with UButton
-   Sidebar navigation with UButton actions
-   Forms with UInput and submit buttons
-   Chat messages with UButton actions
-   Dashboard pages with Nuxt UI controls

### When to ALSO Use `useThemeClasses`

**ONLY use if the component:**

1. Is **lazy-loaded** with `defineAsyncComponent`, AND
2. Has **third-party libraries** (Monaco, Codemirror, etc.) OR custom elements that match `theme.cssSelectors`

**NOT needed for:**

-   ❌ Eager-loaded components (auto-handled by `page:finish` hook)
-   ❌ Nuxt UI components (use `useThemeOverrides` instead)
-   ❌ Components with only structural HTML

**Examples that need it:**

-   Lazy-loaded Monaco editor component
-   Lazy-loaded Codemirror component
-   Lazy-loaded modals with third-party date pickers
-   Lazy-loaded components with custom tooltips styled via `cssSelectors`

### Two Types of Theme Integration

There are **two different** theme systems that handle different needs:

#### 1. Nuxt UI Component Theming (`useThemeOverrides`)

**What it's for:** Styling Nuxt UI components (UButton, UInput, UCard, etc.)

**How it works:** Returns reactive props that automatically update when theme changes

**Works with lazy-loaded components?** ✅ Yes, automatically! No special handling needed.

```vue
<!-- ✅ Works perfectly in lazy-loaded components -->
<script setup>
import { useThemeOverrides } from '~/composables/useThemeResolver'

const saveButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'modal',
        identifier: 'modal.save',
        isNuxtUI: true,
    })
    return {
        color: 'primary' as const,
        ...(overrides.value as any),
    }
})
</script>

<template>
    <UButton v-bind="saveButtonProps">Save</UButton>
</template>
```

#### 2. CSS Selector Classes (`useThemeClasses`)

**What it's for:** Applying CSS classes to third-party libraries, custom elements, or non-Nuxt-UI components that match `cssSelectors` in the theme

**How it works:** Applies CSS classes from theme's `cssSelectors` config to matching DOM elements

**Works with lazy-loaded components?** ⚠️ Only if you call `useThemeClasses()` in the component

```vue
<!-- For lazy-loaded components with third-party libs or custom elements -->
<script setup>
import { useThemeClasses } from '~/composables/core/useThemeClasses';

// This ensures CSS classes are applied after component mounts
useThemeClasses();
</script>

<template>
    <div>
        <!-- Example: Monaco editor will get classes from theme.cssSelectors['.monaco-editor'] -->
        <div class="monaco-editor">...</div>

        <!-- Example: Custom tooltip will get classes from theme.cssSelectors['.custom-tooltip'] -->
        <div class="custom-tooltip">...</div>
    </div>
</template>
```

### When to Use Each

**Use `useThemeOverrides`:**

-   ✅ Any Nuxt UI component (UButton, UInput, etc.)
-   ✅ Works in eager-loaded components
-   ✅ Works in lazy-loaded components
-   ✅ Automatically reactive to theme changes

**Use `useThemeClasses`:**

-   ✅ Lazy-loaded components with third-party libraries (Monaco, Codemirror, etc.)
-   ✅ Lazy-loaded components with custom elements that use theme's `cssSelectors`
-   ❌ NOT needed for Nuxt UI components
-   ❌ NOT needed for eager-loaded components (handled automatically by `page:finish` hook)

### Examples

```vue
<!-- Example 1: Modal with Nuxt UI buttons (lazy-loaded) -->
<!-- NO need for useThemeClasses - useThemeOverrides handles it -->
<script setup>
import { useThemeOverrides } from '~/composables/useThemeResolver';

const saveProps = computed(() =>
    useThemeOverrides({
        component: 'button',
        context: 'modal',
        identifier: 'modal.save',
        isNuxtUI: true,
    })
);
</script>

<template>
    <UButton v-bind="saveProps">Save</UButton>
</template>
```

```vue
<!-- Example 2: Modal with Monaco editor (lazy-loaded) -->
<!-- NEEDS useThemeClasses to apply CSS selector classes -->
<script setup>
import { useThemeClasses } from '~/composables/core/useThemeClasses';

// This applies classes from theme.cssSelectors['.monaco-editor']
useThemeClasses();
</script>

<template>
    <div>
        <div class="monaco-editor">
            <!-- Monaco will get themed classes -->
        </div>
    </div>
</template>
```

```vue
<!-- Example 3: Modal with both (lazy-loaded) -->
<script setup>
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useThemeClasses } from '~/composables/core/useThemeClasses';

// For Nuxt UI buttons
const saveProps = computed(() =>
    useThemeOverrides({
        component: 'button',
        context: 'modal',
        identifier: 'modal.save',
        isNuxtUI: true,
    })
);

// For third-party editor
useThemeClasses();
</script>

<template>
    <div>
        <div class="monaco-editor">...</div>
        <UButton v-bind="saveProps">Save</UButton>
    </div>
</template>
```

---

## Part 5: Common Patterns

### Pattern 1: Navigation Component

```vue
<template>
    <!-- Container -->
    <nav id="main-navigation" class="...">
        <!-- Section -->
        <div id="nav-primary-section">
            <!-- Unique buttons -->
            <UButton id="btn-home" />
            <UButton id="btn-settings" />
        </div>

        <!-- Section -->
        <div id="nav-secondary-section">
            <!-- Repeated items -->
            <UButton
                v-for="item in menuItems"
                :id="`btn-menu-${item.id}`"
                class="nav-menu-item"
            />
        </div>
    </nav>
</template>
```

### Pattern 2: Form Component

```vue
<template>
    <form id="user-profile-form">
        <!-- Unique inputs -->
        <UInput id="input-name" label="Name" />
        <UInput id="input-email" label="Email" />

        <!-- Repeated inputs from array -->
        <UInput
            v-for="field in customFields"
            :id="`input-${field.id}`"
            :label="field.label"
            class="custom-field-input"
        />

        <!-- Actions -->
        <div class="form-actions">
            <UButton id="btn-save" />
            <UButton id="btn-cancel" />
        </div>
    </form>
</template>
```

### Pattern 3: List Component

```vue
<template>
    <div id="items-list-container">
        <!-- List header -->
        <div id="list-header">
            <UButton id="btn-select-all" />
            <UButton id="btn-clear-all" />
        </div>

        <!-- List items -->
        <div id="list-items">
            <div
                v-for="item in items"
                :id="`list-item-${item.id}`"
                class="list-item"
            >
                <span class="item-label">{{ item.name }}</span>
                <UButton
                    :id="`btn-delete-${item.id}`"
                    class="item-action-btn"
                />
            </div>
        </div>
    </div>
</template>
```

---

## Checklist for Adding IDs/Classes

Use this when working on a component:

-   [ ] **Main container** has a unique ID
-   [ ] **Major sections** have unique IDs
-   [ ] **Unique interactive elements** (buttons, inputs) have unique IDs
-   [ ] **Repeated elements** have shared classes
-   [ ] **Dynamic repeated elements** have both dynamic IDs and shared classes
-   [ ] **Wrapper divs** for groups have descriptive classes
-   [ ] **All names** are short, clear, and follow kebab-case
-   [ ] **Decided** if component has Nuxt UI components → use `useThemeOverrides`
-   [ ] **Decided** if lazy-loaded component has third-party libs → use `useThemeClasses`
-   [ ] **If using `useThemeOverrides`**, created computed props for each Nuxt UI component
-   [ ] **If using `useThemeClasses`**, called it at component setup

---

## Tips for the Intern

1. **Be consistent**: If the component has `btn-new-chat`, use `btn-` prefix for all buttons
2. **Be descriptive**: `btn-save` is better than `btn1`
3. **Think about testing**: IDs make it easy to target elements in E2E tests
4. **Think about styling**: Classes make it easy to style groups of elements
5. **Check existing patterns**: Look at similar components for naming inspiration
6. **When in doubt, use class**: If you're not sure if it's unique, use a class
7. **Document dynamic IDs**: Add a comment if the ID pattern might not be obvious
8. **Two theme systems**: Remember `useThemeOverrides` (for Nuxt UI) is different from `useThemeClasses` (for CSS selectors)
9. **Lazy-loading**: Only `useThemeClasses` needs special handling for lazy-loaded components

---

## Quick Reference

### ID Format

```
{context}-{element-type}-{purpose}
```

**Examples:**

-   `nav-container`
-   `btn-new-chat`
-   `input-search`
-   `section-header`

### Class Format

```
{element-role}
```

**Examples:**

-   `nav-item`
-   `footer-action-item`
-   `page-nav-btn`
-   `message-action-btn`

### Dynamic ID Format

```
{context}-{element-type}-${uniqueValue}
```

**Examples:**

-   `:id="\`btn-page-${page.id}\`"`
-   `:id="\`message-${msg.id}\`"`
-   `:id="\`btn-footer-${action.id}\`"`

---

## Resources

-   [Integration Guide](./integration-guide.md) - Full theme integration guide
-   [Theme API Reference](/public/_documentation/themes/api-reference.md)
-   [Component Examples](../../app/components/sidebar/) - Real components to study

---

## Common Mistakes to Avoid

❌ **Using generic names**

```vue
<div id="container">
<button id="btn">
```

❌ **Mixing ID and class purposes**

```vue
<div id="repeated-item">  <!-- Should be a class! -->
```

❌ **Too long names**

```vue
<button id="the-button-that-creates-a-new-chat-thread">
```

❌ **Not using kebab-case**

```vue
<div id="navContainer">
<div id="nav_container">
```

❌ **Confusing the two theme systems**

```vue
<!-- ❌ WRONG: Using useThemeClasses for Nuxt UI components -->
<script setup>
import { useThemeClasses } from '~/composables/core/useThemeClasses';
useThemeClasses(); // NOT needed for UButton!
</script>
<template>
    <UButton>Save</UButton>
</template>

<!-- ❌ WRONG: Forgetting useThemeClasses for lazy-loaded third-party libs -->
<script setup>
// Monaco editor in lazy-loaded component - needs useThemeClasses!
</script>
<template>
    <div class="monaco-editor">...</div>
</template>
```

❌ **Not using computed for useThemeOverrides**

```vue
<!-- ❌ WRONG: Not reactive to theme changes -->
const props = useThemeOverrides({ ... })

<!-- ✅ CORRECT: Reactive to theme changes -->
const props = computed(() => useThemeOverrides({ ... }))
```

✅ **Correct approach**

```vue
<script setup>
import { useThemeOverrides } from '~/composables/useThemeResolver';
import { useThemeClasses } from '~/composables/core/useThemeClasses';

// For Nuxt UI button
const saveProps = computed(() =>
    useThemeOverrides({
        component: 'button',
        context: 'modal',
        identifier: 'modal.save',
        isNuxtUI: true,
    })
);

// For third-party editor (only in lazy-loaded components)
useThemeClasses();
</script>

<template>
    <div id="nav-container">
        <div class="monaco-editor">...</div>
        <UButton v-bind="saveProps">Save</UButton>
    </div>
</template>
```
