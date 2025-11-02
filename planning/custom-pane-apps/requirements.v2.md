# requirements.v2.md

## Purpose

Define the functional scope for the V2 “sidebar pages” pivot. The goal is to let plugins replace the main body of `SideNavContent.vue` with lazily loaded Vue components, while retaining the default project/chat/doc list as the baseline page. Navigation between pages must integrate with the collapsed sidebar UI and keep existing styling and behaviour intact for the default experience.

## Stakeholders & Scenarios

- **End users** need to switch between the standard sidebar list and plugin-provided views (e.g., todo manager) without losing core actions like search, new chat/doc/project, or footer shortcuts.
- **Plugin developers** want a declarative API to register pages (component, icon, label, order) and access core utilities (multi-pane API, posts API) from within their components.
- **Core engineers** must preserve backwards compatibility for current sidebar behaviour, minimise churn to unrelated systems, and provide clear upgrade guidance from the original Custom Pane Apps design.

## Functional Requirements

1. **Sidebar page registry**
   - Provide `useSidebarPages()` exposing `{ registerSidebarPage, unregisterSidebarPage, listSidebarPages, getSidebarPage }`.
   - Each `SidebarPageDef` SHALL include `id`, `label`, `icon`, `component`, optional `order`, `keepAlive`, `usesDefaultHeader`, and lifecycle hooks (`canActivate`, `onActivate`, `onDeactivate`).
   - Duplicate registrations with the same `id` SHALL replace the prior entry (supporting HMR).

2. **Default page registration**
   - The current `SideNavContent` body (header + `SidebarVirtualList`) SHALL be extracted into `SidebarHomePage.vue`.
   - This component SHALL be registered automatically as the default page (`id = 'sidebar-home'`) with `order = 0` and `usesDefaultHeader = true`.
   - Default page functionality (search, virtual list, footer actions, event emissions) MUST remain behaviourally identical to today.

3. **Active page state management**
   - Introduce `useActiveSidebarPage()` returning reactive `activePageId` plus setters.
   - Active page selection SHALL persist per user session (e.g., via `localStorage`) and reset to default when an unknown page id is requested.
   - Activation hooks (`canActivate`, `onActivate`, `onDeactivate`) MUST be honoured during page transitions.

4. **`SideNavContent.vue` refactor**
   - The component SHALL render only the active page inside the scroll area using `<Suspense>` and `<KeepAlive>` according to the page definition.
   - When `usesDefaultHeader` is true, the existing `SideNavHeader` MUST render and forward events exactly as before; otherwise the header SHALL be hidden to allow custom layouts.
   - The default page MUST receive props/events matching the legacy interface so no upstream callers need to change.
   - When a page component emits `SidebarPageEmit` events, `SideNavContent` SHALL forward them to its parent to keep existing wiring intact.

5. **Collapsed navigation integration**
   - `SideNavContentCollapsed.vue` SHALL list registered sidebar pages under the built-in button stack.
   - Buttons MUST display the provided `icon`, set `aria-label` to `label`, and highlight the active page.
   - Clicking a button MUST invoke `setActivePage(page.id)` after validating `page.canActivate`.
   - Ordering SHALL respect `page.order` and remain stable between sessions.

6. **Plugin developer utilities**
   - Ship helper `registerSidebarPage()` (client-only) that wraps registry calls, ensures async component wrapping, and handles auto-unregister on HMR.
   - Provide `useSidebarPageContext()` composable returning `{ page, setActivePage, resetToDefault, isCollapsed, multiPaneApi, panePluginApi }`.
   - Update plugin example + documentation to demonstrate registering a sidebar page alongside a pane app.

7. **Lazy loading & fallbacks**
   - Non-default pages SHALL be lazy loaded on demand. Timeouts or import failures MUST surface a friendly fallback UI and leave the previous page active.
   - Unknown page ids or missing registry entries SHALL not break the UI; instead log a dev warning and revert to default.

8. **Telemetry & accessibility**
   - Emit an analytics hook/event (`ui.sidebar.page:action:open`) after a page becomes active (parallels existing hook style).
   - Ensure new controls are keyboard accessible and pass basic a11y checks (focus ring, `aria-pressed`).

## Non-Functional Requirements

- All new logic MUST remain client-only to avoid SSR churn.
- Bundle impact SHOULD be minimised by lazy loading plugin pages and sharing context via composables instead of prop drilling large objects.
- Registry and state modules SHOULD mirror existing patterns to keep DX consistent (`usePaneApps`, `useSidebarSections`).
- Tests MUST cover the default page regression surface so no visual/functionality regressions slip in.

## Out of Scope

- Routing/query-string integration for sidebar page selection.
- Server-side validation of plugin-provided components.
- Major redesign of footer actions or SideNavCollapsed base buttons.
- Changing how multi-pane workspace panes are registered/rendered (addressed separately by the original plan).
