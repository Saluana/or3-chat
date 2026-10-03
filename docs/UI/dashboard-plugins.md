# Source dashboard tiles and pages

Dashboard registries add trusted source tiles and lazy pages. Portable plugin
authors use [SDK feature recipes](../../public/_documentation/plugins/add-features.md);
deployment admin plugins have a
[separate server contract](../../public/_documentation/plugins/admin-plugins.md).

The defining module is
[useDashboardPlugins.ts](../../app/composables/dashboard/useDashboardPlugins.ts).
Import `DashboardPlugin` and `DashboardPluginPage` there. Tiles have an ID,
icon, label, optional order/description, handler, pages, and access fields.
Pages have their own ID/title, component, optional ordering/access, and an
optional availability predicate.

## Register a tile

Create `app/plugins/dashboard-hello.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { useToast } from '#imports';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';

export default defineNuxtPlugin(() => {
    const toast = useToast();
    const handle = registerDashboardPlugin({
        id: 'example:hello',
        icon: 'tabler:star',
        label: 'Hello',
        order: 250,
        handler: () => { toast.add({ title: 'Hello from the dashboard' }); },
    });
    if (import.meta.hot) {
        import.meta.hot.dispose(() => { handle.dispose(); });
    }
});
```

The returned handle removes only its owned tile registration and associated
pages. Component-owned registrations also dispose on unmount. Removing by ID
with `unregisterDashboardPlugin()` intentionally removes the current tile.

## Attach pages

Supply `pages` on the tile or use
`registerDashboardPluginPage(pluginId, page)`. A page's component can be a
Vue component or an async import factory. Create the component file before
referencing it. A complete source example lives in
[dashboard-pages-example](../../app/plugins/examples/dashboard-pages-example.client.ts).

The navigation controller handles the available page list:

- No available pages: invoke the tile handler when present.
- One available page: open it directly.
- Multiple available pages: display a landing list.

Access gates and `isAvailable` can affect that list; the raw declared count
does not determine navigation. Tile and page order default to 200. Re-registering
a page replaces its descriptor and clears its resolved component cache.
`unregisterDashboardPluginPage(pluginId, pageId)` removes one page; omitting
the page ID removes that tile's pages. Page registration itself returns void.

Use `useDashboardNavigation()` for the host modal's navigation, loading, and
error state. Reuse its dispatch and lazy resolution rather than adding routing
logic to each page. Inspect its source types for current return fields.

## Verify and diagnose

Check tile-only, single-page, and multi-page behavior; loading failures; policy
denials; back navigation; and HMR cleanup. The ID inspection/list helpers show
registered entries, while the navigation controller applies availability and
policy before display. A registered tile is not proof that it is accessible.

Prefer lazy pages, namespace IDs, capture setup-dependent UI helpers during
initialization, and keep handlers responsive. An access-gated tile does not
authorize its server operations.
