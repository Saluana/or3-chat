# Neckbead Review: Sync Engine / Provider Decoupling

Date: 2026-02-05
Scope: sync engine, gateway provider, hooks, auth gating, schemas, notifications.

---

## `can()` Ignores Resource Scoping (Workspace ID Is Dead Weight)

Location: `server/auth/can.ts:90-134`

Snippet:
```ts
export function can(session, permission, resource?: { kind: string; id?: string }) {
  // ...
  return applyDecisionFilters(base, session);
}
```

Why this is bad:
`resource?.id` is accepted but never enforced. This makes `requireCan(session, 'workspace.write', { id: workspaceId })` a placebo unless some downstream adapter re-checks authorization. That violates your own “`can()` is the sole authorization gate” rule and makes it dangerously easy to ship endpoints that look protected but aren’t.

Real-world consequences:
Cross-workspace writes become possible whenever a server handler calls `requireCan()` with an `id` expecting it to be checked. If the backing adapter forgets to re-check (or checks inconsistently), you get data leaks or corruption across workspaces.

Concrete fix:
Enforce workspace scoping in `can()` for `resource.kind === 'workspace'` by verifying membership/role for `resource.id` (not whatever `session.workspace?.id` happens to be). If the session currently only contains a “default” workspace, either:
1. Resolve role for the requested workspace on demand via the configured `AuthWorkspaceStore`, or
2. Include a membership map in `SessionContext` and check it here.

---

## Session Resolution Always Binds to “Default Workspace” (Active Workspace Not Considered)

Location: `server/auth/session.ts:125-188`

Snippet:
```ts
const storeId = config.public.sync?.provider || 'convex';
const store = getAuthWorkspaceStore(storeId);
const { workspaceId, workspaceName } = await store.getOrCreateDefaultWorkspace(userId);
const role = await store.getWorkspaceRole({ userId, workspaceId });
```

Why this is bad:
Every request gets a session tied to the default workspace, regardless of which workspace the client is actually operating on. Combined with `can()` not enforcing `resource.id`, this is a security and correctness footgun.

Real-world consequences:
Authorization decisions are made using the wrong workspace context. Sync endpoints that pass `scope.workspaceId` into `requireCan()` look correct but do not actually verify access to that workspace.

Concrete fix:
Stop hard-coding “default workspace” for session binding. Resolve the requested/active workspace ID from the request context (route/body) and ask the store for role/membership for that workspace. If you truly need a default workspace for “home,” keep it as a fallback, not as the only workspace.

---

## “Atomic Outbox Capture” Claim Is False (Deferred Inserts Can Drop Ops)

Location: `app/core/sync/hook-bridge.ts:1-11`, `app/core/sync/hook-bridge.ts:303-356`

Snippet:
```ts
// Key features:
// - Atomic: Uses Dexie hooks so outbox write is in same transaction
// ...
if (hasPendingOps) {
  transaction.table('pending_ops').add(pendingOp);
} else {
  transaction.on('complete', () => enqueuePendingOp());
}
```

Why this is bad:
You explicitly fall back to `transaction.on('complete', ...)` when `pending_ops` isn’t part of the current transaction. That is not atomic. It’s a best-effort side effect after commit.

Real-world consequences:
You can commit the local write and still lose the outbox op if:
the completion handler never runs, the add fails, the page unloads, or hook scheduling races. That yields silent divergence: data looks “saved” locally but never syncs.

Concrete fix:
Make `pending_ops` a required participant in transactions that touch synced tables, or restructure capture so it runs inside a transaction you control (e.g., wrap writes through a single “sync-aware” DB API that always includes `pending_ops`).

---

## Provider Interface Lies: `onChanges` Is Typed Sync but Used Async

Location: `shared/sync/types.ts:141-146`, `app/core/sync/providers/gateway-sync-provider.ts:96-104`, `app/core/sync/subscription-manager.ts:380-391`

Snippet:
```ts
// shared/sync/types.ts
onChanges: (changes: SyncChange[]) => void

// gateway-sync-provider.ts
await Promise.resolve((onChanges as unknown as (...) => void | Promise<void>)(changes));
```

Why this is bad:
The type contract says `void`, but you depend on async backpressure for correctness (“avoid overlapping apply cycles”). Then you cast to force it.

Real-world consequences:
Any provider implementation that legitimately calls `onChanges()` without awaiting (because the type says it’s sync) can reintroduce cursor/accounting races and “duplicate apply” behavior. Also: casts hide real bugs.

Concrete fix:
Change the interface to `onChanges: (changes: SyncChange[]) => void | Promise<void>` and remove the casts. This is a compatibility break you actually need.

---

## Permanent-Failure Detection Is Brittle Substring Matching

Location: `app/core/sync/outbox-manager.ts:352-369`

Snippet:
```ts
if (error.includes('Invalid payload for') && error.includes('received undefined')) return true;
```

