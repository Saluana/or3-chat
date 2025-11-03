## Custom Pane & Sidebar Overhaul – Full Accounting

The boss asked for line-item justification. Below is every file added, updated, or removed in this branch. For each I spell out:

- **Function** – what the file delivers now.
- **Why we touched it** – the concrete problem it solves and the design reasoning.
- **Key internals** – the important moving parts, so maintenance engineers know where to look.

I reviewed each file directly before writing this. Nothing here is hand-wavy.

---

### `.github/chatmodes/retro-agent.chatmode.md` *(updated)*
- **Function**: Prompt/config for our “retro” review bot.
- **Why**: Added instructions about Nuxt 4/Bun, pane plugin rules, and sidebar registries so automated reviews catch mistakes specific to the new architecture.
- **Key internals**: New sections forbid Node-only APIs, encourage TypeScript-only surfaces, and remind the bot about lazy imports for plugins.

### `.llms/pane-plugins.txt` *(new)*
- **Function**: List of known pane plugin IDs and descriptions consumed by our internal LLM tooling.
- **Why**: Keeps autocomplete/bots from suggesting non-existent plugin IDs, which would fail Zod validation in `usePaneApps`.
- **Key internals**: One `id: description` per line; devs extend it as plugins are published.

### `.windsurf/rules/or3-agent.md` *(new)*
- **Function**: Windsurf automation policy.
- **Why**: Locks Windsurf’s auto-fixes to the new rules (Bun runtime, strict TS, no Node polyfills). Prevents automated scripts from undoing the architecture we just built.
- **Key internals**: Sections covering repo guard rails, required test commands, and files to avoid touching.

---

## Workspace & Multi-Pane Core

### `app/components/PageShell.vue` *(updated)*
- **Function**: The master layout that coordinates panes, the sidebar, keyboard shortcuts, dashboard modal, and URL syncing.
- **Why we touched it**: Needed hooks into the new custom pane flow. It now resolves pane components through `usePaneApps`, sets up the sidebar environment, and exposes the global multi-pane API for plugins.
- **Key internals**:
  - `useMultiPane({...})` now destructures `newPaneForApp`, `setPaneApp`, `updatePane`, etc.
  - `resolvePaneComponent(pane)` returns chat, doc, a registered pane component, or `PaneUnknown`.
  - `buildPaneProps` injects `postApi`, `recordId`, `paneId` so every pane sees the same contract.
  - Watchers keep `/chat/:id` or `/docs/:id` in sync with whichever pane is active.
  - `__or3MultiPaneApi` global is set after `api` creation so plugins can reach it.

### `app/components/PaneUnknown.vue` *(new)*
- **Function**: Fallback UI when a pane mode is missing.
- **Why**: We needed obvious feedback instead of a blank pane when a plugin isn’t registered or fails to load.
- **Key internals**: Simple template that prints the missing `mode` and a suggestion to reload/register. No script logic—failures stay deterministic.

### `app/composables/core/useMultiPane.ts` *(updated heavily)*
- **Function**: Reactive store + actions for managing panes.
- **Why**: Added first-class support for custom pane modes and deduplicated imports of `usePaneApps`.
- **Key internals**:
  - `ensurePaneAppGetter()` caches the dynamic import of `usePaneApps` so we don’t re-import per call.
  - `newPaneForApp(appId, opts)` enforces max pane guard, runs `createInitialRecord`, sets mode/document, fires hooks.
  - `setPaneApp(index, appId, opts)` reuses `ensurePaneAppGetter`, creates records if needed, and dispatches `ui.pane.open:action:after`.
  - `updatePane` stays the safe mutation entry point for panes; we expose it via the sidebar environment adapter.
  - `globalThis.__or3MultiPaneApi` keep existing integrations working.

