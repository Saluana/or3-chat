# Composables Neckbead Review

Scope reviewed: composables under `app/composables/**` and plugin composables under `app/plugins/**/composables/**`.

## [P0] Invalid ESM import placement breaks admin composable parsing
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/admin/useAdminExtensions.ts:97`

**Why this is bad:** The module puts `import { parseErrorMessage } ...` after executable statements. ESM requires imports to be top-level before runtime code.

**Consequence:** The file becomes syntactically invalid. Admin composables can fail to bundle/run.

**Fix:** Move the `parseErrorMessage` import into the top import block.

---

## [P1] Document flush drops valid falsy edits
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/documents/useDocumentsStore.ts:64-101`

**Why this is bad:** `if (!st.pendingTitle && !st.pendingContent) return` treats empty string/null edits as "no change".

**Consequence:** Clearing title/content silently fails to persist.

**Fix:** Only skip when both are `undefined`.

```ts
if (st.pendingTitle === undefined && st.pendingContent === undefined) return;
```

---

## [P1] Stale model fallback never hydrates reactive catalog
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/chat/useModelStore.ts:223-274`

**Why this is bad:** On network failure, stale models are returned without updating `catalog.value` / `lastLoadedAt`.

**Consequence:** UI still shows empty model list while stale data exists; repeated cold fetch behavior continues.

**Fix:** Assign stale fallback into reactive state before returning.

---

## [P1] Notification mute preferences are global, not per-user
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/notifications/useNotifications.ts:342-355`

**Why this is bad:** Mute data is persisted under one shared KV key (`notification_muted_threads`) in a shared workspace DB.

**Consequence:** One user mutes a thread and everyone else in that workspace loses notifications for it.

**Fix:** Namespace mute keys by resolved user ID (for reads and writes).

---

## [P1] Posts list materializes full dataset before limiting
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/posts/usePostsList.ts:60-78`

**Why this is bad:** `sortBy(...).reverse().slice(...)` runs after pulling all matching rows into memory.

**Consequence:** Large workspaces pay unnecessary memory/CPU cost on every update.

**Fix:** Use indexed ordering + `.limit(...)` before `toArray()`.

---

## [P1] Sidebar pagination composable ignores query ref changes
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/sidebar/usePaginatedSidebarItems.ts:99-205`

**Why this is bad:** The Dexie subscription is not restarted when `options.query` changes.

**Consequence:** Search input changes do not actually filter results.

**Fix:** Watch `options.query` and restart subscription/reload data when it updates.

---

## [P1] Thread index updates are dropped during active Orama rebuild
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/threads/useThreadSearch.ts:34-151`

**Why this is bad:** `ensureIndex` bails when `busy` is true and does not queue a rerun.

**Consequence:** Thread mutations during rebuild can be permanently missing from search until another mutation happens.

**Fix:** Add a dirty flag and rerun once current rebuild completes.

---

## [P1] Workflow storage composable instantiates browser-only adapters unguarded
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/plugins/workflows/composables/useWorkflowStorage.ts:6-15`

**Why this is bad:** `LocalStorageAdapter` is created immediately and throws when `localStorage` is unavailable.

**Consequence:** SSR/test/import paths can crash on module execution.

**Fix:** Guard adapter creation with client-only checks or inject storage adapters.

---

## [P1] Task due dates cannot be cleared once set
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/plugins/tasks/composables/useTaskListService.ts:168-194`

**Why this is bad:** `patch.due_at ?? task.due_at` treats `null` (explicit clear) as fallback to previous value.

**Consequence:** Clearing a due date in UI is ignored.

**Fix:** Fall back only when `patch.due_at === undefined`, not when it is `null`.

---

## [P2] Workflow accumulator reset leaks token counts across runs
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/chat/useWorkflowStreamAccumulator.ts:1138-1170`

**Why this is bad:** `reset()` does not reset module-scoped `totalTokens`.

**Consequence:** Token usage metrics inflate across reruns.

**Fix:** Set `totalTokens = 0` during reset.

---

## [P2] Session bootstrap refresh can emit unhandled promise rejections
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/auth/useSessionContext.ts:99-101`

**Why this is bad:** Initial `void refresh()` path does not catch errors while `refresh()` rethrows fetch failures.

**Consequence:** Console spam and unhandled-rejection hooks trigger on transient auth/network failures.

**Fix:** Catch bootstrap call errors.

```ts
void refresh().catch(() => undefined);
```

---

## [P2] Telemetry listener exceptions can break lazy boundary loading
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/core/useLazyBoundaries.ts:53-63`

