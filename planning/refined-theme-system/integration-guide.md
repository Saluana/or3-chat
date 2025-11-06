# Component Theme Integration Guide

This guide walks you through adding theme support to any component in OR3 Chat. We'll use `ChatMessage.vue` as our reference implementation.

**Time estimate:** 5-15 minutes per component (depending on complexity)

## Quick Overview

Theme integration involves 3 main steps:

1. **Import the composable** - Get access to theme resolution
2. **Define theme overrides** - Create computed props for each interactive element
3. **Update the theme file** - Add selectors to the retro theme

---

## Step 1: Import the Theme Composable

Add this import to your component's `<script setup>`:

```typescript
import { useThemeOverrides } from '~/composables/useThemeResolver';
```

This composable provides access to the theme system and automatically reacts to theme changes.

---

## Step 2: Create Computed Props for Each Interactive Element

For every button, input, or interactive component, create a computed property that resolves its theme overrides.

### Pattern: Button Elements

For buttons, follow this pattern:

```typescript
const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message', // Your component context
        identifier: 'message.copy', // Unique identifier
        isNuxtUI: true, // Set to true for Nuxt UI components
    });

    return {
        // Default props (fallback if theme has no overrides)
        icon: 'pixelarticons:copy' as const,
        color: 'info' as const,
        size: 'sm' as const,

        // Spread theme overrides (wins if defined in theme)
        ...(overrides.value as any),
    };
});
```

**Key points:**

-   `component`: Always `'button'` for buttons, `'input'` for inputs, etc.
-   `context`: Name of your component's context (e.g., `'message'`, `'chat'`, `'sidebar'`)
-   `identifier`: Full path like `'context.buttonName'` (e.g., `'message.copy'`)
-   `isNuxtUI`: Set to `true` if using Nuxt UI components (`UButton`, `UInput`), `false` for native HTML
-   The spread operator (`...`) ensures theme props override defaults

### Example: Multiple Buttons in Same Component

```typescript
// Copy button
const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.copy',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:copy' as const,
        color: 'info' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

// Retry button
const retryButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.retry',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:reload' as const,
        color: 'info' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

// Edit button
const editButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.edit',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:edit-box' as const,
        color: 'info' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});
```

### Pattern: Input Elements

For inputs, use the same pattern with `component: 'input'`:

```typescript
const searchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'sidebar',
        identifier: 'sidebar.search',
        isNuxtUI: true, // or false if native <input>
    });

    return {
        type: 'text',
        placeholder: 'Search...',
        size: 'md' as const,
        variant: 'outline' as const,
        ...(overrides.value as any),
    };
});
```

### Pattern: Container Elements (Non-Nuxt UI)

For regular `<div>` or other HTML elements, set `isNuxtUI: false`:

```typescript
const messageContainerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'div',
        context: 'message',
        identifier: 'message.user-container',
        isNuxtUI: false, // ← Native HTML element
    });

    return overrides.value; // Return raw overrides (usually just class strings)
});
```

---

## Step 3: Use the Props in Your Template

In your template, bind the computed props using `v-bind`:

```vue
<template>
    <!-- Buttons -->
    <UButton v-bind="copyButtonProps" @click="copyMessage">
        <!-- Icon rendered by component -->
    </UButton>

    <UButton v-bind="retryButtonProps" @click="onRetry">
        <!-- Icon rendered by component -->
    </UButton>

    <!-- Inputs -->
    <UInput v-bind="searchInputProps" />

    <!-- Containers -->
    <div
        :class="(messageContainerProps as any)?.class || ''"
        :data-theme-target="(messageContainerProps as any)?.['data-theme-target']"
        :data-theme-matches="(messageContainerProps as any)?.['data-theme-matches']"
    >
        <!-- Content -->
    </div>
</template>
```

---

## Step 4: Add Theme Overrides to the Retro Theme

Update `/app/theme/retro/theme.ts` to define styling for your component's buttons.

### Basic Pattern

```typescript
overrides: {
    // Target ALL buttons in your context
    'button.message': {
        class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
        variant: 'solid',
        size: 'sm',
        color: 'info',
    },

    // Target specific buttons by identifier
    'button#message.copy': {
        class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
        variant: 'solid',
        size: 'sm',
        color: 'info',
    },

    'button#message.retry': {
        class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
        variant: 'solid',
        size: 'sm',
        color: 'info',
    },

    // Special buttons (save, cancel, delete)
    'button#message.save-edit': {
        class: 'retro-btn',
        variant: 'solid',
        size: 'sm',
        color: 'success',  // Use appropriate semantic color
    },

    'button#message.cancel-edit': {
        class: 'retro-btn',
        variant: 'solid',
        size: 'sm',
        color: 'error',
    },
}
```

