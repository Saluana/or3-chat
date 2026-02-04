# design.md

## Overview
This design removes the *compile-time* coupling to Clerk + Convex while preserving the current “default providers” behavior.

The current state is not “provider-agnostic”; it’s “provider-agnostic in comments and config shape, but hard-wired in imports”. Runtime gating is not enough. Nuxt auto-loads plugins/middleware and TypeScript resolves imports at build time. If core files import `convex-vue` or `@clerk/nuxt/server`, the dependency is mandatory whether you use it or not.

The solution is boring and correct:
- Move **provider-specific imports** behind **dynamic imports** at execution time.
- Move provider implementations behind a **registry** with “installed/available” checks.
- Ensure core features (workspace UI, session provisioning, admin adapters) call **provider-agnostic interfaces**, not provider SDKs.

This design intentionally splits into two phases:
- Phase 1: refactor within this repo to kill hardcoding and make swapping survivable.
- Phase 2: extract Clerk/Convex into installable packages.

## Current Hard-Coupling Hotspots (What’s actually broken today)
These are the places that prevent provider swapping/removal:

- Client plugins import Convex at module top-level:
  - `app/plugins/convex-sync.client.ts` imports `convex-vue` and Convex provider modules even when `sync.provider != convex`.
  - `app/plugins/convex-clerk.client.ts` imports `convex-vue` and assumes Clerk is on `window`.

- Workspace UI imports Convex directly:
  - `app/plugins/workspaces/WorkspaceManager.vue` uses `useConvexQuery/useConvexMutation` and `~~/convex/_generated/api`.

- Server auth/session provisioning imports Convex directly:
  - `server/auth/session.ts` hardcodes Convex for workspace provisioning.
  - `server/utils/convex-client.ts` imports Convex SDK and generated API.

- Server middleware/plugins are only gated by `auth.enabled`, not selected provider:
  - `server/middleware/00.clerk.ts` runs whenever SSR auth is enabled.
  - `server/plugins/auth.ts` registers Clerk whenever SSR auth is enabled.

- Admin adapters hardcode “Clerk token for Convex gateway”:
  - `server/admin/providers/adapters/sync-convex.ts`, `storage-convex.ts` call `getClerkProviderToken(...)`.

- Config types bake provider IDs into compile-time unions:
  - `shared/cloud/provider-ids.ts` and `utils/or3-cloud-config.ts` hardcode provider ID lists. That blocks external providers without core edits.

## Phase 1 Design: Stop Hardcoding Inside This Repo

### 1) Provider Package Registry (runtime)
We already have a registry pattern for server auth providers (`server/auth/registry.ts`). Do the same concept across the provider surfaces, but keep it minimal.

Core interface (new, shared between server/client):
```ts
export type ProviderKind = 'auth' | 'sync' | 'storage' | 'limits' | 'background';

export interface ProviderPackage {
  id: string;
  kinds: ProviderKind[];
  // Optional hooks to register adapters into the existing registries.
  registerServer?: () => Promise<void>;
  registerClient?: () => Promise<void>;
}

export interface ProviderLoader {
  isAvailable(id: string): boolean;
  load(id: string): Promise<ProviderPackage | null>; // dynamic import
}
```

Key principle:
- Core never imports provider SDKs.
- Core only calls `load(providerId)`.

### 2) Nuxt auto-loaded plugins/middleware become thin dispatchers
Replace provider-specific Nuxt plugins (Convex/Clerk) with dispatcher plugins that:
- read runtime config
- `await import(...)` the selected provider package
- call that provider’s `registerClient()` / `registerServer()`

Example (client):
```ts
export default defineNuxtPlugin(async () => {
  const cfg = useRuntimeConfig();
  if (!cfg.public.ssrAuthEnabled) return;

  const providerId = cfg.auth.provider;
  const pkg = await loadProviderPackage(providerId);
  await pkg?.registerClient?.();
});
```

Example (server middleware):
```ts
export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig();
  if (cfg.auth.enabled !== true) return;

  const providerId = cfg.auth.provider;
  const pkg = await loadProviderPackage(providerId);
  // provider registers its own middleware or exposes a handler.
});
```

This kills the “plugin imports Convex even when unused” problem.

### 3) Provider-agnostic Workspace API (client)
Workspace lifecycle should not be implemented in the UI using backend SDKs.