**Why this is bad:** Telemetry listener loop is unguarded; one thrown error bubbles out.

**Consequence:** Lazy-loaded features can fail because diagnostics code threw.

**Fix:** Wrap each listener call in `try/catch` and isolate failures.

---

## [P2] StreamSaver MITM URL ignores Nuxt baseURL
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/core/useWorkspaceBackup.ts:318-330`

**Why this is bad:** URL is composed from `window.location.origin` and misses subpath deployments.

**Consequence:** StreamSaver MITM page 404s under non-root base paths; exports fail.

**Fix:** Compose URL with runtime `app.baseURL`.

---

## [P2] Editor registry list access mutates shared internal arrays
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/editor/useEditorNodes.ts:268-334`

**Why this is bad:** `listEditor*` sorts in place and returns the mutable registry array reference.

**Consequence:** Consumers can accidentally mutate global registry ordering/state.

**Fix:** Return sorted copies (`[...items].sort(...)`) as readonly arrays.

---

## [P2] Project entry sync ignores the `kind` parameter
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/projects/useProjectsCrud.ts:128-170`

**Why this is bad:** Update path keeps `entry.kind` and never applies provided `kind`.

**Consequence:** Legacy entries can remain mislabeled (doc treated as chat) after sync updates.

**Fix:** Apply passed-in `kind` for matching entry updates (or when stored kind is missing/invalid).

---

## [P2] Sidebar search debounce timer survives composable cleanup
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/sidebar/useSidebarSearch.ts:330-374`

**Why this is bad:** Debounced rebuild function is not canceled on unmount/HMR dispose.

**Consequence:** Orama rebuilds can continue after teardown, causing avoidable CPU churn and stale mutations.

**Fix:** Call `debouncedRebuild.cancel()` in cleanup paths.

---

## [P2] Thread search query token is shared across composable instances
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/threads/useThreadSearch.ts:23-145`

**Why this is bad:** Module-level `lastQueryToken` allows one instance to cancel another instance’s in-flight query.

**Consequence:** Multi-consumer usage can produce missing/incorrect search results.

**Fix:** Make query token instance-scoped inside `useThreadSearch`.

---

## [P2] Muted-thread live query is created twice and leaks subscriptions
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/notifications/useNotifications.ts:283-319`

**Why this is bad:** Subscription setup happens both in `syncUserId()` and again unconditionally afterward.

**Consequence:** Orphaned Dexie subscriptions accumulate and continue mutating state.

**Fix:** Remove duplicate startup call or guard with `if (!mutedThreadsSubscription)`.

---

## [P2] Workspace manager logs sensitive-ish IDs in production hot path
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/workspace/useWorkspaceManager.ts:76-105`

**Why this is bad:** Unconditional `console.log` emits workspace IDs on every activation/clear.

**Consequence:** Noise in production logs and avoidable data exposure/debug overhead.

**Fix:** Remove logs or guard with `import.meta.dev`.

---

## [P2] Theme migration keeps legacy localStorage key forever
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/useThemeSelection.ts:24-35`

**Why this is bad:** Migration reads legacy key but never removes it.

**Consequence:** Cross-workspace theme contamination and repeated migration behavior.

**Fix:** Remove legacy key after successful migration read/write.

---

## [P2] Theme migration write is fire-and-forget and can reject unhandled
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/useThemeSelection.ts:60-67`

**Why this is bad:** `void setKvByName(...)` bypasses surrounding error handling.

**Consequence:** Silent persistence failure + unhandled rejection risk.

**Fix:** `await setKvByName(...)` (or catch explicitly) in migration path.

---

## [P3] Pane prompt cleanup hook leaks across HMR cycles
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/core/usePanePrompt.ts:36-53`

**Why this is bad:** Hook is added and HMR only flips a boolean; previous handler is not removed.

**Consequence:** Duplicate handlers and stale closures accumulate during dev.

**Fix:** Register with a removable handler and explicitly unregister on HMR dispose.

---

## [P3] Null-session workspace clear predicate duplicated in two files
**Location:** `/Users/brendon/Documents/or3/or3-chat/app/composables/workspace/useWorkspaceManager.ts:27-46`

**Why this is bad:** Same logic is duplicated in `useWorkspaceManagerSession.ts`.

**Consequence:** Drift risk for auth-clearing behavior and future regressions.

**Fix:** Extract shared helper and reuse from one source.

---

## Categories with no findings in this pass
- `app/composables/dashboard/*`
- `app/composables/plugins/workspace-runtime.ts`
