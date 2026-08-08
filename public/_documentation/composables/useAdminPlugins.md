# useAdminPlugins

Extension registry for the admin dashboard. Plugins register admin pages and widgets that appear inside the admin UI.

## What it does

-   `registerAdminPage(def)` — add or replace an admin page. The page def requires `id`, `title`, `icon`, and a `component` (eager or lazy).
-   `registerAdminWidget(def)` — add or replace a widget for a dashboard slot.
-   `useAdminPages()` — reactive list of registered pages.
-   `useAdminWidgets(slot?)` — reactive list of widgets, optionally filtered by slot.
-   `resolveAdminComponent(def)` — resolves eager or lazy components, caching async results.
-   `createAdminPluginApi()` — the API object handed to admin plugins: `{ registerAdminPage, registerAdminWidget }`.

`AdminPlugin` is `{ id, register(api) }`. The registry state is a module-level reactive array, so registrations from any module show up everywhere.

## Usage

```ts
import { registerAdminPage, registerAdminWidget } from '~/composables/admin/useAdminPlugins';

registerAdminPage({
    id: 'my-plugin-settings',
    title: 'My Plugin',
    icon: 'i-ph-gear',
    component: () => import('~/components/admin/MyPluginSettings.vue'),
});

registerAdminWidget({
    id: 'my-plugin-status',
    slot: 'status',
    component: () => import('~/components/admin/MyPluginStatus.vue'),
});
```

## Notes

-   Lazy components are wrapped with `defineAsyncComponent` and cached (cache capped at 50 entries).
-   Registration is idempotent per id; the latest definition wins.

## Related

-   `useAdminExtensions` — installing the plugin packages themselves.
-   `useAdminTypes` — types shared across the admin API.