### `app/composables/core/usePaneApps.ts` *(new)*
- **Function**: Registry for pane definitions.
- **Why**: Plugins must register themselves while the app is running; this module validates definitions and stores them globally.
- **Key internals**:
  - `PaneAppDefSchema` (Zod) enforces lowercase slug IDs, label length ≤100, numeric order between 0-1000.
  - `registerPaneApp` wraps components in `markRaw` so Vue doesn’t proxy them and stores them in a Map on `globalThis`.
  - `listPaneApps` computed sorts by order; triggers reactivity by reassigning a new Map each time.

### `app/plugins/pane-plugin-api.client.ts` *(updated)*
- **Function**: Public API that pane apps call to mutate chats, documents, or posts.
- **Why**: Extended to expose posts CRUD, document set/patch, richer diagnostics, and to cooperate with the new multi-pane store.
- **Key internals**:
  - `sendMessage` chooses between the chat input bridge (for streaming) and Dexie append; returns `{ ok: true, messageId }` or a descriptive error code.
  - `ensureThread` creates threads when `createIfMissing` is true and triggers hook notifications so stats and add-ons stay consistent.
  - `updateDocumentContent` / `patchDocumentContent` call into `useDocumentState` to keep the editor in sync.
  - `posts` namespace wraps Dexie calls (`createPost`, `upsertPost`, `softDeletePost`, etc.) and enforces source tagging.
  - `getActivePaneData` clones doc content to avoid leaking reactive references to plugins.

### `app/composables/core/__tests__/useMultiPane.test.ts` *(new)*
- **Function**: Unit tests around the multi-pane composable.
- **Why**: Confirms we didn’t regress pane creation, max limits, thread binding, or hook dispatch when adding custom modes.
- **Key internals**: Mocks Dexie/hook bus, tests `newPaneForApp`, `setPaneApp`, and keyboard navigation.

### `app/composables/core/__tests__/usePaneApps.test.ts` *(new)*
- **Function**: Validates the pane app registry.
- **Why**: Ensures Zod validation throws on bad IDs, registry updates reactivity, and unregister cleans up.
- **Key internals**: Uses a clean global map per test to guarantee isolation.

### `types/global.d.ts` *(new)*
- **Function**: Declares global helpers (`__or3MultiPaneApi`, `__or3PanePluginApi`, etc.) for TypeScript awareness.
- **Why**: Without this, TS types degrade to `any` and plugin authors hit compile errors.
- **Key internals**: Extends `globalThis`, `Window` interfaces so both browser/server contexts recognize the globals.

---

## Sidebar Shell & Components

### `app/components/sidenav/SideBar.vue` *(new)*
- **Function**: Root sidebar container. Manages live data feeds, modal dialogs (rename/delete), and connects expanded/collapsed views.
- **Why**: We needed one authoritative component to host the new `SidebarSideNavContent` + collapsed rail, while handling Dexie subscriptions for threads/projects/docs.
- **Key internals**:
  - `liveQuery` subscriptions feed `items`, `projects`, `docs` refs in real time.
  - Project entry helpers now call `createThreadEntry` / `createDocumentEntry` from `useProjectsCrud`, reducing duplicate Dexie code.
  - Multiple modals share state refs (`renameId`, `showDeleteProjectModal`), so UI behaviour matches legacy flows.
  - Emits events (e.g., `chatSelected`, `documentSelected`) consumed in `PageShell`.

### `app/components/sidebar/SideNavContent.vue` *(updated)*
- **Function**: Expanded sidebar body that renders headers, dynamic pages, and footers.
- **Why**: It now provides `SidebarEnvironment` and `SidebarPageControls` to all child pages, orchestrates dynamic imports, and forwards events.
- **Key internals**:
  - `multiPaneApiRef` pulls the global multi-pane API; `createSidebarMultiPaneApi` wraps it for page consumption.
  - `environment` object exposes computed getters (projects, threads, docs, footer actions) and setter callbacks that emit upwards.
  - Uses `<Suspense>` + `<KeepAlive>` to support async pages and caching. Keys incorporate page ID + `keepAlive` flag.
  - `forwardedEvents` dictionary relays standard events from custom pages to the shell.

