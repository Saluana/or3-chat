# useDashboardPlugins

Dashboard extension hub that lets first- and third-party features register launcher tiles, lazy-loaded pages, and capability flags for the retro dashboard. It centralises plugin discovery, page resolution, and in-app navigation state.

---

## What does it do?

`useDashboardPlugins` and its sibling utilities give you a full plugin registry:

-   `registerDashboardPlugin` / `unregisterDashboardPlugin` keep a global map of tiles, their icons, handlers, and optional inline pages.
-   `registerDashboardPluginPage` normalises page definitions, marks components as raw, and handles lazy factories + caches.
-   `useDashboardPlugins()` exposes a sorted, reactive list for rendering the dashboard grid.
-   `useDashboardNavigation()` orchestrates the dashboard → plugin → page flow, resolving components on demand and surfacing errors.
-   Capability helpers (`hasCapability`, `hasAllCapabilities`, etc.) enforce optional permission checks per plugin.

The registry survives HMR and SSR hydration thanks to `globalThis` caching and careful cloning/marking of reactive components.

---

## Basic Example

```ts
import {
    registerDashboardPlugin,
    registerDashboardPluginPage,
    useDashboardNavigation,
} from '~/composables/dashboard/useDashboardPlugins';

registerDashboardPlugin({
    id: 'notes',
    icon: 'i-ph-note-pencil',
    label: 'Notes',
    order: 120,
    capabilities: ['canWriteDocs'],
});

registerDashboardPluginPage('notes', {
    id: 'compose',
    title: 'Compose note',
    component: () => import('~/components/dashboard/NotesCompose.vue'),
});

const { dashboardItems, openPlugin, landingPages, openPage } =
    useDashboardNavigation();

await openPlugin('notes');
await openPage('notes', 'compose');
```

---

## How to use it

### 1. Register plugins early

Call `registerDashboardPlugin()` in a client entry (plugin, layout setup) so the dashboard grid has items on first render. Inline `pages` are optional but handy for declarative registration.

### 2. Define pages (optional)

Use `registerDashboardPluginPage(pluginId, page)` for additional routes or lazy modules. Page components can be direct Vue components or async factories; the registry caches the resolved component per plugin/page pair.

### 3. Drive the UI with `useDashboardNavigation`

The navigation composable merges built-in base items with registered plugins. It exposes:

-   `dashboardItems` — sorted tiles, ready for rendering.
-   `openPlugin(id)` — opens a plugin tile; routes to sole page automatically.
-   `openPage(pluginId, pageId)` — resolves and mounts a page component, tracking loading state and errors.
-   `goBack()` / `reset()` — return to the dashboard view.

Use `resolvedPageComponent` to mount the current page inside a `<component>`.

### 4. Enforce capabilities when needed

`hasCapability`, `hasAnyCapability`, and `hasAllCapabilities` read declarations from the registered plugin. Wire these into guards, button states, or context menus.

---

## API

### Plugin registry

```ts
registerDashboardPlugin(plugin: DashboardPlugin): void;
unregisterDashboardPlugin(id: string): void;
useDashboardPlugins(): ComputedRef<DashboardPlugin[]>;
listRegisteredDashboardPluginIds(): string[];
```

### Page registry

```ts
registerDashboardPluginPage(pluginId: string, page: DashboardPluginPage): void;
unregisterDashboardPluginPage(pluginId: string, pageId?: string): void;
useDashboardPluginPages(getId: () => string | undefined): ComputedRef<DashboardPluginPage[]>;
listDashboardPluginPages(pluginId: string): DashboardPluginPage[];
getDashboardPluginPage(pluginId: string, pageId: string): DashboardPluginPage | undefined;
resolveDashboardPluginPageComponent(pluginId: string, pageId: string): Promise<Component | undefined>;
```

### Navigation runtime

```ts
useDashboardNavigation(options?: { baseItems?: DashboardPlugin[] }): {
    state: Readonly<DashboardNavigationState>;
    resolvedPageComponent: Readonly<ShallowRef<Component | null>>;
    dashboardItems: ComputedRef<DashboardPlugin[]>;
    landingPages: ComputedRef<DashboardPluginPage[]>;
    headerPluginLabel: ComputedRef<string>;
    activePageTitle: ComputedRef<string>;
    openPlugin(pluginId: string): Promise<DashboardNavigationResult>;
    openPage(pluginId: string, pageId: string): Promise<DashboardNavigationResult>;
    goBack(): void;
    reset(): void;
};
```

### Capability helpers

```ts
hasCapability(pluginId: string, capability: string): boolean;
getPluginCapabilities(pluginId: string): string[];
hasAllCapabilities(pluginId: string, capabilities: string[]): boolean;
hasAnyCapability(pluginId: string, capabilities: string[]): boolean;
```

---

## Under the hood

1. **Global registries** — Uses `globalThis` slots so plugins survive HMR and SSR boundary crossings without duplicate registration.
2. **Reactive projections** — Keeps `reactiveList` and `reactivePages` mirrors for Vue consumers, ensuring computed getters remain responsive.
3. **Ordering** — Applies `DEFAULT_ORDER` (200) when no explicit order is set, making plugin placement predictable.
4. **Component caching** — Memoises resolved page components, clears caches on unregister, and marks resolved objects with `markRaw` to preserve Vue perf.
5. **Navigation state** — A singleton runtime tracks view mode, active plugin/page ids, loading state, and errors while exposing read-only refs to the UI.

---

## Edge cases & tips

-   **Duplicate IDs**: In dev, re-registering a plugin logs a warning but still replaces it—handy during HMR but avoid in production.
-   **Lazy pages**: If an async page loader returns a non-component, dev mode warns and the nav surfaces a `resolve-error` result.
-   **Single-page plugins**: `openPlugin()` auto-opens the lone page, simplifying button handlers.
-   **Error handling**: `openPlugin`/`openPage` return `{ ok: false, error }` with codes (`missing-plugin`, `missing-page`, `handler-error`, `resolve-error`) for structured UI reactions.
-   **Capability checks**: All capability helpers safely return `false` when the plugin is absent or declarations are missing—no need for extra guards.

---

## Related

-   `~/composables/dashboard` — home for dashboard-specific extensions.
-   `~/core/hooks` — hook system often used by plugins during registration.
-   `~/app/components/dashboard` — grid and page host components that consume `useDashboardNavigation`.
