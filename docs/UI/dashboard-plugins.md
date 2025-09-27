# Extensible Dashboard Plugins & Pages

This guide explains how to add custom tiles ("plugins") to the Dashboard grid and optionally attach **lazy‑loaded pages** to them.
It mirrors the patterns used by message / document / project tree actions, extending them to a multi‑page surface.

## Where to import

Helpers are auto‑imported by Nuxt (barrel exported from `app/composables/index.ts`):

-   `registerDashboardPlugin()`
-   `unregisterDashboardPlugin()`
-   `registerDashboardPluginPage()` _(optional incremental page registration)_
-   `unregisterDashboardPluginPage()`
-   `useDashboardPlugins()`
-   `useDashboardPluginPages()`
-   `resolveDashboardPluginPageComponent()` (internal utility; you rarely need this directly)
-   `listRegisteredDashboardPluginIds()`
-   `listDashboardPluginPages()`
-   `useDashboardNavigation()` _(modal integration helper)_

Implementation lives at `app/composables/ui-extensions/dashboard/useDashboardPlugins.ts`.

## Plugin interface (summary)

```ts
export interface DashboardPlugin {
    id: string; // unique across all plugins
    icon: string; // icon (Iconify / UIcon name)
    label: string; // tile label underneath icon
    description?: string; // optional long description
    order?: number; // lower = earlier (core <200, plugins >=200 recommended)
    handler?: (ctx: { id: string }) => void | Promise<void>; // invoked if no pages
    pages?: DashboardPluginPage[]; // optional inline page definitions
}

export interface DashboardPluginPage {
    id: string; // unique within the plugin
    title: string; // displayed in header / landing list
    icon?: string; // optional per-page icon
    order?: number; // order inside plugin landing
    description?: string; // shown on landing list (multi-page)
    component: Component | (() => Promise<any>); // component or async loader
}
```

## Registering a simple (tile-only) plugin

If your plugin just performs an action when clicked (no pages):

```ts
// app/plugins/examples/dashboard-hello.client.ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'example:hello',
        icon: 'pixelarticons:star',
        label: 'Hello',
        order: 250,
        handler() {
            useToast().add({ title: 'Hello plugin', duration: 2500 });
        },
    });
});
```

## Registering a multi‑page plugin (inline pages)

```ts
// app/plugins/examples/dashboard-analytics.client.ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'analytics:main',
        icon: 'pixelarticons:graph',
        label: 'Analytics',
        description: 'Usage & performance insights',
        order: 180,
        pages: [
            {
                id: 'overview',
                title: 'Overview',
                icon: 'pixelarticons:dashboard',
                description: 'High level metrics',
                component: () =>
                    import('~/components/analytics/OverviewPage.vue'),
            },
            {
                id: 'events',
                title: 'Events',
                component: () =>
                    import('~/components/analytics/EventsPage.vue'),
            },
        ],
    });
});
```

Behavior:

-   0 pages → clicking tile invokes `handler` (if provided) or does nothing.
-   1 page → clicking tile opens that page immediately.
-   2+ pages → clicking tile shows a landing list of pages (title + description). Selecting a page loads it lazily.
-   All branching above is handled centrally by `useDashboardNavigation()`—the modal no longer duplicates this logic.

## Incremental page registration

You may prefer to register the plugin first, then add pages from other modules:

```ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'reports:root',
        icon: 'pixelarticons:layers',
        label: 'Reports',
        order: 210,
    });

    registerDashboardPluginPage('reports:root', {
        id: 'daily',
        title: 'Daily Report',
        component: () => import('~/components/reports/DailyReport.vue'),
    });

    registerDashboardPluginPage('reports:root', {
        id: 'monthly',
        title: 'Monthly Report',
        component: () => import('~/components/reports/MonthlyReport.vue'),
    });
});
```

Re-registering the same page id replaces the previous definition (HMR‑friendly).

## Lazy loading & caching

-   Async `component` functions are awaited the first time a page is opened.
-   The resolved component is cached (per `pluginId:pageId`) to avoid repeat imports.
-   If you need a fresh load (e.g. dev tools), unregister the page then re-register.

## Ordering rules

-   Dashboard grid order: `(plugin.order ?? 200)` ascending.
-   Page landing order: `(page.order ?? 200)` ascending.
-   Core / built‑ins should keep order < 200 so third‑party plugins naturally appear after them.