### `app/components/sidebar/SideNavContentCollapsed.vue` *(updated)*
- **Function**: Collapsed rail UI—shows quick actions, registered page icons, footer actions.
- **Why**: Custom pages must be available even in collapsed mode and should reuse the same guards and tooltips.
- **Key internals**:
  - `orderedPages` sorts pages via `useSidebarPages().listSidebarPages`.
  - `handlePageSelect` calls `setActivePage`, shows toast on failure, emits `expand-sidebar` on success.
  - Footer actions source from `useSidebarFooterActions` using a collapsed context (active thread/document).

### `app/components/sidebar/SideNavHeader.vue` *(updated)*
- **Function**: Header inside expanded sidebar with search, filters, quick actions.
- **Why**: Emits the new event names so `SideBar.vue` controls modals and Dexie writes. Also keeps focus helper accessible.
- **Key internals**:
  - `focusSearchInput()` digs into `UInput` DOM to select text; still exported via `defineExpose`.
  - Menu actions (`open-rename`, `open-rename-project`, etc.) route events upward for central handling.
  - Filter toggles rebuild `activeSections` object and emit updates.

### `app/components/sidebar/SidebarHeader.vue` *(updated)*
- **Function**: Alternate header for non-default pages.
- **Why**: Aligns actions with new environment contract (emits `toggle-dashboard`, etc.).
- **Key internals**: Accepts `actions` array; ensures each entry matches new event names.

### `app/components/sidebar/SideBottomNav.vue` *(updated)*
- **Function**: Footer nav (theme toggle, dashboard button).
- **Why**: Hooked into new events and uses the same `toggle-dashboard` semantics as the rest of the shell.
- **Key internals**: Buttons emit events or call composables consistently for both collapsed/expanded views.

### `app/components/sidebar/SidebarHomePage.vue` *(new)*
- **Function**: Default sidebar page when no custom page is selected.
- **Why**: Acts as bridge between legacy list behaviour and new environment contract. Ensures there’s always a landing page.
- **Key internals**:
  - Receives data (projects, threads, docs, footer actions) via props and passes it to `SidebarVirtualList`.
  - Forwards events like `add-document-to-project`, `rename-thread`, `delete-thread` to the parent.
  - Exposes `scrollAreaRef`, `bottomNavRef` so the shell can recalculate heights.

### `app/components/sidebar/SidebarVirtualList.vue` *(updated)*
- **Function**: Virtualized list mixing projects, chats, docs, and section headers.
- **Why**: Supports large data sets with smooth scrolling, using flat item model that matches new environment shape.
- **Key internals**:
  - `flatItems` computed flattens sections based on `activeSections`.
  - `lightweightDocs` strips heavy fields before rendering to keep DOM light.
  - Emits `selectThread`, `renameThread`, `addDocumentToProject`, etc. matching parent expectations.

### `app/components/ResizableSidebarLayout.vue` *(updated)*
- **Function**: Layout wrapper providing resizable sidebar slots.
- **Why**: Needed to host the new `SideBar` component in the expanded slot and collapsed fallback in the rail slot.
- **Key internals**: Additional slots for expanded/collapsed components, ensures width state is shared.

### `app/components/chat/ChatInputDropper.vue` *(updated)*
- **Function**: Manages drag-and-drop uploads into chat input.
- **Why**: Ensures file drops respect the active pane ID and play nicely with multi-pane state.
- **Key internals**: Emits events with `paneId`; updated watchers to avoid cross-pane contamination.

### `app/components/sidebar/__tests__/SideNavContent.test.ts` *(updated)*
- **Function**: Verifies expanded sidebar renders correct components and forwards events.
- **Why**: Added assertions for environment provisioning and event forwarding after refactor.
- **Key internals**: Uses helpers from `tests/utils/sidebar-test-helpers.ts` to mount with mock environment.