### Selector Syntax Reference

The theme system supports CSS-like selectors:

```typescript
// Global (all components of this type)
'button': { ... }

// Context-specific (all buttons in chat area)
'button.chat': { ... }

// Identifier-specific (specific button)
'button#chat.send': { ... }

// Multiple contexts/identifiers
'button.chat#send': { ... }

// State-based
'button:hover': { ... }

// Attribute-based
'button[type="submit"]': { ... }
'button[data-action="confirm"]': { ... }

// Combined
'button.chat[type="submit"]:hover': { ... }
```

### Specificity Rules

More specific selectors override less specific ones:

```
Global < Context < Identifier < Attributes + State
```

Example hierarchy:

```typescript
overrides: {
    'button': {
        variant: 'solid',           // 1. Global default
    },

    'button.message': {
        variant: 'ghost',           // 2. Message context (overrides global)
    },

    'button#message.copy': {
        variant: 'outline',         // 3. Specific button (overrides context & global)
    },
}
```

---

## Complete Example: Chat Sidebar Component

Here's a complete example showing a sidebar component with multiple interactive elements:

### Component File (`SidebarChat.vue`)

```vue
<template>
    <div class="sidebar">
        <!-- Search input -->
        <UInput v-bind="searchInputProps" placeholder="Search chats..." />

        <!-- New chat button -->
        <UButton v-bind="newChatButtonProps" @click="createNewChat">
            New Chat
        </UButton>

        <!-- Chat list -->
        <div class="chat-list">
            <button
                v-for="chat in chats"
                :key="chat.id"
                v-bind="chatItemButtonProps"
                @click="selectChat(chat.id)"
                class="chat-item"
            >
                {{ chat.title }}
            </button>
        </div>

        <!-- Delete button -->
        <UButton
            v-bind="deleteChatButtonProps"
            @click="deleteChat"
            color="error"
        >
            Delete
        </UButton>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

// Search input
const searchInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'sidebar',
        identifier: 'sidebar.search',
        isNuxtUI: true,
    });
    return {
        type: 'text',
        size: 'md' as const,
        ...(overrides.value as any),
    };
});

// New chat button
const newChatButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.new-chat',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:plus' as const,
        color: 'primary' as const,
        size: 'md' as const,
        ...(overrides.value as any),
    };
});

// Chat item buttons
const chatItemButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.chat-item',
        isNuxtUI: false, // Native button
    });
    return {
        class: 'px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded',
        ...(overrides.value as any),
    };
});

// Delete button
const deleteChatButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: 'sidebar.delete-chat',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:delete' as const,
        color: 'error' as const,
        size: 'sm' as const,
        ...(overrides.value as any),
    };
});

// ... rest of component logic
</script>
```

### Theme File Update (`/app/theme/retro/theme.ts`)

```typescript
overrides: {
    // ... other overrides ...

    // Sidebar inputs
    'input.sidebar': {
        class: 'retro-input',
        size: 'md' as const,
    },

    'input#sidebar.search': {
        class: 'retro-input rounded-md',
        size: 'md' as const,
    },

    // Sidebar buttons - all buttons
    'button.sidebar': {
        class: 'retro-btn',
        variant: 'ghost',
        size: 'sm',
    },

    // New chat button (specific)
    'button#sidebar.new-chat': {
        class: 'retro-btn',
        variant: 'solid',
        size: 'md',
        color: 'primary',
    },

    // Chat item list buttons
    'button#sidebar.chat-item': {
        class: 'px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded w-full text-left',
        variant: 'ghost',
    },

    // Delete button
    'button#sidebar.delete-chat': {
        class: 'retro-btn',
        variant: 'solid',
        size: 'sm',
        color: 'error',
    },
}
```

---

## Step 5: Clean Up Component Styling (Keep UI 100% the Same)

After adding theme support, audit the component for styling that can move to the theme system. This keeps the component code cleaner while maintaining identical visual appearance.

### What to Move vs. What to Keep

**Move to theme (via class strings in overrides):**

