# Using Identifiers in Custom Plugins

## Overview

Identifiers in the theme system allow you to target specific components for theme overrides using the `data-id` attribute. This guide shows how to use identifiers in your custom plugins.

## How Identifiers Work

### 1. Theme Definition
In your theme files, use the `#identifier` syntax:

```typescript
// app/theme/my-theme/theme.ts
export default defineTheme({
    name: 'my-theme',
    colors: {
        primary: '#3f8452',
        secondary: '#5a7b62',
        surface: '#f5faf5'
    },
    overrides: {
        // Global button style
        'button': { variant: 'solid' },
        
        // Context-specific button style
        'button.chat': { variant: 'ghost' },
        
        // Identifier-specific button style (most specific)
        'button#chat.send': { 
            variant: 'solid', 
            color: 'primary',
            size: 'md'
        },
        
        // Multiple identifiers for different actions
        'button#sidebar.new-chat': { variant: 'outline' },
        'button#sidebar.settings': { variant: 'ghost' },
        'input#chat.message': { 
            variant: 'outline',
            size: 'lg'
        }
    }
});
```

### 2. Component Usage
Use the `v-theme` directive with identifiers:

```vue
<template>
    <!-- Basic usage - auto-detects component type -->
    <UButton v-theme>Default Button</UButton>
    
    <!-- With identifier - adds data-id="chat.send" -->
    <UButton v-theme="'chat.send'">Send Message</UButton>
    
    <!-- Object syntax with full control -->
    <UButton v-theme="{ 
        identifier: 'chat.send', 
        theme: 'my-theme', 
        context: 'chat' 
    }">
        Send with Custom Theme
    </UButton>
    
    <!-- Input with identifier -->
    <UInput v-theme="'chat.message'" placeholder="Type a message..." />
    
    <!-- Custom component with identifier -->
    <MyCustomComponent v-theme="'my-plugin.action'" />
</template>
```

### 3. Custom Plugin Implementation
Create custom components that work with identifiers:

```typescript
// app/components/MyCustomComponent.vue
<template>
    <div 
        v-theme="'my-plugin.action'"
        class="custom-component"
        @click="handleAction"
    >
        <slot />
    </div>
</template>

<script setup>
const handleAction = () => {
    console.log('Custom action triggered');
};
</script>
```

### 4. Manual Identifier Setting
If you need to set identifiers manually (outside v-theme):

```vue
<template>
    <button 
        :data-id="manualIdentifier"
        class="retro-btn"
        @click="handleClick"
    >
        Manual Identifier Button
    </button>
</template>

<script setup>
const manualIdentifier = 'manual.action.submit';

const handleClick = () => {
    // Your action logic
};
</script>
```

## Identifier Naming Conventions

Use dot notation for hierarchical identifiers:

- `chat.send` - Send button in chat context
- `sidebar.new-chat` - New chat button in sidebar
- `header.user-menu` - User menu in header
- `modal.confirm.delete` - Delete confirmation in modal
- `form.submit` - Form submit button
- `toolbar.save` - Save button in toolbar

## Supported Contexts

The system recognizes these contexts:
- `chat` - Chat interface
- `sidebar` - Sidebar navigation
- `dashboard` - Main dashboard
- `header` - Header area
- `global` - Global context (default)

## Specificity Rules

Theme overrides follow CSS-like specificity:

1. **Most specific**: `component#identifier.context:state`
2. **Identifier + context**: `component#identifier.context`
3. **Identifier only**: `component#identifier`
4. **Context only**: `component.context`
5. **Component only**: `component`

Example:
```typescript
overrides: {
    // Least specific
    'button': { variant: 'solid' },
    
    // More specific
    'button.chat': { variant: 'ghost' },
    
    // Most specific
    'button#chat.send': { variant: 'solid', color: 'primary' }
}
```

## Runtime Behavior

When you use `v-theme="'chat.send'"`:

1. The directive detects the component type (e.g., 'button')
2. Sets `data-id="chat.send"` on the element
3. Detects context from DOM (e.g., 'chat')
4. Resolves theme overrides using: `component + context + identifier`
5. Applies resolved props as data attributes

## Testing Identifiers

```vue
<template>
    <div class="test-area">
        <!-- Test different identifier combinations -->
        <UButton v-theme="'test.basic'">Basic</UButton>
        <UButton v-theme="'test.advanced.action'">Advanced</UButton>
        <UButton v-theme="'test.nested.very.deep.action'">Nested</UButton>
        
        <!-- Check rendered attributes -->
        <button 
            data-id="manual.check"
            class="retro-btn"
        >
            Manual Check
        </button>
    </div>
</template>
```

## Best Practices

1. **Use descriptive identifiers**: `chat.send` instead of `button1`
2. **Follow dot notation**: `context.action` or `area.subarea.action`
3. **Be consistent**: Use the same naming pattern across your app
4. **Test specificity**: Ensure your overrides match as expected
5. **Document identifiers**: List all identifiers in your plugin docs

## Troubleshooting

### Identifier not working?
1. Check the `data-id` attribute is set in the DOM
2. Verify the identifier matches your theme definition
3. Ensure the theme is properly compiled and loaded
4. Check browser console for theme resolver warnings

### Override not applying?
1. Check specificity order in your theme
2. Verify context detection is working
3. Ensure component type is detected correctly
4. Test with simpler selector first

## Complete Example

```typescript
// 1. Theme definition
export default defineTheme({
    name: 'example-theme',
    colors: { primary: '#3f8452', surface: '#f5faf5' },
    overrides: {
        'button': { variant: 'outline' },
        'button#example.primary': { variant: 'solid', color: 'primary' },
        'button#example.secondary': { variant: 'ghost' }
    }
});

// 2. Component usage
<template>
    <div class="example-plugin">
        <UButton v-theme="'example.primary'">Primary Action</UButton>
        <UButton v-theme="'example.secondary'">Secondary Action</UButton>
    </div>
</template>
```

This system provides a powerful way to create themeable plugins with precise control over component styling.