### `app/components/sidebar/__tests__/SideNavContentCollapsed.test.ts` *(new)*
- **Function**: Ensures collapsed sidebar shows custom pages, respects activation guards, and triggers footer actions.
- **Why**: Without this coverage the collapsed rail could regress silently.
- **Key internals**: Mocks `setActivePage`, checks toast display on guard failure.

---

## Sidebar Composables & Tests

### `app/composables/sidebar/index.ts` *(new)*
- **Function**: Barrel export for sidebar composables.
- **Why**: Lets plugins import from `~/composables/sidebar` instead of multiple paths.
- **Key internals**: Re-exports environment, controls, registry, sections, search.

### `app/composables/sidebar/useSidebarEnvironment.ts` *(new)*
- **Function**: Provides injection keys and helper hooks for sidebar pages.
- **Why**: Single contract for pages; keeps them decoupled from shell internals.
- **Key internals**:
  - `SidebarEnvironment` exposes getters/setters returning refs.
  - `createSidebarMultiPaneApi` adapts `useMultiPane` to safe methods (`openApp`, `openChat`, `openDoc` now sets `mode: 'doc'` and clears thread).
  - Helper hooks (`useSidebarProjects`, `useExpandedProjects`, etc.) wrap environment calls for ease of use.

### `app/composables/sidebar/useSidebarPages.ts` *(new)*
- **Function**: Registry for sidebar pages (id, label, icon, component, guards).
- **Why**: Plugins need a validated, reactive registry to add/remove pages.
- **Key internals**:
  - `SidebarPageDefSchema` validates input.
  - `normalizeSidebarPageDef` wraps async loaders with `defineAsyncComponent` including retry logic.
  - `listSidebarPages` sorts by `order`; uses `state.version` to signal updates.

### `app/composables/sidebar/useActiveSidebarPage.ts` *(new)*
- **Function**: Tracks current sidebar page and handles activation flow.
- **Why**: Central authority ensures all UI pieces react to the same active page.
- **Key internals**:
  - `activePageId` defaults to `'sidebar-home'`.
  - `setActivePage` runs `canActivate`, `onDeactivate`, `onActivate` hooks, returning `false` when vetoed.
  - `resetToDefault` puts the sidebar back on home.

### `app/composables/sidebar/useSidebarPageControls.ts` *(new)*
- **Function**: Hook for custom pages to get `pageId`, `isActive`, `setActivePage`, `resetToDefault`.
- **Why**: Keeps custom page code minimal and safely scoped.
- **Key internals**: Reads from provided `SidebarPageControls`; throws if page code forgets to call inside provider.

### `app/composables/sidebar/registerSidebarPage.ts` *(new)*
- **Function**: Plugin helper to register a sidebar page.
- **Why**: Abstracts the registry details, returning a disposer for cleanup.
- **Key internals**: Calls `useSidebarPages().registerSidebarPage`; handles async component imports.

### `app/composables/sidebar/registerSidebarPostList.ts` *(new)*
- **Function**: Simplifies registering a sidebar section that lists posts.
- **Why**: Encourages consistent post UI and centralizes clean-up logic.
- **Key internals**: Hooks into `useSidebarSections` to add a section with label/icon; returns cleanup.

### `app/composables/sidebar/useSidebarSearch.ts` *(updated)*
- **Function**: Sidebar search query and filtering logic.
- **Why**: Modified to read from the provided environment so custom pages show up correctly.
- **Key internals**: Computed results combine threads/docs/projects respecting `activeSections`.

### `app/composables/sidebar/useSidebarSections.ts` *(updated)*
- **Function**: Registry of sidebar sections and footer actions.
- **Why**: Added support for plugin-registered sections with lazy components.
- **Key internals**:
  - `resolveComponent` handles async loaders (with caching).
  - `useSidebarFooterActions` builds computed footer entries using provided context (active pane IDs, collapsed/expanded).

