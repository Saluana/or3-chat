# Custom Pane Apps - Quick Start

Custom Pane Apps allow plugins to register arbitrary Vue components that render in the multi-pane workspace alongside chat and document panes. Data is persisted in the `posts` table with custom `postType` values.

## Basic Setup

### 1. Create a Nuxt Plugin

Plugins are auto-registered from `app/plugins/`. Create a `.client.ts` file for client-only code:

```typescript
// app/plugins/my-custom-app.client.ts
export default defineNuxtPlugin(async () => {
    if (!process.client) return;

    const { registerPaneApp } = usePaneApps();
    const { registerSidebarPostList } = await import(
        '~/composables/sidebar/registerSidebarPostList'
    );

    // Your registration code here...
});
```

### 2. Register a Pane App

```typescript
registerPaneApp({
    id: 'my-app', // Unique identifier (becomes pane mode)
    label: 'My App', // Display name
    icon: 'pixelarticons:note', // Icon name
    component: MyPaneComponent, // Vue component
    postType: 'my-app-data', // Optional: post type for persistence
    createInitialRecord: async () => {
        // Optional: Create initial record when opening new pane
        const api = (globalThis as any).__or3PanePluginApi;
        const result = await api.posts.create({
            postType: 'my-app-data',
            title: 'New Item',
            content: '',
            meta: {
                /* custom data */
            },
            source: 'my-plugin',
        });

        if (!result.ok) throw new Error(result.message);
        return { id: result.id };
    },
});
```

### 3. Create Your Pane Component

Your component receives these props:

```typescript
import { defineComponent } from 'vue';

const MyPaneComponent = defineComponent({
    name: 'MyPane',
    props: {
        paneId: { type: String, required: true },
        recordId: { type: String, default: null }, // Post ID
        postType: { type: String, required: true },
        postApi: { type: Object, required: true }, // CRUD helpers
    },
    setup(props) {
        // Load data
        onMounted(async () => {
            if (props.recordId) {
                const result = await props.postApi.listByType({
                    postType: props.postType,
                });
                // Handle result...
            }
        });

        // Save data
        const handleSave = async (data) => {
            await props.postApi.update({
                id: props.recordId,
                patch: { title: data.title, content: data.content, meta: data },
                source: 'my-plugin',
            });
        };

        return { handleSave };
    },
    // Your template or render function...
});
```

### 4. Register a Sidebar List (Optional)

Display a live-updating list in the sidebar:

```typescript
registerSidebarPostList({
    id: 'my-app:list',
    label: 'My Items',
    appId: 'my-app', // Links to your pane app
    postType: 'my-app-data',
    icon: 'pixelarticons:list',
    placement: 'main', // 'top' | 'main' | 'bottom'
    order: 200,
    limit: 50,
    emptyMessage: 'No items yet',
    renderItem: (post) => ({
        title: post.title,
        subtitle: `Updated ${new Date(
            post.updated_at * 1000
        ).toLocaleDateString()}`,
        icon: 'pixelarticons:note',
    }),
});
```

## Posts API Reference

### Create

```typescript
const result = await postApi.create({
    postType: 'my-type',
    title: 'Required title',
    content: 'Optional content',
    meta: { custom: 'data' }, // Any JSON-serializable data
    source: 'my-plugin',
});

if (result.ok) {
    console.log('Created:', result.id);
}
```

### Update

```typescript
await postApi.update({
    id: 'post-id',
    patch: {
        title: 'New title', // Optional
        content: 'New content', // Optional
        meta: { updated: true }, // Optional (replaces existing)
    },
    source: 'my-plugin',
});
```

### List by Type

```typescript
const result = await postApi.listByType({
    postType: 'my-type',
    limit: 100, // Optional
});

if (result.ok) {
    result.posts.forEach((post) => {
        console.log(post.id, post.title, post.meta);
    });
}
```

## Opening Panes Programmatically

```typescript
const multiPaneApi = (globalThis as any).__or3MultiPaneApi;

// Create new pane
await multiPaneApi.newPaneForApp('my-app', {
    existingRecordId: 'optional-post-id', // Skip createInitialRecord
});
```

## Live Data with usePostsList

For reactive queries outside of panes:

```typescript
import { usePostsList } from '~/composables/posts/usePostsList';

const { items, loading, error, refresh } = usePostsList('my-type', {
    limit: 50,
    sort: 'updated_at', // or 'created_at'
    sortDir: 'desc', // or 'asc'
});

// items.value updates automatically when posts change
```

## Complete Example

See `app/plugins/examples/custom-pane-todo-example.client.ts` for a full working example implementing a todo manager with:

-   Custom pane component
-   CRUD operations
-   Sidebar list integration
-   State management

## Best Practices

1. **Unique IDs**: Use namespaced IDs (`my-plugin:feature`) to avoid conflicts
2. **Client-Only**: Always check `process.client` and use `.client.ts` files
3. **Error Handling**: Check `result.ok` on all API calls
4. **Source Tracking**: Always provide a `source` identifier for auditing
5. **SSR Safety**: Use `process.client` guards in composables
6. **Meta Data**: Use `meta` field for arbitrary JSON data structures
7. **Cleanup**: Unregister apps/sections on plugin disable if needed

## Hooks Integration

Your pane app integrates with the existing hook system:

-   `ui.pane.open:action:after` fires when pane opens
-   `db.posts.create:action:after` fires when posts are created
-   `db.posts.upsert:action:after` fires when posts are updated

## Testing

Unit tests should mock:

-   `usePaneApps()` registry
-   `__or3PanePluginApi.posts` CRUD helpers
-   `__or3MultiPaneApi.newPaneForApp`

See `app/composables/core/__tests__/usePaneApps.test.ts` for patterns.

## Limitations

-   URL routing for custom panes not implemented (v1)
-   No sandboxing beyond existing plugin model
-   Storage limited to `posts` table schema
-   No server-side rendering of custom panes
