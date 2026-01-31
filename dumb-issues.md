# dumb-issues.md

A ruthless workspace-focused review, because apparently we enjoy pain.

---

## 1) Congratulations, you cached auth session state

**Where**: server/api/auth/session.get.ts (roughly lines 33–41 *before* fix)

**Snippet** (what it was doing):

```ts
// Cache authenticated sessions for 60s
setResponseHeader(event, 'Cache-Control', 'private, max-age=60');
```

**Why this is bad**

- This endpoint defines the *current workspace* and auth context.
- Caching it (even “private”) means the browser can legally reuse a stale workspace for up to 60s.
- Any “switch workspace” flow that relies on reloading or refreshing `/api/auth/session` can randomly “switch” and then come right back with the old workspace.

**Real-world consequences**

- “Sometimes it loads the wrong workspace” (yes, exactly).
- “It says it switched, but content is the same” (also yes).
- Debugging becomes impossible because timing determines correctness.

**Fix**

- Session endpoints should be `Cache-Control: no-store`.
- Implemented in server/api/auth/session.get.ts.

---

## 2) Workspace switching without forcing a session refresh is wishful thinking

**Where**: app/plugins/workspaces/WorkspaceManager.vue (roughly lines 430–505 *before* fix)

**Snippet** (pattern):

```ts
await setActiveWorkspaceMutation.mutate({ workspace_id: workspace._id });
reloadNuxtApp({ ttl: 500 });
```

**Why this is bad**

- You mutate “active workspace” in Convex, then immediately reload the app.
- The app reload resolves workspace via `/api/auth/session`.
- If the session context hasn’t updated yet (or worse, was cached), you just reloaded into the old workspace.

**Real-world consequences**

- User sees a success toast, then nothing changes.
- Intermittent failures depending on timing/network.

**Fix**

- Refresh `/api/auth/session` until it reports the new `workspace.id`, then reload.
- Implemented via `refreshSessionUntilWorkspace()` in app/plugins/workspaces/WorkspaceManager.vue.

---

## 3) Client-side session refresh that doesn’t disable caching: classic self-own

**Where**: app/composables/auth/useSessionContext.ts (refresh() function)

**Snippet** (what it was doing):

```ts
const fetchPromise = $fetch<SessionPayload>('/api/auth/session');
```

**Why this is bad**

- If the server responds with cacheable headers, fetch can and will return cached data.
- Even after fixing server headers, explicitly requesting `cache: 'no-store'` is the sane belt-and-suspenders approach for session fetches.

**Real-world consequences**

- Stale `workspace.id` after a switch.
- “Wrong workspace on load” when the last session response is reused.

**Fix**

```ts
$fetch('/api/auth/session', { cache: 'no-store' })
```

Implemented in app/composables/auth/useSessionContext.ts.

---

## 4) Two different plugins fighting over “active workspace DB” is not architecture

**Where**:

- app/plugins/00-workspace-db.client.ts
- app/plugins/convex-sync.client.ts

**What’s happening**

- Both plugins call `setActiveWorkspaceDb(workspaceId)` off session state.
- One plugin also special-cases admin routes and forces `setActiveWorkspaceDb(null)`.

**Why this is bad**

- You now have *multiple sources of truth* for “what DB is active”.
- Ordering/timing differences can produce transient wrong DB bindings.
- That’s how you get “sometimes wrong workspace on load” in addition to caching.

**Real-world consequences**

- Hard-to-reproduce, racey bugs.
- Random stale reads when composables initialize during the wrong “active DB” moment.

**Fix (suggested)**

- Pick ONE place to control `setActiveWorkspaceDb()` (ideally the earliest plugin) and have everything else read the resolved workspaceId.
- If you must special-case admin, do it in a single gate.

---

## 5) `reloadNuxtApp()` as a state management strategy is… a choice

**Where**: app/plugins/workspaces/WorkspaceManager.vue

**Why this is bad**

- Reloading the entire app to switch workspace is expensive and masks deeper problems (stale table refs, provider engines not being properly scope-aware).
- It also makes UX feel flaky: it’s basically a soft refresh disguised as a button.

**Real-world consequences**

- Lost ephemeral UI state.
- More opportunities for race conditions during bootstrap.

**Fix (suggested)**

- Long-term: make workspaceId a reactive “scope” and ensure DB access is always via `getDb()`/fresh table lookups.
- Short-term: if reload is required, at least ensure session workspace is fresh first (implemented).

---

## 6) Exporting a mutable `db` and then warning people not to use it

**Where**: app/db/client.ts

**Snippet**:

```ts
/** @deprecated Use getDb() instead ... */
export let db = defaultDb;
```

**Why this is bad**

- Deprecation comments don’t stop anyone.
- A lot of code will inevitably do `const table = db.messages` and then you’ve pinned a stale table instance across workspace switches.

**Real-world consequences**

- “Switched workspace but content looks the same” when something cached table refs.

**Fix (suggested)**

- Remove the `db` export and force `getDb()` usage (or provide `useDb()` composable returning a computed).
- If removing is too disruptive, at least grep & eliminate `const { ... } = db` patterns.

---

## 7) “Import local data” copies tables with `any` and no workspace safety

**Where**: app/plugins/workspaces/WorkspaceManager.vue (importLocalData)

**Snippet**:

```ts
const sourceRows = await (baseDb as any).table(tableName).toArray();
await (targetDb as any).table(tableName).bulkPut(sourceRows);
```

**Why this is bad**

- `any` nukes schema guarantees.
- No filtering/rewriting of workspace-scoped rows (if any tables ever add `workspace_id`, congrats, you just cross-polluted data).
- No transaction wrapper: partial imports are possible.

**Real-world consequences**

- Silent data corruption when schemas evolve.
- Hard-to-debug “why is this thread in the wrong workspace?” moments.

**Fix (suggested)**

- Wrap in Dexie transaction.
- Explicitly type per-table and handle `workspace_id` fields if present.

---

## 8) Session endpoint rate limiting is fine, but don’t break core UX for it

**Where**: server/api/auth/session.get.ts

**Why this is bad (as implemented previously)**

- Rate limiting is good.
- Caching sessions for 60s to “reduce load” was the wrong lever: it trades correctness for slightly fewer requests.

**Real-world consequences**

- Users can’t trust workspace switching.

**Fix**

- Keep rate limiting, remove caching (implemented).

---

# Task list

- [x] Remove caching from `/api/auth/session` response headers (must be `no-store`).
- [x] Force client session fetches to bypass caches (`cache: 'no-store'`).
- [x] Make workspace switching wait until session reflects the selected workspace before reload.
- [x] Add a regression test to lock the session cache policy.

- [ ] Unify ownership of `setActiveWorkspaceDb()` (stop multiple plugins from fighting over the active DB).
- [ ] Audit and eliminate stale Dexie table references caused by importing `db` directly (replace with `getDb()` usage end-to-end).
- [ ] Reduce or remove `reloadNuxtApp()` dependence for workspace switching (make scope changes reactive + restart sync engines cleanly).
- [ ] Harden “Import local data”: wrap in a Dexie transaction, remove `any`, and add workspace-safety rules for future `workspace_id` fields.
- [ ] Add an integration test that simulates switching workspaces and verifies visible data actually changes (catches “toast says switched, content didn’t”).