### `app/composables/_registry.ts` *(updated)*
- **Function**: Nuxt composable registry used for auto-import.
- **Why**: We registered the new sidebar and posts composables so the framework auto-importer sees them; without this, components/tests would fail at runtime.
- **Key internals**: Added exports for `useSidebarEnvironment`, `useSidebarPages`, `useActiveSidebarPage`, `useSidebarSection`, etc., matching the actual file paths.

### `app/composables/index.ts` *(updated)*
- **Function**: Manual export barrel for composables.
- **Why**: Ensures TypeScript and non-auto-import contexts (e.g., tests) can import new helpers from a single path.
- **Key internals**: New export statements referencing sidebar environment, page controls, posts list, etc.

### Sidebar composable tests *(new)*
- `page-activation-hooks.test.ts`: Ensures activation guards fire, veto prevents page switches, and hooks call sequence is correct.
- `registerSidebarPage.test.ts`: Validates registration, sorting, duplicate replacement, and cleanup.
- `registerSidebarPostList.test.ts`: Tests section registration/removal and duplication guards.
- `sidebar-interactions.test.ts`: Integration test combining environment, page controls, and multi-pane actions.
- `useSidebarEnvironment.test.ts`: Confirms adapter methods (`openDoc` sets mode/doc id, `openChat` adds pane) and data getters.
- `useSidebarPageControls.test.ts`: Verifies custom pages can read/modify page state.
- `useSidebarPages.test.ts`: Covers registry reactivity, async loader wrapping, and order sorting.

### `tests/utils/sidebar-test-helpers.ts` *(new)*
- **Function**: Shared helpers for sidebar-related tests.
- **Why**: Avoids duplicating complex mock setup across test files.
- **Key internals**: Provides `provideMockSidebarEnvironment`, `createMockMultiPaneApi`, fake data builders, and mount utilities.

---

## Projects & Posts

### `app/composables/projects/useProjectsCrud.ts` *(updated)*
- **Function**: Project CRUD utilities shared across UI/tests/plugins.
- **Why**: Added `createThreadEntry` and `createDocumentEntry` so component code doesn’t manipulate Dexie directly.
- **Key internals**:
  - `createThreadEntry(projectId)` creates a new thread (via `create.thread`), adds entry to project data, returns `{ id, name }`.
  - `createDocumentEntry(projectId)` creates document (via `create.document`), updates project entries, returns `{ id, title }`.
  - Existing methods still trim titles, run through hooks, and call `upsert.project`.

### `app/db/posts.ts` *(updated)*
- **Function**: Data layer for posts table.
- **Why**: Introduced `normalizeMeta`, trimmed titles, and hook integration to support plugin-created posts.
- **Key internals**:
  - `normalizeMeta` discards unserialisable meta, logs warning.
  - `createPost`, `upsertPost` run before/after hook actions.
  - `softDeletePost` toggles `deleted` flag and updates `updated_at`.

### `app/composables/posts/usePostsList.ts` *(new)*
- **Function**: Gathers posts by `postType` with optional limit.
- **Why**: Shared between sidebar pages and pane apps for listing post-backed records.
- **Key internals**: Dexie query sorted by `updated_at` descending, optional `limit`, JSON parsing for `meta`.

### `app/composables/posts/__tests__/usePostsList.test.ts` *(new)*
- **Function**: Tests `usePostsList`.
- **Why**: Guards against regressions when we refactor Dexie schema or switch to remote storage.
- **Key internals**: Mocks Dexie responses, asserts ordering and meta parsing.

---

## Plugin Examples & Registration

### `app/plugins/examples/custom-pane-todo-example.client.ts` *(new)*
- **Function**: Nuxt plugin registering a Todo pane and sidebar page using the new APIs.
- **Why**: Demonstrates end-to-end usage (pane app registration, sidebar page registration, posts API) for partners.
- **Key internals**:
  - Defines `TodoPaneComponent` with props (`paneId`, `recordId`, `postType`, `postApi`) and handles load/save/toggle completed.
  - Sidebar page component uses `useSidebarMultiPane` to open panes, `usePostsList` to list todos, and `useSidebarPageControls` for navigation.
  - Plugin registers both pane and sidebar page and handles errors gracefully (`Posts API unavailable`).