-   Color schemes
-   Border styles (border width, radius)
-   Shadows
-   Padding/margins (spacing)
-   Hover/active states
-   Background patterns
-   Font families, sizes, weights
-   Opacity settings

**Keep in component (structural):**

-   Layout logic (`flex`, `grid`, responsive classes)
-   Positioning (`absolute`, `relative`, `z-index`)
-   Sizing that depends on content
-   Dynamic conditional classes
-   Component state classes

### Example: Before and After

#### BEFORE (Unstyled)

```vue
<template>
    <div
        class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
    >
        <div class="relative inline-flex -space-x-px bg-primary rounded-[3px]">
            <UTooltip :delay-duration="0" text="Copy" :teleport="true">
                <UButton
                    icon="pixelarticons:copy"
                    color="info"
                    size="sm"
                    class="text-black dark:text-white/95 flex items-center justify-center"
                    @click="copyMessage"
                ></UButton>
            </UTooltip>
            <UTooltip :delay-duration="0" text="Retry" :teleport="true">
                <UButton
                    icon="pixelarticons:reload"
                    color="info"
                    size="sm"
                    class="text-black dark:text-white/95 flex items-center justify-center"
                    @click="onRetry"
                ></UButton>
            </UTooltip>
        </div>
    </div>
</template>
```

**Problems:**

-   Styling scattered in template
-   Hard to change button colors globally
-   Duplicate classes on every button
-   Theme not involved

#### AFTER (With Theme Integration and Cleanup)

```vue
<template>
    <div
        class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex z-10 whitespace-nowrap"
    >
        <UButtonGroup>
            <UTooltip :delay-duration="0" text="Copy" :teleport="true">
                <UButton
                    v-bind="copyButtonProps"
                    @click="copyMessage"
                ></UButton>
            </UTooltip>
            <UTooltip :delay-duration="0" text="Retry" :teleport="true">
                <UButton v-bind="retryButtonProps" @click="onRetry"></UButton>
            </UTooltip>
        </UButtonGroup>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.copy',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:copy' as const,
        ...(overrides.value as any),
    };
});

const retryButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'message',
        identifier: 'message.retry',
        isNuxtUI: true,
    });
    return {
        icon: 'pixelarticons:reload' as const,
        ...(overrides.value as any),
    };
});
</script>
```

**In theme file:**

```typescript
// Message action buttons (all styling moved here)
'button.message': {
    class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
    variant: 'solid',
    size: 'sm',
    color: 'info',
},

'button#message.copy': {
    class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
    variant: 'solid',
    size: 'sm',
    color: 'info',
},

'button#message.retry': {
    class: 'retro-btn text-black dark:text-white/95 flex items-center justify-center',
    variant: 'solid',
    size: 'sm',
    color: 'info',
},
```

**Results:**

-   ✅ Component template is cleaner
-   ✅ Styling centralized in theme
-   ✅ UI looks 100% identical
-   ✅ Easier to maintain and modify
-   ✅ Follows theme system conventions

### Cleanup Checklist

For each button/input in your component:

-   [ ] **Extract hardcoded classes** to theme overrides

    -   Move `class="text-black dark:text-white/95"` → theme `class` prop
    -   Move `color="info"` → theme `color` prop
    -   Move `variant="solid"` → theme `variant` prop

-   [ ] **Remove duplicate Tailwind classes** that appear on multiple elements

    -   If 3 buttons have `class="flex items-center justify-center"`, move to `'button.context'` selector

-   [ ] **Keep structural layout classes** in template

    -   Layout: `flex`, `grid`, `absolute`, `relative`
    -   Positioning: `top-0`, `left-1/2`, `z-10`
    -   Responsive: `md:px-4`, `sm:py-2`

-   [ ] **Verify UI is identical** after cleanup

    -   Compare before/after screenshots
    -   Check all button states (hover, active, disabled)
    -   Test in light and dark modes

-   [ ] **Test theme switching**
    -   Verify styling applies correctly
    -   Ensure no broken styles

### Common Styles to Extract

**Colors & Variants:**

```typescript
// ❌ In component
<UButton color="info" variant="solid" size="sm" />

// ✅ In theme
'button.message': {
    color: 'info',
    variant: 'solid',
    size: 'sm',
}
```

**Text Styling:**

```typescript
// ❌ In component
class="text-black dark:text-white/95"

// ✅ In theme
'button.message': {
    class: 'text-black dark:text-white/95',
}
```

