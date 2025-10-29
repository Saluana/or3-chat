artifact_id: 9d6c6383-2bfd-477d-b3f2-5ace575c866e
content_type: text/markdown

# tasks.md

1. Types & Plumbing

-   [ ] Introduce `PaneMode` type in `useMultiPane.ts` and update `PaneState` / exports; adjust `hook-types.ts`, public docs, and any unions referencing `'chat' | 'doc'`.
-   [ ] Verify existing tests/fixtures compile with widened type (update stubs where necessary).

2. Pane App Registry

-   [ ] Create `app/composables/core/usePaneApps.ts` with register/get/list helpers, global Map storage, and order-aware computed list.
-   [ ] Expose types (`PaneAppDef`, `RegisteredPaneApp`) via barrel `app/composables/core/index.ts` if one exists.
-   [ ] Add Vitest coverage for registry behaviour (register, overwrite, list sorting).

3. Multi-pane Enhancements

-   [ ] Extend `useMultiPane` return value with `newPaneForApp`; wire into global `__or3MultiPaneApi`.
-   [ ] Implement `newPaneForApp` flow: guard `canAddPane`, resolve def, call optional `createInitialRecord`, assign `documentId`, push pane, set active, emit existing hooks.
-   [ ] Add unit tests covering success, missing app, pane limit, and failed `createInitialRecord`.

4. PageShell Rendering

-   [ ] Replace template branching with resolver-based `<component>` call; ensure built-in panes receive identical props.
-   [ ] Implement fallback stub component for unknown modes; include light styling consistent with existing panes.
-   [ ] Update route-sync logic (if any) to skip custom modes gracefully.

5. Pane Plugin API

-   [ ] Extend `pane-plugin-api.client.ts` to expose `posts.create/update/listByType`, reusing `create.post` / `upsert.post` and parsing `meta`.
-   [ ] Include `recordId` for non-doc panes in `getActivePaneData` and `getPanes` descriptors (alias current `documentId`).
-   [ ] Document new namespace in `docs/pane-plugin-api.md` with short usage snippets.

6. Posts Utilities

-   [ ] Implement `usePostsList(postType, opts?)` composable with Dexie `liveQuery` subscription, soft-delete filtering, and updated-order sorting.
-   [ ] Write unit tests with mocked Dexie to ensure filtering/sorting correctness.

7. Sidebar DX Helper

-   [ ] Add `registerSidebarPostList` helper that builds an inline Vue component (lazy) wrapping `usePostsList` and `registerSidebarSection`.
-   [ ] Ensure click handler opens panes via `newPaneForApp`; consider reusing active pane when same record already open.
-   [ ] Provide optional params (placement/order/icon/emptyState) and add documentation entry under sidebar plugin docs.

8. Dev Story & Examples

-   [ ] Create an example plugin under `examples/` or update existing sample to register a simple pane app + sidebar list using new APIs.
-   [ ] Add short README snippet referencing required plugin boilerplate (Nuxt plugin auto-registration).

9. Tests & QA

-   [ ] Update multi-pane and pane plugin API test suites to cover new flows.
-   [ ] Add regression test verifying chat/doc panes unaffected (open/close still works).
-   [ ] Exercise posts CRUD through the new API to confirm hooks fire (may use spying on `db.posts`).

10. Polishing

-   [ ] Add dev console warnings when `newPaneForApp` invoked with unknown id or `createInitialRecord` rejects.
-   [ ] Ensure all new helpers guard `process.client` and fail gracefully during SSR.
-   [ ] Verify tree-shakability: avoid exporting heavy helpers from server bundles.
