# dumb-issues.md

This document is intentionally blunt and concrete: each item is a real coupling point that prevents “provider swappability” from being true in practice.

---

## 0) “Dynamic import behind config” does not guarantee uninstallability in Nuxt

**Problem**
Nuxt/Vite/Nitro compile and bundle specific file trees automatically:
- `app/pages/**`, `app/plugins/**`
- `server/api/**`, `server/middleware/**`, `server/plugins/**`

If any file in those zones imports provider SDKs or generated files, you have a compile-time dependency even if runtime code never executes.

**Concrete fix (recommended)**
Provider implementations must not exist in core build graph.
- Put provider code in **installable Nuxt module packages**
- Provider packages self-register implementations into core registries

This is the only clean “uninstall dependency, repo still builds” solution.

---

## 1) “Runtime gating” with compile-time imports (Convex still required)

**Where**
- `app/plugins/convex-sync.client.ts`

**Snippet**
```ts
import { useConvexClient } from 'convex-vue';
// ...
if (runtimeConfig.public.sync?.provider !== CONVEX_PROVIDER_ID) return;
```

**Why this is bad**
Auto-loaded plugin + top-level Convex imports ⇒ Convex is mandatory even when not selected.

**Concrete fix**
- Core plugin becomes provider-agnostic (sync engine + registry only).
- Convex provider package adds a client plugin that registers the Convex `SyncProvider`.

---

## 2) Convex+Clerk bridge plugin hardwires both providers into the client build

**Where**
- `app/plugins/convex-clerk.client.ts`

**Why this is bad**
This forces Convex and Clerk into the client graph. Also relies on `window.Clerk` (auth-provider assumption).

**Concrete fix**
- Move this into the Convex provider package.
- Replace `window.Clerk` with a provider-agnostic token broker (client + server).

---

## 3) Workspace UI is married to Convex

**Where**
- `app/plugins/workspaces/WorkspaceManager.vue`

**Snippet**
```ts
import { useConvexMutation, useConvexQuery } from 'convex-vue';
import { api } from '~~/convex/_generated/api';
```

**Why this is bad**
Swapping backend requires rewriting UI, and Convex becomes a mandatory dependency for unrelated UI.

**Concrete fix**
- Introduce a tiny `WorkspaceApi` interface + composable resolver.
- UI talks only to `WorkspaceApi`.
- Providers implement `WorkspaceApi` (SDK direct or SSR endpoints).

---

## 4) SSR session provisioning is hardcoded to Convex (ignores AuthWorkspaceStore)

**Where**
- `server/auth/session.ts`

**Why this is bad**
Canonical user/workspace mapping becomes Convex-only, blocking other backends.

**Concrete fix**
- Implement an `AuthWorkspaceStore` registry (server).
- `resolveSessionContext()` calls the configured store adapter.
- Convex store adapter lives in Convex provider package.

---

## 5) Clerk middleware runs whenever SSR auth is enabled (provider mismatch)

**Where**
- `server/middleware/00.clerk.ts`

**Why this is bad**
`auth.enabled` is not “use Clerk”. Swapping auth provider still triggers Clerk middleware and crashes if Clerk uninstalled.

**Concrete fix**
Core should not ship Clerk middleware in `server/middleware/**`.
- Clerk provider package adds its own middleware when installed.

---

## 6) Server registers Clerk auth provider regardless of selected provider

**Where**
- `server/plugins/auth.ts`

**Why this is bad**
Same mismatch as middleware: `auth.enabled` != “register Clerk”.

**Concrete fix**
Auth providers register themselves from their Nuxt modules (provider packages).
Core doesn’t import provider implementations.

---

## 7) Core server Convex utilities make Convex non-optional

**Where**
- `server/utils/convex-client.ts`
- `server/utils/sync/convex-gateway.ts`

**Why this is bad**
These files import `convex/*` and `~~/convex/_generated/*` in core server code.

**Concrete fix**
Move them into the Convex provider package. Core server code must not import Convex SDKs or generated APIs.

---

## 8) Admin adapters hardcode “Clerk tokens for Convex gateway”