**Spacing:**

```typescript
// ❌ In component
class="px-4 py-2 gap-2"

// ✅ In theme
'button.message': {
    class: 'px-4 py-2 gap-2',
}
```

**Borders & Shadows:**

```typescript
// ❌ In component
class="border-2 border-[var(--md-inverse-surface)] retro-shadow rounded-[3px]"

// ✅ In theme
'button.message': {
    class: 'border-2 border-[var(--md-inverse-surface)] retro-shadow rounded-[3px]',
}
```

### What NOT to Extract

Keep these in the component (they're structural, not styling):

```vue
<!-- ✅ Keep - layout structure -->
<div class="flex gap-2 items-center">
    <UButton v-bind="props" />
</div>

<!-- ✅ Keep - conditional logic -->
<div v-if="showButtons" class="flex">
    <UButton v-bind="props" />
</div>

<!-- ✅ Keep - responsive layout -->
<div class="flex md:flex-row sm:flex-col">
    <UButton v-bind="props" />
</div>

<!-- ✅ Keep - absolute positioning -->
<div class="absolute bottom-0 left-1/2 -translate-x-1/2">
    <UButton v-bind="props" />
</div>
```

### Real Example: ChatMessage Container

**BEFORE:**

```vue
<div
    class="bg-primary text-white dark:text-black border-2 px-4 border-[var(--md-inverse-surface)] retro-shadow backdrop-blur-sm w-fit self-end ml-auto pb-5 min-w-0 p-2 min-w-[140px] rounded-md first:mt-3 first:mb-6 not-first:my-6 relative"
>
    <!-- Content -->
</div>
```

**What to move:**

-   `bg-primary` → color styling
-   `text-white dark:text-black` → theme text color
-   `border-2 border-[var(--md-inverse-surface)]` → border styling
-   `retro-shadow` → shadow styling
-   `backdrop-blur-sm` → effect styling
-   `px-4` → padding styling
-   `pb-5 p-2` → spacing styling
-   `rounded-md` → border radius

**What to keep:**

-   `w-fit` → sizing (content-based)
-   `self-end ml-auto` → layout alignment
-   `min-w-0 min-w-[140px]` → constraint (structural)
-   `first:mt-3 first:mb-6 not-first:my-6` → layout logic
-   `relative` → positioning context

**AFTER:**

```vue
<div
    v-bind="messageContainerProps"
    class="w-fit self-end ml-auto min-w-0 min-w-[140px] first:mt-3 first:mb-6 not-first:my-6 relative"
>
    <!-- Content -->
</div>
```

**In theme:**

```typescript
'div#message.user-container': {
    class: 'bg-primary text-white dark:text-black border-2 px-4 border-[var(--md-inverse-surface)] retro-shadow backdrop-blur-sm pb-5 p-2 rounded-md',
}
```

---

## Checklist: Component Integration

Use this checklist when adding theme support to a component:

-   [ ] **Import composable**

    ```typescript
    import { useThemeOverrides } from '~/composables/useThemeResolver';
    ```

-   [ ] **Identify all interactive elements** (buttons, inputs, etc.)

-   [ ] **Create computed props for each element**

    -   Define component type (`button`, `input`, etc.)
    -   Define context (e.g., `'message'`, `'chat'`, `'sidebar'`)
    -   Define identifier (e.g., `'message.copy'`, `'sidebar.new-chat'`)
    -   Set `isNuxtUI` appropriately

-   [ ] **Bind props in template**

    ```vue
    <UButton v-bind="buttonProps" />
    ```

-   [ ] **Add theme overrides to retro theme**

    -   Add general context selector (`'button.message'`)
    -   Add specific identifiers as needed (`'button#message.copy'`)
    -   Use appropriate colors and variants

-   [ ] **Test locally**

    -   Run `bun run dev`
    -   Verify styling applies correctly
    -   Test theme switching

-   [ ] **Test other themes** (if applicable)
    -   Ensure fallback behavior works
    -   Add overrides to other themes if needed

---

## Common Patterns

### Pattern 1: Button Group (Like ChatMessage)

When you have multiple buttons in a group:

```typescript
// General button styling (applies to all)
'button.message': { ... }

// Specific button styling (overrides general)
'button#message.copy': { ... }
'button#message.retry': { ... }
'button#message.edit': { ... }
```

### Pattern 2: Form Inputs

```typescript
// All inputs in form
'input.form': {
    variant: 'outline',
    size: 'md',
}

// Specific input fields
'input#form.email': { ... }
'input#form.password': { ... }
```

### Pattern 3: Toolbar

```typescript
// All toolbar buttons
'button.toolbar': {
    variant: 'ghost',
    size: 'sm',
}

// Special buttons in toolbar
'button#toolbar.save': {
    variant: 'solid',
    color: 'success',
}
```

### Pattern 4: Mixed Components

```typescript
// Buttons in dialog
'button.dialog': { ... }

// Inputs in dialog
'input.dialog': { ... }

// Container styling
'div#dialog.header': { ... }
```

---

## How the Theme System Works

Understanding this will help you use it correctly:

### Resolution Process

When a component resolves its overrides:

1. Component passes parameters to `useThemeOverrides()`:

    - `component`: 'button' | 'input' | 'div' | etc.
    - `context`: 'message' | 'chat' | 'sidebar' | etc.
    - `identifier`: 'message.copy' | 'chat.send' | etc.

2. Theme system finds all matching selectors:

    ```
    'button'                    ← matches (global)
    'button.message'            ← matches (context)
    'button#message.copy'       ← matches (specific)
    'button:hover'              ← matches if hovering
    'button[type="submit"]'     ← matches if attribute present
    ```

3. System merges by specificity (most specific wins):

    ```
    Global (1) < Context (11) < Identifier (21) < State (31)
    ```

4. Merged props are applied to component

### Context Auto-Detection (Optional)

Note: In ChatMessage, we explicitly pass `context: 'message'`. This is manual context passing.

The system also supports auto-detection via DOM walking (using the `v-theme` directive), but when using `useThemeOverrides()` directly, you must pass the context explicitly.

---

## Troubleshooting

### Overrides Not Applied

**Check:**

1. Is `component` correct? (`'button'`, `'input'`, etc.)
2. Is `context` correct? Does it match the theme selector?
3. Is `identifier` correct? Does it match the theme selector?
4. Is `isNuxtUI` set correctly?
5. Are you using `v-bind` in the template?

**Example:**

Component:

```typescript
useThemeOverrides({
    component: 'button',
    context: 'sidebar', // ← This context
    identifier: 'sidebar.new-chat',
    isNuxtUI: true,
});
```

Theme must have matching selector:

```typescript
'button.sidebar'; // ✅ Matches context
'button#sidebar.new-chat'; // ✅ Matches identifier
'button.chat'; // ❌ Wrong context
```

### Props Conflict

If both component props and theme props exist, theme props win (because of spread operator):

```typescript
return {
    variant: 'solid', // Component default
    ...(overrides.value as any), // Theme props override this
};
```

To give component props priority instead:

```typescript
return {
    ...(overrides.value as any), // Theme props first
    variant: 'solid', // Component prop overrides theme
};
```

### Not Reactive to Theme Changes

Make sure you're using `computed()` and `useThemeOverrides()`:

```typescript
// ✅ Correct - reactive to theme changes
const buttonProps = computed(() => {
    const overrides = useThemeOverrides({ ... });
    return { ..., ...overrides.value };
});

// ❌ Wrong - not reactive
const buttonProps = {
    const overrides = useThemeOverrides({ ... });
    return { ..., ...overrides.value };
};
```

---

## Tips for the Intern

1. **Start with components that have many buttons** (like ChatMessage) - easier to see the pattern working
2. **Use consistent naming**: `button#sidebar.new-chat` not `button#sidebar.createNew`
3. **Group related buttons together** in the theme file
4. **Test frequently** - apply changes and verify in browser
5. **Ask questions** if identifiers or contexts are unclear
6. **Copy-paste templates** - don't reinvent the wheel for similar patterns

---

## Next Steps After Integration

Once a component is themed:

1. Add to a list of "themed components" in the project docs
2. Consider adding tests for theme resolution
3. Update other themes (if they exist) with similar overrides
4. Document any custom patterns unique to that component

---

## Resources

-   [Theme API Reference](/public/_documentation/themes/api-reference.md)
-   [Best Practices](/public/_documentation/themes/best-practices.md)
-   [Theme Migration Guide](/public/_documentation/themes/migration-guide.md)
-   [ChatMessage Implementation](./ChatMessage.vue) - Reference example