## Runtime usage in the Dashboard

`Dashboard.vue` now consumes `useDashboardNavigation({ baseItems })`, which merges built-in tiles with anything you register and exposes read-only state for the modal to render:

-   `dashboardItems` → sorted grid tiles (core + registered plugins)
-   `landingPages` → pages for the currently selected plugin (keeps landing cards in sync)
-   `openPlugin()` / `openPage()` / `goBack()` → navigation actions that wrap handler dispatch and async page resolution
-   `headerPluginLabel` / `activePageTitle` / `state` → helper values for the modal chrome and loading/errors

Because navigation is centralized, plugin developers only need to register plugins/pages—no additional wiring inside the modal is required. Structured navigation errors bubble through `state.error` so the UI can surface missing plugin/page issues consistently.

## Unregistering

```ts
unregisterDashboardPlugin('reports:root'); // removes plugin + its pages
unregisterDashboardPluginPage('reports:root', 'daily'); // remove one page
unregisterDashboardPluginPage('reports:root'); // remove all pages for plugin
```

## Best practices

-   Namescape ids: `vendor:feature` (e.g. `acme:reports`).
-   Keep initial `pages` array small; large sets can be added incrementally.
-   Prefer lazy imports for all but trivial pages to keep initial bundle size low.
-   Show clear feedback in handlers (`useToast`) for tile‑only plugins.
-   Use descriptive `description` for multi‑page landing clarity.

## Edge cases & notes

-   Duplicate plugin id → last registration wins (replacement).
-   Duplicate page id (within same plugin) → replacement.
-   Removing a plugin automatically clears its pages.
-   If both `handler` and `pages` exist: `handler` only runs when there are **0 pages** (or could be extended later for modifier click behavior).
-   All registries live on `globalThis` for HMR resilience.

## Testing (programmatic)

```ts
registerDashboardPlugin({
    id: 'test:solo',
    icon: 'pixelarticons:star',
    label: 'Solo',
});
expect(listRegisteredDashboardPluginIds()).toContain('test:solo');

registerDashboardPluginPage('test:solo', {
    id: 'p1',
    title: 'P1',
    component: () =>
        Promise.resolve({ default: { render: () => h('div', 'ok') } }),
});
expect(listDashboardPluginPages('test:solo').length).toBe(1);

unregisterDashboardPluginPage('test:solo', 'p1');
expect(listDashboardPluginPages('test:solo').length).toBe(0);

unregisterDashboardPlugin('test:solo');
expect(listRegisteredDashboardPluginIds()).not.toContain('test:solo');
```

## Manual verification checklist

-   Open Dashboard → new tile appears in correct order.
-   Click tile with 0 pages: handler runs (toast/log).
-   Click tile with 1 page: page opens directly.
-   Click tile with >1 pages: landing list displays page cards.
-   Select a page: component lazy loads and renders.
-   Navigate back (chevron) returns to grid.

## Troubleshooting

| Symptom                     | Likely Cause                                         | Fix                                                            |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Tile missing                | Plugin not registered yet                            | Check console / ensure plugin file path & suffix `.client.ts`  |
| Landing empty               | Pages registered under wrong plugin id               | Verify ids match                                               |
| `[object Promise]` rendered | Async component function not awaited (older version) | Update to latest registry (fix already merged)                 |
| Page never loads            | Import path wrong                                    | Open dev tools → network/errors; adjust `import()` path        |
| Order unexpected            | Missing/duplicate `order` values                     | Inspect `useDashboardPlugins().value.map(p => [p.id,p.order])` |

## Example: minimal multi‑page plugin (copy & adapt)

```ts
export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'demo:multi',
        icon: 'pixelarticons:layers',
        label: 'Multi Demo',
        order: 240,
        pages: [
            {
                id: 'a',
                title: 'Page A',
                component: () => import('~/components/demo/PageA.vue'),
            },
            {
                id: 'b',
                title: 'Page B',
                component: () => import('~/components/demo/PageB.vue'),
            },
        ],
    });
});
```

## Where to go next

-   Add categories / search (future extension).
-   Add deep-linking via query params for `pluginId` + `pageId`.
-   Add KeepAlive caching toggle per page.

---

**Summary:** The Dashboard plugin system lets you register tiles plus lazy pages using a familiar registration API. Keep ids stable, prefer lazy imports, and leverage order values for placement. Everything is HMR-safe and minimal at runtime.