**Where**
- `server/admin/providers/adapters/sync-convex.ts`
- `server/admin/providers/adapters/storage-convex.ts`

**Why this is bad**
Backend adapter assumes auth provider (Clerk). Swap auth ⇒ admin breaks.

**Concrete fix**
Introduce a server `ProviderTokenBroker` interface:
- `getProviderToken({ providerId, template })`
Implemented by auth provider package.
Convex admin adapters request tokens via this broker, never via Clerk-specific helpers.

---

## 9) Provider IDs are compile-time unions (blocks external providers)

**Where**
- `shared/cloud/provider-ids.ts`
- `utils/or3-cloud-config.ts` (`z.enum(...)`)
- `config.or3cloud.ts` casts env to those union types

**Why this is bad**
Adding a provider requires editing core code to extend the union. That defeats “installable provider packages”.

**Concrete fix**
- Make provider IDs plain `string` in config schema.
- Validate at runtime against registries (strict mode).

---

## 10) Convex backend code is explicitly Clerk-only (fine only if it’s not core)

**Where**
- `convex/**`

**Why this is bad**
As long as `convex/**` is in core, core is not truly provider-agnostic.

**Concrete fix**
Convex backend lives in Convex provider package, delivered via an explicit init/codegen workflow.

---

## 11) SSR gateway endpoints import Convex generated APIs (sync + storage)

**Where**
- `server/api/sync/*.post.ts`
- `server/api/storage/*.post.ts`

**Why this is bad**
Even if `sync.provider != convex`, these files are part of Nitro server build graph. Missing `convex/_generated/**` breaks the server build.

**Concrete fix**
Convert core endpoints into provider-agnostic dispatchers:
- core does auth + `can()` + validation + rate limiting
- dispatches to registered `SyncGatewayAdapter` / `StorageGatewayAdapter`
- provider packages register adapters (Convex/SQLite/etc)

---

## 12) Rate limit provider is imported unconditionally (Convex becomes mandatory)

**Where**
- `server/utils/rate-limit/store.ts` imports `./providers/convex` at top-level

**Why this is bad**
Even if config selects memory, the build still requires Convex.

**Concrete fix**
Use the same provider pattern:
- registry + adapters
- Convex rate limit provider lives in Convex provider package

---

## 13) Background job provider uses a “dynamic import” that still bundles Convex

**Where**
- `server/utils/background-jobs/store.ts` does `await import('./providers/convex')`

**Why this is bad**
This is still a statically analyzable import target; bundling includes the module and its Convex imports.

**Concrete fix**
Provider package registers `BackgroundJobProvider` via Nitro plugin; core never references provider module paths.

---

## 14) Notifications emitter is Convex-only in core

**Where**
- `server/utils/notifications/emit.ts`

**Why this is bad**
Convex becomes mandatory even when background streaming is off.

**Concrete fix**
Move Convex notification emission into Convex provider package or introduce a small notification persistence interface with provider implementations.

---

## 15) Dev/test pages under `app/pages/_tests/**` break “no Convex” builds

**Where**
- `app/pages/_tests/_test-*.vue`

**Why this is bad**
All pages are compiled. These imports will break the client build when Convex is uninstalled.

**Concrete fix**
Move provider-specific test pages into provider packages (best), or keep them out of `app/pages/**` in non-provider builds.

---

## 16) Provider implementation files + type augmentations still break “uninstall the dependency”

**Where (examples)**
- `app/core/sync/providers/convex-sync-provider.ts` (imports `convex-vue` and `~~/convex/_generated/*`)
- `server/auth/providers/clerk/clerk-auth-provider.ts` (imports `@clerk/nuxt/server`)
- `server/types/convex-http-client.d.ts` (imports `convex/server`)
- `server/admin/stores/convex/**` (imports `~~/convex/_generated/*`)

**Why this is bad**
Even if the auto-loaded plugins/middleware are fixed, these files can still be part of the TypeScript program and/or server bundle. If the dependency is removed, typecheck/build still fails.

**Concrete fix**
- Move provider implementation files (and provider-specific type augmentation files) into provider packages.
- Ensure core does not include provider-only `*.d.ts` that reference provider SDK types.