Why this is bad:
This is not an error model; it’s vibes-based string matching. It will misclassify transient errors as permanent (or vice versa) depending on backend wording, and it forces you to bake backend phrasing into client logic.

Real-world consequences:
Ops get stuck in `failed` forever (no retry) or spam retries forever. Users see “sync errors” that never self-heal, and you’ll get heisenbugs depending on server error formatting.

Concrete fix:
Make push results return structured error codes (e.g., `{ code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | ... }`) and classify on those. If you can’t change the server right now, at least classify by HTTP status code before reading/formatting the body.

---

## Notification Center Is Getting Nuked With Full Server Error Blobs

Location: `app/core/sync/providers/gateway-sync-provider.ts:42-55`, `app/plugins/notification-listeners.client.ts:144-167`

Snippet:
```ts
// gateway-sync-provider.ts
throw new Error(`[gateway-sync] ${path} failed: ${res.status} ${text}`);

// notification-listeners.client.ts
body: message,
```

Why this is bad:
You throw errors that embed the entire response body (often a big JSON with stack traces), then you shove `error.message` directly into a persistent notification. That’s how you got the unreadable wall-of-JSON in the UI.

Real-world consequences:
Awful UX, notification spam, and accidental disclosure of internal server details (stack traces, file paths, validation internals) to the client.

Concrete fix:
Truncate and sanitize error messages before throwing or before notifying. Prefer:
1. `throw new Error("[gateway-sync] /api/sync/push failed (400)")`
2. Include a short server-provided `errorCode`/`message` field if present, not raw stacks.

---

## Dead Hook Listener: `sync:action:error` Is Registered but Not Emitted

Location: `app/plugins/notification-listeners.client.ts:172-185`

Why this is bad:
You have two different “sync error” notification pathways, and one appears unused.

Real-world consequences:
Wasted complexity and false confidence (“we listen for sync errors”) while the actual system uses a different hook (`sync.error:action`).

Concrete fix:
Delete the dead listener, or actually emit `sync:action:error` from a single, well-defined place. Do not keep both.

---

## Sync Engine Plugin Pretends to Watch Session but Doesn’t Gate on It

Location: `app/plugins/convex-sync.client.ts:240-245`, `app/plugins/convex-sync.client.ts:279-294`

Snippet:
```ts
const { data: sessionData } = useSessionContext();
// ... sessionData is never used
if (workspaceId) void startSyncEngine(workspaceId);
```

Why this is bad:
The comment claims the engine starts “when an authenticated session is active,” but it starts solely based on `activeWorkspaceId`. If something sets a workspace ID while logged out (or during auth churn), you start pushing/pulling anyway.

Real-world consequences:
Unauthenticated sync attempts, noisy retries, and confusing “it worked then stopped” behavior during session refreshes.

Concrete fix:
Gate start/stop on `sessionData.value?.authenticated === true` (or the equivalent stable session flag) in the watcher’s dependency and logic.

---

## Wrong Lifecycle Ownership: Plugin Disposes the Global Provider Instance

Location: `app/plugins/convex-sync.client.ts:164-175`, `app/core/sync/sync-provider-registry.ts:9-55`

Snippet:
```ts
// convex-sync.client.ts
await engineState?.provider.dispose();

// sync-provider-registry.ts
const providers = new Map<string, SyncProvider>();
```

Why this is bad:
The provider registry is global. The plugin doesn’t “own” provider lifetimes, but it calls `dispose()` as if it does. If the provider is shared or reused, you can break future starts or other consumers.

Real-world consequences:
“Sync randomly stops working” after route changes, HMR, or stop/start cycles because the provider’s internal subscription set got cleared/disposed.

Concrete fix:
Either:
1. Ensure every engine instance gets its own provider instance (factory-based), or
2. Make providers stateless and move per-engine resources (subscriptions) into the SubscriptionManager, or
3. Make `dispose()` idempotent/no-op for registry-shared providers and rename it to something less destructive.

---

## Accidental Duplicate Line in Config Gate (Sloppy and Risky)

Location: `app/plugins/convex-sync.client.ts:219-223`

Snippet:
```ts
if (!runtimeConfig.public.ssrAuthEnabled || !runtimeConfig.public.sync?.enabled) {
if (!runtimeConfig.public.ssrAuthEnabled || !runtimeConfig.public.sync?.enabled) {
```

Why this is bad:
This is a trivial copy/paste artifact that signals the file isn’t being kept clean. It also makes future diffs noisier and increases the chance of mismatched edits.

Real-world consequences:
Someone “fixes one” and not the other. Or you end up with inconsistent gating logic after future refactors.

Concrete fix:
Delete the duplicate line.

---

## Wire Schema Inconsistency: Posts Use `postType` (camelCase) in Shared Schema

Location: `shared/sync/schemas.ts:95-106`, `shared/sync/field-mappings.ts:1-5`

Snippet:
```ts
postType: z.string(), // Client-side uses camelCase
```

Why this is bad:
Your own design constraints say wire schema is snake_case aligned with Dexie. But the shared schema bakes in a camelCase exception. Then you add a mapping shim that exists only for `posts`.