Introduce a tiny composable boundary:
```ts
export interface WorkspaceApi {
  list(): Promise<Array<{ id: string; name: string; description?: string | null; role: string }>>;
  create(input: { name: string; description?: string | null }): Promise<{ id: string }>;
  update(input: { id: string; name: string; description?: string | null }): Promise<void>;
  remove(input: { id: string }): Promise<void>;
  setActive(input: { id: string }): Promise<void>;
}

export function useWorkspaceApi(): WorkspaceApi { /* resolves by provider */ }
```

Implementation options in Phase 1:
- Convex direct provider package can implement this via `convex-vue`.
- Gateway-only providers can implement this via SSR endpoints.

Outcome:
- `WorkspaceManager.vue` becomes backend-agnostic.
- Convex is no longer a required dependency to render workspace UI.

### 4) Session provisioning uses AuthWorkspaceStore (server)
`server/auth/session.ts` currently contains the exact TODO we need. Do it.

Flow:
- Resolve provider session via `AuthProvider` registry.
- Resolve canonical store adapter via `AuthWorkspaceStore` registry.
- Store adapter performs `getOrCreateUser`, `getOrCreateDefaultWorkspace`, `getWorkspaceRole`.

Adapter implementations:
- Convex-backed store (Phase 1) lives in provider code but still in-repo.
- Future stores live in external packages.

### 5) Config: move from compile-time ID unions → runtime validation
Right now `AUTH_PROVIDER_ID_LIST` etc are hard-coded union enums.

That guarantees you must edit core to add a provider. That’s the opposite of modular.

Phase 1 change (minimal and safe):
- Change config schema fields `auth.provider`, `sync.provider`, `storage.provider` to `z.string()`.
- Validate against the runtime registry (server boot) in strict mode:
  - “selected provider not registered” -> error.

Defaults remain as today (clerk/convex). But providers are not compile-time baked.

### 6) Admin adapters: stop hardcoding Clerk gateway tokens
Admin adapters for Convex should not call “getClerkProviderToken”. They should:
- request “provider token for `<providerId>` with template `<template>`” from `AuthTokenBroker` (server side version)
- or use a provider-owned gateway auth mechanism.

This is not optional if you want “swap Clerk”.

## Phase 2 Design: Extract to Installable Packages

### Package targets
- `or3-clerk` (auth provider package)
  - Nuxt module to add `@clerk/nuxt` only when installed
  - Nitro middleware for `event.context.auth`
  - `AuthProvider` registration (`clerkAuthProvider`)
  - Admin adapter for validating provider config

- `or3-convex` (sync + storage + canonical store package)
  - Nuxt module to add `convex-nuxt` only when installed
  - Client registrations:
    - Sync provider (`createConvexSyncProvider`)
    - Convex auth bridge (token → `convex.setAuth`)
    - WorkspaceApi direct implementation (optional)
  - Server registrations:
    - `AuthWorkspaceStore` implementation backed by Convex
    - Admin adapters for sync/storage

### The annoying reality: Convex backend code
Convex requires a root-level `convex/` project with schema/functions. You can’t “just import it”.

The clean path:
- `or3-convex` ships a template directory (e.g. `templates/convex/**`).
- Provide a generator script:
  - `bunx or3-convex init` copies templates into the host repo
  - OR, for monorepos: symlink via Bun workspace tooling.

This keeps the core app free of Convex files when not installed.

### Nuxt module ownership
If you want Convex/Clerk to be removable dependencies, core `nuxt.config.ts` must stop referencing their module-specific config keys.

In Phase 2:
- Core app does not set `convex: { ... }` at all.
- `or3-convex` Nuxt module injects those options and runtime config mapping.

Same for Clerk:
- `or3-clerk` module injects `@clerk/nuxt` and exposes the expected runtime config mapping.

## Error Handling
- Missing selected provider package:
  - Strict mode: throw a startup error identifying missing package + provider id.
  - Non-strict: disable the surface (auth/sync/storage) and surface a warning.

- Provider token failures:
  - Direct providers: fall back to gateway provider if registered.
  - Gateway-only: return 401/503 depending on configured policy.

## Testing Strategy

### Unit
- Provider registry:
  - selecting provider loads correct package
  - missing provider fails as expected
- Config validation:
  - provider id not in registry triggers strict-mode error
- WorkspaceApi boundary:
  - UI calls WorkspaceApi methods without importing provider SDKs

### Integration
- SSR auth with clerk installed vs not installed
- Sync provider direct (convex) vs gateway fallback
- Admin actions request provider token via broker (no Clerk hardcode)

### Build gates
- Build without `@clerk/nuxt` dependency when auth provider is not clerk
- Build without Convex dependencies when sync/storage not convex

That’s the whole point.
