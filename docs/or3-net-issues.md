# OR3 Network Integration — Bugs, Performance Issues & Code Quality Concerns

> This document captures potential bugs, performance issues, and code quality concerns found during review of the or3-net integration in or3-chat. Items are grouped by severity.
>
> **References:** `app/composables/or3-net/`, `server/api/or3-net/`, `server/utils/or3-net/`, `app/components/dashboard/or3-net/`, `app/plugins/or3-network.client.ts`

---

## Table of Contents

1. [Security Issues](#1-security-issues)
2. [Potential Bugs](#2-potential-bugs)
3. [Performance Issues](#3-performance-issues)
4. [Code Quality & Maintainability](#4-code-quality--maintainability)
5. [Missing Functionality / UX Gaps](#5-missing-functionality--ux-gaps)

---

## 1. Security Issues

### 1.1 Same-origin check silently passes when `Origin`/`Referer` headers are absent

**File:** `server/api/or3-net/exchange.post.ts` — `enforceSameOriginMutation()`

**Issue:** If neither the `origin` nor `referer` request header is present, the function returns early without throwing. This means cross-site requests that strip these headers (e.g. curl, custom HTTP clients, or same-site-lax cookies in certain configurations) bypass the same-origin check entirely.

```ts
function enforceSameOriginMutation(event: H3Event): void {
    const originHeader =
        getRequestHeader(event, 'origin') ?? getRequestHeader(event, 'referer');

    if (!originHeader) {
        return; // ← silently passes if headers are absent
    }
    // ...
}
```

**Impact:** The endpoint is still protected by session auth and rate limiting, but CSRF protection via origin matching is ineffective without the header.

**Suggestion:** Consider requiring the `Origin` header to be present for this mutation endpoint, or add CSRF token validation as a stronger alternative.

---

### 1.2 HMAC-SHA256 shared secret — no key rotation mechanism

**File:** `server/utils/or3-net/assertion.ts`, `server/utils/or3-net/config.ts`

**Issue:** The session proof uses a single shared HMAC secret (`OR3_NET_EXCHANGE_SECRET`) with no rotation or key-ID mechanism. If the secret leaks:
- All existing session proofs become forgeable.
- There is no way to distinguish new proofs from forged ones without changing the secret (which invalidates all in-flight proofs simultaneously).

**Suggestion:** Consider adding a `kid` (key ID) field to the assertion payload, even if only one key is supported today. This makes future rotation possible without breaking backward compatibility.

---

### 1.3 Token expiry window is narrow under load

**File:** `app/composables/or3-net/useOr3NetAuth.ts` — `hasFreshPayload()`

**Issue:** The client considers a token "fresh" only if it expires more than 5 seconds from now. The server default TTL is 60 seconds. Under high latency or when the exchange endpoint is slow, a token could expire before a follow-up request completes — resulting in a spurious `401` that triggers an extra round-trip.

```ts
return expiresAtMs - Date.now() > 5_000;
```

**Suggestion:** Increase the buffer (e.g. to 15–30 seconds) or derive it proportionally from the token TTL.

---

## 2. Potential Bugs

### 2.1 Module-level singletons break in multi-instance or hot-reload scenarios

**Files:**
- `app/composables/or3-net/useOr3NetAuth.ts`
- `app/composables/or3-net/useOr3NetSession.ts`

**Issue:** Both composables use module-level reactive state and install watchers protected by a `boolean` flag (`workspaceWatcherInstalled`, `invalidationWatcherInstalled`). In Vite hot-module replacement (HMR) during development, the module is re-executed but these guards prevent the watcher from reinstalling, leaving the new module instance without workspace change detection.

```ts
let workspaceWatcherInstalled = false;

function installWorkspaceWatcher(): void {
    if (workspaceWatcherInstalled || import.meta.server) {
        return;  // ← HMR resets the module but this check doesn't reinstall the watcher
    }
    workspaceWatcherInstalled = true;
    // ...
}
```

**Impact:** During development, workspace switch invalidation may silently stop working after a hot reload until the page is fully refreshed.

**Suggestion:** This is a known trade-off with module-level singletons in Nuxt composables. Consider using Nuxt's `useState` or a Pinia store for reactive singleton state, which survives HMR correctly.

---

### 2.2 Race condition: workspace switches during an in-flight exchange

**File:** `app/composables/or3-net/useOr3NetAuth.ts`

**Issue:** If the user switches workspaces while an exchange request is in flight, the `activeWorkspaceId` watch fires and calls `invalidateState()` (setting `payload.value = null` and `boundWorkspaceId.value = null`). However, the in-flight promise still holds a reference to `requestKey` (the old workspace ID) and will write to `payload.value` if the request resolves before the workspace state settles.

```ts
.then((response) => {
    if (activeWorkspaceId.value !== requestKey) {
        return null;  // ← discards the result, but ...
    }
    payload.value = response;             // ← only reached if workspace matches
    boundWorkspaceId.value = response.workspace_id;
    return response;
})
```

The guard `if (activeWorkspaceId.value !== requestKey)` does discard the result, so the write is prevented. However, `pending.value` accounting via `pendingExchangeCount` can desync: if `invalidateState()` runs and then the in-flight promise's `finally` block fires, `finishPendingExchange()` decrements the counter — but `startPendingExchange()` was called for a workspace that no longer exists. Under rapid workspace switching this could leave `pending.value` stuck at `true` temporarily.

**Suggestion:** Reset `pendingExchangeCount` to `0` in `invalidateState()`.

---

### 2.3 `useOr3NetSession` watcher depends on `activeClientSessionId` — but only installs once

**File:** `app/composables/or3-net/useOr3NetSession.ts`

**Issue:** `installInvalidationWatcher` is called on every `useOr3NetSession()` invocation but is protected by `invalidationWatcherInstalled`. The watcher captures `workspaceId` and `clientSessionId` WatchSources passed at installation time. If a later caller passes different sources (e.g. a different component that derives `clientSessionId` differently), those sources are ignored.

In practice there is only one canonical derivation of `activeClientSessionId`, but this is a fragile design assumption that could break if a second call site is ever added.

---

### 2.4 `useOr3NetPresets` does not detect workspace DB change on initial load

**File:** `app/composables/or3-net/useOr3NetPresets.ts`

**Issue:** The DB-change detection compares `getDb().name` at the start of `loadPresets()`. However, `_loadPromise` is cached after the first call. If `loadPresets()` is called twice in rapid succession while a workspace switch is in progress, the second call may skip the stale check and return the `_loadPromise` from the old DB:

```ts
if (_loadPromise && _loadedDbName === dbName) {
    return _loadPromise;  // ← returns old DB's load promise if DB hasn't changed yet
}
```

**Impact:** Presets from a previous workspace could briefly appear in the new workspace's UI after a workspace switch if the DB name updates lazily.

---

### 2.5 `useOr3NetJobStream` — `parseAndApplyFrame` uses naive `\n\n` splitting

**File:** `app/composables/or3-net/useOr3NetJobStream.ts`

**Issue:** SSE frames are split on `\n\n`. The SSE specification allows multi-line `data:` values with individual `data:` prefixes per line. The current parser joins data lines with `\n` before JSON-parsing, which is correct. However, if the server emits `\r\n` line endings within a frame (before the final `\r\n\r\n` separator), the inner line splitting may include `\r` in field values.

The decoder normalization (`replace(/\r\n/g, '\n')`) is applied to the full stream buffer, so this should be handled. But if the server mixes line endings within a single chunk boundary, there could be edge-case malformed frames.

**Impact:** Low — most SSE implementations use consistent line endings. But worth a note for interoperability.

---

### 2.6 `useOr3NetJobStream` — event log cap creates new array on every event

**File:** `app/composables/or3-net/useOr3NetJobStream.ts` — `recordEvent()`

**Issue:** Every event triggers a new array allocation:

```ts
function recordEvent(event: Or3NetJobStreamEvent): void {
    events.value = [...events.value, event].slice(-100);
}
```

For jobs with many `text.delta` events (streaming LLM output), this creates O(n) allocations where n ≤ 100 but still generates garbage-collection pressure on every chunk.

**Suggestion:**
```ts
function recordEvent(event: Or3NetJobStreamEvent): void {
    const next = events.value.length >= 100
        ? [...events.value.slice(1), event]
        : [...events.value, event];
    events.value = next;
}
```
Or use a circular buffer instead of a reactive array for the event log.

---

### 2.7 Reconnect has no exponential backoff

**File:** `app/composables/or3-net/useOr3NetJobStream.ts`

**Issue:** On stream error or dropped connection, the composable always reconnects after a fixed 500ms delay:

```ts
const RECONNECT_DELAY_MS = 500;
```

If the `or3-net` server is temporarily unavailable or the job endpoint returns repeated errors, this creates a tight reconnection loop (2 requests/second). There is no backoff, jitter, or maximum retry count.

**Impact:** Under server load, many clients reconnecting at 500ms intervals could amplify the outage.

**Suggestion:** Implement exponential backoff with jitter (e.g. starting at 500ms, capping at 30s, with ±20% jitter).

---

### 2.8 `useOr3NetClient.request` calls `useRuntimeConfig` on every call

**File:** `app/composables/or3-net/useOr3NetClient.ts`

**Issue:** `useOr3NetClient` calls `useRuntimeConfig()` at the composable factory level (each time `useOr3NetClient()` is called). Nuxt's `useRuntimeConfig` is designed to be called at setup time, not inside factories called repeatedly. While this currently works, it could cause reactivity warnings or unexpected behavior in future Nuxt versions.

Similarly, `useOr3NetAuth.ts` calls `useRuntimeConfig()` inside the async `exchangeToken()` function:

```ts
async function exchangeToken(force = false): Promise<…> {
    const runtimeConfig = useRuntimeConfig() as { ... };  // ← called inside async fn
```

**Suggestion:** Call `useRuntimeConfig()` once at module load time and cache the result.

---

## 3. Performance Issues

### 3.1 `Or3NetworkPage.vue` makes serial `listNodeServices` calls

**File:** `app/components/dashboard/or3-net/Or3NetworkPage.vue` — `refreshNodes()`

**Issue:** The node refresh function fetches services for every node with `await` inside a `map` using `Promise.all`, which is correct and parallel. However, this is only efficient if there are few nodes. For workspaces with many nodes, this issues N parallel requests simultaneously with no concurrency limit, which could overwhelm the server or browser connection pool.

```ts
const servicesEntries = await Promise.all(
    response.items.map(async (node) => {
        const services = await client.listNodeServices(...);
        return [node.manifest.node_id, services.items] as const;
    })
);
```

**Suggestion:** Add a concurrency limit (e.g. `p-limit(5)`) or batch the requests.

---

### 3.2 `Or3NetworkPage.vue` is a single 1600-line component

**File:** `app/components/dashboard/or3-net/Or3NetworkPage.vue`

**Issue:** The dashboard page is a monolithic ~1600-line component handling agents, presets, job submission, job streaming, nodes, services, and previews in one file. This has several performance and maintainability implications:

- The entire component tree re-renders when any reactive state changes (e.g. a single `text.delta` event updating `content.value` can trigger recalculations in unrelated sections).
- Bundle size: even with lazy importing, all sections are always loaded together.
- Template complexity makes it harder to apply `v-memo` or fine-grained `computed` memoization.

**Suggestion:** Extract sections into child components (`AgentsSection.vue`, `JobsSection.vue`, `NodesSection.vue`, `PreviewsSection.vue`) so Vue can avoid re-rendering unrelated sections.

---

### 3.3 `content.value += event.data.text` in `useOr3NetJobStream` is reactive on every delta

**File:** `app/composables/or3-net/useOr3NetJobStream.ts`

**Issue:** `content` is a Vue `ref<string>`. Every `text.delta` event calls `content.value += event.data.text`, triggering a reactive update. For LLM streaming with many small tokens (50–200 tokens/second), this fires Vue's reactivity system at token-rate, which can cause visible jank if the component re-renders on every update.

**Suggestion:** Batch updates using `requestAnimationFrame` or a short debounce (e.g. 16ms) for the content ref, while still processing events immediately internally.

---

### 3.4 `useOr3NetPresets.ts` parses and sorts on every `persistPresets` call

**File:** `app/composables/or3-net/useOr3NetPresets.ts`

**Issue:** `savePreset` calls `persistPresets(next)` which calls `JSON.stringify(nextPresets)`. For workspaces with many presets, this serializes the entire list on every save. `sanitizePresetList` also calls `Array.from(byName.values()).sort(...)` on load, creating a new sorted array from scratch.

**Impact:** Low for typical preset counts (≤20), but worth noting if presets grow.

---

## 4. Code Quality & Maintainability

### 4.1 `useOr3NetPreviewPaneState` uses `globalThis` pollution

**File:** `app/composables/or3-net/useOr3NetPreviewPaneState.ts`

**Issue:** The preview pane registry is stored on `globalThis.__or3NetPreviewPaneRecords`:

```ts
type PreviewPaneStateGlobals = typeof globalThis & {
    __or3NetPreviewPaneRecords?: Map<string, Or3NetPreviewPaneRecord>;
};

const globals = globalThis as PreviewPaneStateGlobals;
const registry =
    globals.__or3NetPreviewPaneRecords ??
    (globals.__or3NetPreviewPaneRecords = new Map<string, Or3NetPreviewPaneRecord>());
```

This is a non-standard pattern that works for HMR preservation but mutates the global scope, which can cause subtle issues with SSR (if this ever runs server-side) or test isolation (tests share `globalThis` unless explicitly sandboxed).

**Suggestion:** Use a module-level `Map` variable (same as `useOr3NetAuth` does), or move to Pinia for proper SSR-safe singleton state.

---

### 4.2 `Or3NetPreviewPane.vue` — `revokePreview` does not close or remove the pane

**File:** `app/components/dashboard/or3-net/Or3NetPreviewPane.vue`

**Issue:** After revoking a preview, the pane updates its record to `service_status: 'revoked'` but remains visible. The user sees:
- No iframe (because `embed_url` is still populated unless cleared).
- No clear indication that the pane should be closed.
- No automatic removal from the pane registry.

**Suggestion:** After a successful revoke, either close the pane programmatically via `getGlobalMultiPaneApi()` or show a clear "Preview revoked — close this pane" CTA.

---

### 4.3 `useOr3NetAuth` type-asserts `useRuntimeConfig` on every call

**File:** `app/composables/or3-net/useOr3NetAuth.ts`

**Issue:** `useRuntimeConfig` is cast with `as { public: { ssrAuthEnabled?: boolean; or3Net?: {...} } }` in two different places inside the composable. These casts are not verified against the actual runtime config type in `nuxt.config.ts`, meaning type drift is invisible to the TypeScript compiler.

**Suggestion:** Augment the `RuntimeConfig` type in a `.d.ts` file (following Nuxt's augmentation pattern) so `useRuntimeConfig()` returns a properly typed value without manual casts.

---

### 4.4 The exchange endpoint hardcodes a 10-second upstream timeout

**File:** `server/api/or3-net/exchange.post.ts`

**Issue:**
```ts
signal: AbortSignal.timeout(10_000),
```

The upstream timeout to `or3-net`'s auth exchange is hardcoded at 10 seconds and is not configurable. If or3-net is deployed in a high-latency network (cross-region, VPN, etc.), this could cause spurious `502` errors.

**Suggestion:** Make this configurable via `OR3_NET_EXCHANGE_TIMEOUT_MS` or derive it from the token TTL.

---

### 4.5 `parseCsvList` in `Or3NetworkPage.vue` is duplicated in `useOr3NetPresets.ts`

**File:** `app/components/dashboard/or3-net/Or3NetworkPage.vue` and `app/composables/or3-net/useOr3NetPresets.ts` (indirectly via `formatPresetSummary` calling it)

**Issue:** The CSV-parsing helper `parseCsvList` (split on comma, trim, deduplicate) is defined inside `Or3NetworkPage.vue` and re-derived in `useOr3NetPresets.ts`'s `formatPresetSummary`. This is a small but unnecessary duplication.

**Suggestion:** Extract to a shared utility in `app/utils/or3-net.ts` or alongside the composable types.

---

### 4.6 `Or3NetPreviewPane.vue` — `revokePreview` leaves `launch_url` as empty string

**File:** `app/components/dashboard/or3-net/Or3NetPreviewPane.vue`

**Issue:**
```ts
previewPaneState.update(record.value.id, {
    launch_url: '',  // ← empty string instead of null
    embed_url: null,
    ...
});
```

`launch_url` is typed as `string` (not `string | null`) in `Or3NetPreviewPaneRecord`. Setting it to an empty string is semantically inconsistent — it's neither a valid URL nor a clear sentinel value. The `resolveSafeBrowserUrl` helper does handle the empty string case (it returns `null`), but it would be cleaner to use a separate boolean flag or a `revoked` state enum.

---

### 4.7 `useOr3NetJobStream` — `isTerminal` flag is not reset on `detach()`

**File:** `app/composables/or3-net/useOr3NetJobStream.ts` — `clearTransport()`

**Issue:** `clearTransport()` sets `connected.value = false` and `pending.value = false` but does **not** reset `isTerminal.value`. `isTerminal` is only reset in `resetStreamState()`, which is called in `connect()`. This means that if a consumer calls `detach()` (which calls `clearTransport()`) and then re-attaches to a different job without calling `attach()` first, `isTerminal` from the previous job may linger.

In practice, `attach()` always calls `connect()` which calls `resetStreamState()`, so this edge case is only reachable if `detach()` is called directly and the composable's state is subsequently inspected. But it's a subtle invariant violation.

---

### 4.8 `useOr3NetSession` — `install` flag is global, preventing per-component isolation

**File:** `app/composables/or3-net/useOr3NetSession.ts`

**Issue:** `invalidationWatcherInstalled` is a module-level boolean. This means the first component to call `useOr3NetSession()` determines which `workspaceId` and `clientSessionId` WatchSources the single shared watcher observes. All subsequent callers share the same watcher silently.

This is intentional (the session is a singleton), but the pattern is not documented and could confuse future developers who expect `useOr3NetSession()` to return isolated per-component state.

---

## 5. Missing Functionality / UX Gaps

### 5.1 No pagination for the jobs list

**File:** `app/components/dashboard/or3-net/Or3NetworkPage.vue` — `refreshJobs()`

The jobs list fetches the last 20 jobs with no load-more or pagination UI. For active workspaces with many jobs, the user has no way to browse history beyond the most recent 20.

---

### 5.2 No visual indication when the token is about to expire

**File:** `app/components/dashboard/or3-net/Or3NetworkPage.vue`, `app/composables/or3-net/useOr3NetAuth.ts`

The token expiry is displayed as a timestamp but there is no proactive UI warning (e.g. a badge turning yellow when ≤10s remain). The automatic refresh only happens when the next API call is made, so a user who is watching a streaming job without interacting might see a sudden `401` when the stream makes its next reconnect attempt.

---

### 5.3 Error codes from `Or3NetRequestError` are not surfaced in the UI

**File:** `app/components/dashboard/or3-net/Or3NetworkPage.vue`

The transport layer fully parses `Or3NetRequestError.code` and `retryAfterMs` from error envelopes, but the dashboard page only displays `error.message` strings. Canonical error codes (e.g. `quota_exceeded`, `node_unavailable`) that could guide user recovery are silently dropped.

This is tracked as a known gap in `planning/or3-net/tasks.md` (task 3).

---

### 5.4 No abort signal is passed to the job submission `fetch`

**File:** `app/composables/or3-net/useOr3NetClient.ts` — `request()`

The internal `fetch` call does not accept or pass an `AbortSignal`. Long-running requests (e.g. `createJob`) cannot be cancelled by the caller. If the user navigates away mid-submit, the request runs to completion in the background with no way to cancel it.

---

### 5.5 No retry-after handling for `429` responses in the UI

**File:** `app/composables/or3-net/useOr3NetClient.ts`, `app/components/dashboard/or3-net/Or3NetworkPage.vue`

`Or3NetRequestError.retryAfterMs` is populated correctly from the response. However, no page action respects this value — on `429`, the user sees a generic error message with no indication of when to retry. This is tracked in `planning/or3-net/tasks.md` (task 3.3).

---

### 5.6 `Or3NetPreviewPane.vue` iframe has no sandbox attribute

**File:** `app/components/dashboard/or3-net/Or3NetPreviewPane.vue`

The preview iframe:
```html
<iframe
    :src="iframeUrl"
    class="h-full min-h-[420px] w-full border-0"
    title="OR3 Net Preview"
    loading="lazy"
    referrerpolicy="no-referrer"
/>
```

No `sandbox` attribute is applied. Without `sandbox`, the embedded page can execute scripts, navigate the top-level frame, and access `window.opener`. While the preview URL is validated to be HTTP(S) only and is workspace-owned, adding a `sandbox` attribute (e.g. `sandbox="allow-scripts allow-same-origin allow-forms"`) would follow the principle of least privilege and reduce the blast radius if a preview URL is ever compromised.