Real-world consequences:
Every new backend and every new table now has to learn a “special-case mapping” pattern, which is exactly the kind of drift that causes validation bugs and sync corruption later.

Concrete fix:
Make the shared *wire* schema snake_case (`post_type`) and keep any camelCase mapping strictly at UI boundaries, not in sync payload schemas.

---

## `field-mappings.ts` Contains Dead Branches and Contradictory Logic

Location: `shared/sync/field-mappings.ts:7-38`

Snippet:
```ts
if (snake in result) { ... }
else if (camel in result && snake in result) { ... } // unreachable
```

Why this is bad:
The `else if` condition is unreachable because the first branch already checked `snake in result`. The server-format function has the same problem. This is noise that misleads reviewers into thinking there’s a real corner case being handled.

Real-world consequences:
Future edits will pile on more “safety” branches that never execute, and you’ll miss actual mapping edge cases because the code looks more robust than it is.

Concrete fix:
Delete the unreachable branches. If you need conflict resolution when both keys exist, handle it explicitly before the loop.

---

## `sanitizePayloadForSync()` Docs Say “Undefined for Delete” but Function Doesn’t Do That

Location: `shared/sync/sanitize.ts:15-31`

Snippet:
```ts
// @returns Sanitized payload or undefined for delete operations
// Delete operations don't need payload
if (!payload || typeof payload !== 'object') return undefined;
```

Why this is bad:
The implementation ignores `operation` for the “undefined for delete” behavior. If callers pass an object payload for deletes (and you do elsewhere), this returns a non-undefined payload.

Real-world consequences:
Different parts of the system develop conflicting assumptions about delete payload shape. That’s how you end up with validation rejecting delete ops, or adapters treating delete payloads inconsistently.

Concrete fix:
Either:
1. Actually return `undefined` when `operation === 'delete'`, or
2. Fix the docs and enforce a single delete payload contract everywhere (prefer: explicit tombstone payload schema, not “optional unknown”).

---

## Gateway Adapter Registry Instantiates a New Adapter on Every Call (No Caching)

Location: `server/sync/gateway/registry.ts:75-80`, `server/sync/gateway/registry.ts:104-109`

Snippet:
```ts
return item ? item.create() : null;
```

Why this is bad:
“Lazy instantiation” is fine, but “instantiate every time” is not the same thing. If adapters hold clients, caches, or expensive setup, you are rebuilding them per request.

Real-world consequences:
Avoidable perf hits, duplicated connections, and inconsistent adapter state across requests. This gets worse when you add storage adapters or providers with SDK init costs.

Concrete fix:
Cache adapter instances per `id` in the registry (or cache per request in `event.context`) unless you have a strong reason not to.

---

## Hooks System Is Internally Inconsistent (Fallback Engine Splits the World)

Location: `app/core/hooks/useHooks.ts:15-41`, `app/plugins/00-hooks.client.ts:6-24`

Snippet:
```ts
// useHooks.ts
const provided = nuxt.$hooks as HookEngine | undefined;
if (!provided) console.warn('[useHooks] No hook engine injected; using local fallback');

// 00-hooks.client.ts
provide: { hooks: createTypedHookEngine(engine) }
```

Why this is bad:
`useHooks()` treats `nuxt.$hooks` as a raw `HookEngine`, but the plugin provides a *typed wrapper* under `$hooks`. If anything about injection timing/context resolution goes wrong, `useHooks()` silently creates a second, disconnected hook engine as “fallback.” That means half your app can be emitting hooks into engine A while listeners are registered on engine B.

Real-world consequences:
Non-deterministic behavior where hooks “sometimes” fire depending on call site, timing, and whether `useNuxtApp()` resolved the right instance. This is exactly the kind of bug that makes sync and notifications look haunted.

Concrete fix:
Pick one:
1. Provide the raw `HookEngine` under `$hooks` and have `useHooks()` return `createTypedHookEngine(engine)` exactly once.
2. If you want `$hooks` to already be typed, make `useHooks()` return `nuxt.$hooks` directly and delete the fallback engine (or throw loudly in dev).

---

## No Tests Guarding Delete Ops Through Push Validation (Regression Magnet)

Location: `server/api/sync/push.post.ts:54-73`

Snippet:
```ts
// Only validate `put` payloads against table schemas.
if (op.operation === 'put' && op.payload) { ... }
```

Why this is bad:
You already hit a production-ish regression where delete operations were being rejected because “delete payloads” don’t contain put-required fields. This kind of bug comes back unless it’s pinned by a test.

Real-world consequences:
Thread/message deletions silently fail to sync, outbox fills with permanent failures, and users get spammed with sync error notifications.

Concrete fix:
Add an explicit unit/integration test for `/api/sync/push` validating:
1. `put` ops with invalid payloads are rejected.
2. `delete` ops with minimal payload (or no payload) are accepted and forwarded to the adapter.
