# Sidebar Plugin Guide

This guide shows how to create sidebar pages and pane apps in the OR3 chat system. Sidebar plugins let you add custom UI components that integrate with the existing pane system.

## Folder Structure

```
app/plugins/examples/
├── your-plugin.client.ts        # Main registration file
├── components/
│   ├── YourPluginPane.vue      # Pane component (main content)
│   └── YourPluginSidebar.vue   # Sidebar component (navigation)
└── your-plugin.ts              # Optional business logic
```

## Registration

Create a `.client.ts` file to register your plugin:

```typescript
// app/plugins/examples/your-plugin.client.ts
import YourPluginPane from './components/YourPluginPane.vue'
import YourPluginSidebar from './components/YourPluginSidebar.vue'

export default defineNuxtPlugin((nuxtApp) => {
  const multiPane = nuxtApp.$multiPane
  
  // Register pane app
  multiPane?.registerPaneApp({
    id: 'your-plugin',
    name: 'Your Plugin',
    component: YourPluginPane,
    postType: 'your-plugin-data',
    hooks: {
      async onRecordCreate(recordId, context) {
        // Handle record creation
        console.log('[your-plugin] Record created:', recordId)
      },
      async onRecordUpdate(recordId, updates, context) {
        // Handle record updates
        console.log('[your-plugin] Record updated:', recordId, updates)
      },
    },
  })
  
  // Register sidebar page
  multiPane?.registerSidebarPage({
    id: 'your-plugin-page',
    name: 'Your Plugin',
    component: YourPluginSidebar,
    icon: 'i-heroicons-cube',
  })
})
```

## Pane Component

The pane component renders in the main content area:

```vue
<!-- app/plugins/examples/components/YourPluginPane.vue -->
<template>
  <div class="your-plugin-pane p-4">
    <h2 class="text-xl font-bold mb-4">Your Plugin</h2>
    <p>Current count: {{ count }}</p>
    <UButton @click="increment" class="mt-2">
      Increment
    </UButton>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const count = ref(0)

function increment() {
  count.value++
}

onMounted(() => {
  console.log('[YourPluginPane] Mounted')
})
</script>

<style scoped>
.your-plugin-pane {
  /* Custom styles */
}
</style>
```

## Sidebar Component

The sidebar component provides navigation and controls:

```vue
<!-- app/plugins/examples/components/YourPluginSidebar.vue -->
<template>
  <div class="your-plugin-sidebar p-4">
    <h3 class="text-lg font-bold mb-4">Plugin Controls</h3>
    
    <div class="space-y-4">
      <UButton @click="switchToPane" variant="outline">
        Open Plugin Pane
      </UButton>
      
      <UButton @click="resetCount" variant="ghost">
        Reset Counter
      </UButton>
    </div>
    
    <div class="mt-6">
      <h4 class="font-semibold mb-2">Recent Activity</h4>
      <div class="text-sm text-gray-600">
        Last action: {{ lastAction }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const multiPane = useMultiPane()
const lastAction = ref('None')

function switchToPane() {
  multiPane.switchToApp('your-plugin')
  lastAction.value = 'Opened pane'
}

function resetCount() {
  // This would typically communicate with the pane
  lastAction.value = 'Reset counter'
}
</script>

<style scoped>
.your-plugin-sidebar {
  /* Custom sidebar styles */
}
</style>
```

## Lifecycle Hooks

Plugins can hook into various lifecycle events:

### Available Hooks

- **onRecordCreate**: Called when a new record is created
- **onRecordUpdate**: Called when a record is updated  
- **onRecordDelete**: Called when a record is deleted
- **onPaneActivate**: Called when the pane becomes active
- **onPaneDeactivate**: Called when the pane is no longer active

### Hook Usage

```typescript
hooks: {
  async onRecordCreate(recordId, context) {
    // ✅ Do: Validate and process data
    // ✅ Do: Update UI state
    // ❌ Don't: Block the main thread
    // ❌ Don't: Throw unhandled errors
    
    try {
      await validateRecord(recordId)
      updateUI()
    } catch (error) {
      console.error('[plugin] Hook failed:', error)
    }
  }
}
```

## Data Persistence

Use the built-in posts API for data persistence:

```typescript
// In your pane component
const api = window.__or3PanePluginApi

// Save data
async function saveData(data: any) {
  const result = await api.posts.create({
    postType: 'your-plugin-data',
    title: 'Plugin State',
    content: JSON.stringify(data),
    meta: { version: '1.0' },
    source: 'your-plugin',
  })
  
  if (!result.ok) {
    console.error('Save failed:', result.message)
  }
  
  return result
}

// Load data
async function loadData() {
  const result = await api.posts.listByType({
    postType: 'your-plugin-data',
    limit: 1,
  })
  
  if (result.ok && result.posts.length > 0) {
    return JSON.parse(result.posts[0].content)
  }
  
  return null
}
```

## Best Practices

### ✅ Do

- Keep components focused and single-purpose
- Use proper TypeScript types
- Handle errors gracefully
- Use the posts API for data persistence
- Follow the existing naming conventions
- Test with different pane configurations

### ❌ Don't

- Block the main thread with heavy computations
- Store large amounts of data in component state
- Access internal APIs not in the public interface
- Modify global state without proper cleanup
- Ignore error handling

## Minimal Example

Here's a complete minimal plugin (under 40 lines):

```typescript
// app/plugins/examples/counter-plugin.client.ts
import CounterPane from './CounterPane.vue'

export default defineNuxtPlugin((nuxtApp) => {
  const multiPane = nuxtApp.$multiPane
  
  multiPane?.registerPaneApp({
    id: 'counter',
    name: 'Counter',
    component: CounterPane,
  })
  
  multiPane?.registerSidebarPage({
    id: 'counter-page', 
    name: 'Counter',
    component: CounterPane,
  })
})
```

```vue
<!-- app/plugins/examples/CounterPane.vue -->
<template>
  <div class="p-4">
    <h2 class="text-xl font-bold mb-4">Counter</h2>
    <p>Count: {{ count }}</p>
    <UButton @click="count++">Increment</UButton>
  </div>
</template>

<script setup>
const count = ref(0)
</script>
```

## Type Definitions

Refer to the main type definitions in `app/composables/sidebar/types.ts` for complete interface specifications.

## Integration

Your plugin will automatically appear in:
- The sidebar navigation
- The pane switcher
- Any relevant hook chains

For more advanced usage, see the [Pane Plugin API](../pane-plugin-api.md) documentation.
