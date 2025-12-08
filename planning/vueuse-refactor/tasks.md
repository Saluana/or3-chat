---
artifact_id: 1d55cefc-20dc-44f5-9b2d-9f6b7b2552d5
title: VueUse & Nuxt Adoption Tasks
owner: frontend
status: draft
---

[x] 1. Debounce/Throttle swaps (Req: 2, 8)
[x] 1.1 Replace manual timers with `watchDebounced`/`useDebounceFn` in `app/composables/sidebar/useSidebarSearch.ts`; keep delays/constants.
[x] 1.2 Swap query debounce in `app/composables/threads/useThreadSearch.ts` to `watchDebounced`.
[x] 1.3 Replace save debounce in `app/composables/documents/useDocumentsStore.ts` with `useDebounceFn`; remove timer from state.
[x] 1.4 Update `app/components/documents/SearchPanelRoot.vue` to use `useDebounceFn`; drop manual cleanup.
[x] 1.5 Update delayed commits in `app/components/dashboard/ThemePage.vue` with `useDebounceFn` for sliders/settings.
[x] 1.6 Replace prompt save debounce in `app/components/prompts/PromptEditor.vue` with `useDebounceFn`; verify autosave timing.

[x] 2. Scroll lock composable (Req: 3, 8)
[x] 2.1 Refactor `app/composables/core/useScrollLock.ts` to wrap VueUse `useScrollLock`, keeping `lock/unlock/isLocked` API.
[x] 2.2 Add tests to ensure body overflow restored on dispose and parity with previous behavior.

[x] 3. Clipboard & file flows (Req: 4, 8)
[x] 3.1 Replace copy handlers in `app/components/chat/ChatMessage.vue` with `useClipboard`; keep UI state/notifications.
[x] 3.2 Replace copy handlers in `app/components/chat/WorkflowChatMessage.vue` with `useClipboard`.
[x] 3.3 Swap theme copy action in `app/components/dashboard/ThemePage.vue` to `useClipboard`.
[x] 3.4 Refactor `app/components/chat/ChatInputDropper.vue` file input to `useFileDialog` (and `useDropZone` if drop used); preserve validation and last-model cache hook.

[x] 4. Persisted state via VueUse storage + Nuxt singleton (Req: 1, 8)
[x] 4.1 `app/composables/chat/useAiSettings.ts`: use `useLocalStorage` wrapped in Nuxt `useState`; keep keys/defaults.
[x] 4.2 `app/composables/core/useMultiPane.ts`: store pane widths with `useLocalStorage`; ensure SSR guard removed safely.
[x] 4.3 `app/composables/sidebar/useActiveSidebarPage.ts`: swap to `useLocalStorage` + `useState` for shared page state.
[~] 4.4 `app/components/ResizableSidebarLayout.vue`: *(skipped - uses dynamic prop-based storageKey, manual localStorage appropriate)*
[x] 4.5 `app/components/chat/ChatInputDropper.vue`: switch last model cache to `useLocalStorage` and shared state if needed.

[ ] 5. Responsive breakpoints (Req: 5, 8)
[ ] 5.1 Introduce shared breakpoint helper (e.g., `app/composables/core/useBreakpointsShared.ts`) using `useBreakpoints` with current values.
[ ] 5.2 Refactor `app/composables/core/useResponsiveState.ts` to consume shared helper and remove matchMedia listeners.
[ ] 5.3 Update `app/components/ResizableSidebarLayout.vue` to use shared breakpoint refs; drop global sync flags.

[ ] 6. Event/observer management (Req: 6, 8)
[x] 6.1 Replace resize/window listeners in `app/components/sidebar/SideBar.vue` with `useEventListener`/`useResizeObserver`.
[x] 6.2 Update `app/components/ResizableSidebarLayout.vue` to VueUse observers/listeners; verify pane drag/resize parity.
[x] 6.3 Swap `PageShell.vue` pointer/keydown/mutation observers to VueUse helpers; ensure cleanup on route change.
[x] 6.4 Replace MutationObserver in `app/components/DocumentationShell.vue` with `useMutationObserver`.
[x] 6.5 Update `app/components/chat/ChatInputDropper.vue` ResizeObserver to `useResizeObserver`.

[ ] 7. Data fetching via Nuxt composables (Req: 7, 8)
[ ] 7.1 Move doc map/markdown fetches in `app/components/DocumentationShell.vue` to `useFetch`/`useAsyncData` with SSR-safe options.
[ ] 7.2 Update `app/components/ui/HelpChat.vue` to `useFetch`/`useAsyncData`; keep lazy/interactive behavior.
[ ] 7.3 Refactor asset fetches in `app/composables/chat/useAi.ts` to Nuxt fetch composables with same endpoints and parsing.

[ ] 8. Testing & verification (Req: 1-8)
[ ] 8.1 Add/adjust unit tests for storage, debounce, scroll lock, and breakpoint helpers (mock timers/matchMedia).
[ ] 8.2 Add integration tests for clipboard/file flows and observer cleanup (Vue Test Utils).
[ ] 8.3 Extend Playwright scenarios for search debounce, copy buttons, file dropper, and documentation fetch SSR/client nav.
[ ] 8.4 Perf check: measure search debounce path and fetch timings pre/post change; ensure no slowdown.
[ ] 8.5 Regression sweep on mobile/desktop layouts to confirm breakpoints and pane resizing unchanged.