### `app/plugins/examples/snake/SnakeGamePane.vue` *(new)*
- **Function**: Pane component for the Snake demo.
- **Why**: Showcases reactive game state, keyboard handling, and custom UI inside the pane slot.
- **Key internals**: Renders controls, scoreboard, relies on `SnakeGame` class for logic.

### `app/plugins/examples/snake/SnakeGameSidebar.vue` *(new)*
- **Function**: Sidebar page for Snake demo.
- **Why**: Demonstrates environment usage (open pane, display stats, expose actions).
- **Key internals**: Uses `useSidebarMultiPane` to open the pane, shows instructions, tracks high score via reactive state.

### `app/plugins/examples/snake/snake-game.ts` *(new)*
- **Function**: Core Snake game logic.
- **Why**: Real-world example of a state machine driving a pane app; stress-tests reactivity.
- **Key internals**: `GameState` reactive object, `start/pause/stop`, `update` tick with collision detection, high score persistence via localStorage.

### `app/plugins/snake-game.client.ts` *(new)*
- **Function**: Registers the Snake example with pane app registry and sidebar registry.
- **Why**: Bundles the example into the workspace for demos and testing.
- **Key internals**: Calls `usePaneApps().registerPaneApp` with `createInitialRecord` stub, `registerSidebarPage` for companion page.

### `app/plugins/sidebar-home-page.client.ts` *(new)*
- **Function**: Registers the built-in “home” sidebar page in the new registry.
- **Why**: Ensures the default page exists via the same contract plugins use, so the system works even if no external plugins load.
- **Key internals**: Lazily imports `SidebarHomePage.vue`, sets `order: 100` to keep it first.

### `app/plugins/__tests__/pane-plugin-api.test.ts` *(new)*
- **Function**: Tests the plugin API wrapper.
- **Why**: Prevents regressions in the contract we expose to third parties.
- **Key internals**: Mocks Dexie/Docs functions, asserts every method returns `ok` or error codes as documented.

---

## Documentation & Tutorials

### `docs/README.md` *(new)*
- **Function**: Overview of custom pane ecosystem with links to detailed guides.
- **Why**: Gives stakeholders a single entry point; anchors other docs.

### `docs/bundle-health-report.md` *(new)*
- **Function**: Captures bundle size impact and performance measurements after the overhaul.
- **Why**: Evidence for leadership that we tracked performance and memory impacts.

### `docs/custom-pane-apps-quickstart.md` *(new)*
- **Function**: Tutorial for building a pane app + sidebar page.
- **Why**: Onboarding doc for partners; reduces support lift.

### `docs/pane-plugin-api.md` *(updated)*
- **Function**: API reference for the pane plugin bridge.
- **Why**: Added documentation for posts CRUD, `getActivePaneData`, and all error codes introduced.

### `docs/plugins/sidebar-plugin-guide.md` *(new)*
- **Function**: Deep guide for building sidebar pages and sections.
- **Why**: Explains environment helpers, guard hooks, page controls.

### `docs/testing/custom-pane-apps.md` *(new)*
- **Function**: Testing playbook for plugin authors (Vitest, mocking environment, best practices).
- **Why**: Encourages thorough testing and consistent approach across teams.

### Public documentation (new/updated)
- `public/_documentation/composables/registerSidebarPage.md`, `useActiveSidebarPage.md`, `useSidebarEnvironment.md`, `useSidebarPageControls.md`, `useSidebarPages.md`, `useSidebarSections.md`, `useMultiPane.md`: Updated auto-generated docs reflecting new signatures and patterns (e.g., `openDoc` description now accurate).
- `public/_documentation/start/mini-app-tutorial.md`, `snake-game-tutorial.md`: In-app tutorials with copy/paste snippets mirroring real examples.
- `public/_documentation/docmap.json`: Added entries for new docs so they show up in doc navigator.
- `public/_documentation/types/composables.md`: Lists the new composables for search/discovery.

---

## Config, Scripts, Planning

### `package.json` *(updated)* & `bun.lockb` *(updated binary)*
- **Function**: Project dependencies and scripts.
- **Why**: Added dependencies (`virtua`, `zod` updates, documentation tooling) required by new components/tests.
- **Key internals**: New scripts for docs/tests where applicable; lockfile ensures reproducible installs.

### `nuxt.config.ts` *(updated)*
- **Function**: Nuxt configuration.
- **Why**: Added doc routes to pre-render list, ensured PWA ignores heavy math assets, and exposed docs through Nitro.
- **Key internals**: `nitro.prerender.routes` includes `/documentation`, `pwa.workbox` patterns updated to exclude new docs from fallback.

### `planning/todo.md` *(new)*
- **Function**: Ongoing list of follow-up tasks and refactors.
- **Why**: Keeps team honest about remaining cleanup (e.g., sidebar height math you flagged).

### `planning/mentions/requirements.md` *(deleted)*
- **Function**: Old requirements doc.
- **Why**: Obsolete after the new architecture; removal avoids conflicting instructions.

---

## Other Updated Files

### `app/components/sidebar/SidebarHeader.vue`, `app/components/sidebar/SideBottomNav.vue`, `app/components/chat/ChatInputDropper.vue`, `app/components/ResizableSidebarLayout.vue` *(covered above)*.

### `app/components/sidebar/__tests__/SideNavContent.test.ts`, `app/components/sidebar/__tests__/SideNavContentCollapsed.test.ts` *(covered above)*.

### `.github/chatmodes/...`, `.llms/...`, `.windsurf/...` *(covered at top)*.

### `public/_documentation/composables/useSidebarSections.md`, `public/_documentation/composables/useMultiPane.md` *(updated)*
- **Function**: In-app documentation pages.
- **Why**: Reflect new function signatures and behaviour (e.g., `openDoc` now says “opens pane in doc mode” instead of “creates document”). Prevents docs from lying to developers.

### `public/_documentation/types/composables.md` *(updated)*
- **Function**: Type index.
- **Why**: Added entries for new composables so doc search finds them.

### `public/_documentation/docmap.json` *(updated)*
- **Function**: Documentation index consumed by in-app docs viewer.
- **Why**: Registered new docs so navigation works without manual config.

### `bun.lockb` *(already mentioned with package.json)*
- **Function**: Bun lockfile.
- **Why**: Reflects added deps; ensures builds are deterministic.

---

## Cross-cutting Design Decisions

1. **Registries with strict validation** – Every plugin registers through `usePaneApps` or `useSidebarPages`, both guard input via Zod. That prevents malformed plugins from breaking the workspace mid-session.
2. **Provide/inject environment** – Sidebar pages receive a curated API (`SidebarEnvironment`) instead of ad hoc props. This keeps the shell in charge of data fetching and lets plugins stay pure.
3. **Lazy loading + caching** – Pane components and sidebar pages load only when needed (`defineAsyncComponent`, cached imports), trimming the initial bundle and avoiding repeated dynamic imports.
4. **Centralized Dexie mutations** – Helpers in `useProjectsCrud` and posts composables encapsulate DB writes so UIs remain declarative. It’s easier to audit DB changes and adapt if we switch storage.
5. **Global APIs typed** – `types/global.d.ts` documents intentional globals, keeping TypeScript strict and plugin code accurate.
6. **Documentation everywhere** – Every new API ships with matching docs/tutorials (external docs + in-app). That reduces learning curve and clarifies the contract for partners.
7. **Examples that stress the system** – Todo (CRUD heavy) and Snake (state heavy) prove the architecture handles real workloads, not just demos.
8. **Testing seams** – Extensive unit tests plus reusable helpers (`tests/utils/sidebar-test-helpers.ts`) ensure we can refactor without shaking confidence.

This is the complete picture. If a file exists in this branch, the justification is above.
