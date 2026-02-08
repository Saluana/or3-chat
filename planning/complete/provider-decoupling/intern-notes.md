# intern-notes.md

This doc is intentionally candid. Provider decoupling is mostly *mechanical*, but it’s easy to accidentally ship something that “works locally” yet still fails the real goal:

> **Core must `bun run build` + `bun run type-check` even when Clerk/Convex (and `convex/_generated/**`) are not installed.**

If you remember only one thing, remember this:

> **Nuxt build graph coupling ≠ runtime behavior.**

---

## TL;DR recommendations (simplest + best DX)

### 1) Install-time selection + provider Nuxt modules (recommended for OR3)
Treat provider choice as **install/setup time** (wizard), applied via **rebuild/restart**.

Providers should ship **Nuxt modules** that can:
- register client plugins (Convex realtime, auth bridges)
- register server middleware/plugins (Clerk request context, adapters)

Why this route is best (given “keep behavior identical”):
- preserves the existing Convex realtime path (no accidental downgrade to polling)
- keeps provider SDK imports out of core hot zones
- makes the wizard UX clean: install packages + write config + rebuild

### 2) Use gateway endpoints where they simplify without changing behavior
Gateway-first is a great simplification for **storage** and **workspaces** (both already behave like gateways in practice).

For **sync**, gateway-only usually changes realtime characteristics (polling) unless you add a realtime gateway channel. Keep the direct Convex sync provider for parity.

Honest take: gateway-only sync is correct, but not identical-feeling unless you preserve realtime.

### 3) Invest early in guard rails
Add a check (CI + local) that fails if core hot zones import provider modules:
- `@clerk/nuxt`
- `convex`, `convex-vue`
- `~~/convex/_generated/*`

This prevents “oops, one import left” from wasting days.

---

## What is likely to break (predictable break zones)

### A) Build/typecheck will fail early and often
Most common failure: a leftover import in a Nuxt auto-included zone.

Hot zones (core must be clean):
- `app/pages/**` (includes `app/pages/_tests/**`)
- `app/plugins/**`
- `server/api/**`
- `server/middleware/**`
- `server/plugins/**`

Also dangerous:
- provider-only `*.d.ts` type augmentations that import provider SDK types (TypeScript still resolves modules).

### B) SSR auth regressions
If you touch:
- `server/middleware/00.clerk.ts`
- `server/plugins/auth.ts`
- `server/auth/session.ts`

…you can accidentally make everything unauthenticated, break cookies, or break `can()` authorization gates across all SSR endpoints.

### C) Workspace lifecycle regressions
Refactoring `WorkspaceManager` off Convex can break:
- listing workspaces
- creating/updating/removing
- “active workspace” selection
- any code relying on `activeWorkspaceId` timing

### D) Sync engine start/stop and token wiring
When decoupling plugins/registrations, you can break:
- provider registration (engine starts with “no provider”)
- engine start/stop across route changes (admin routes, workspace nulling)
- token wiring for direct providers (Convex `setAuth`) and gateway fallback behavior

### E) SSR gateway endpoint dispatch
Once `/api/sync/*` and `/api/storage/*` dispatch to adapters, miswiring typically becomes:
- 404s (adapter not registered)
- 401s (token broker/auth mismatch)
- 500s (backend not configured)

### F) Admin tools
Admin adapters currently assume Clerk tokens for Convex gateway.
If you swap auth providers without a `ProviderTokenBroker`, admin actions will break.

### G) “Hidden” Convex coupling outside sync/storage
Even if sync/storage are decoupled, the build can still fail without Convex due to:
- rate limits provider selection (Convex imported unconditionally today)
- background jobs provider (Convex provider module path referenced)
- notifications emitter (Convex-only in core)
- `_tests` pages under `app/pages/_tests/**`

---

## Why “dynamic import behind config” is not enough (Nuxt reality)

Even this can fail decoupling:
```ts
if (cfg.provider !== 'convex') return;
await import('./convex-provider');
```

Because:
- Nuxt/Nitro/Vite may still statically analyze and bundle known import targets.
- TypeScript still resolves module paths for type-only imports.
- Auto-included zones force compilation even if the route/plugin never runs.

The durable approach is: **provider SDK imports live in provider packages**, not core.

---

## Minimal core interfaces/registries to standardize (boring is good)

### 1) `AuthWorkspaceStore` (server)
Session provisioning must use `AuthWorkspaceStore`, not Convex directly.

Suggestion: extend it to cover workspace CRUD so the UI can be gateway-first:
- `createWorkspace`, `updateWorkspace`, `removeWorkspace`, `setActiveWorkspace`

Alternative: introduce a separate `WorkspaceStore`.

### 2) `ProviderTokenBroker` (server)
Replace all provider-specific token minting like “get token from Clerk” with:
- `getProviderToken({ providerId, template? })`

This prevents “Convex assumes Clerk” and makes auth swappable.

### 3) `SyncGatewayAdapter` + `StorageGatewayAdapter` (server)
Core endpoints do:
- session resolution
- `can()` enforcement
- request validation + rate limiting
Then dispatch to the adapter selected by config.

Core endpoints must not import provider SDKs or provider generated APIs.

---

## Suggested implementation order (reduces blast radius)

1) Add guard rails (import bans in core hot zones).
2) Introduce `ProviderTokenBroker` (server) + swap all token minting to use it.
3) Introduce `AuthWorkspaceStore` registry + refactor `server/auth/session.ts` to use it.
4) Convert `/api/sync/*` and `/api/storage/*` endpoints into adapter dispatchers (no provider imports).
5) Add `/api/workspaces/*` endpoints + implement `WorkspaceApi` in client using them.
6) Replace provider-specific client plugins with provider-agnostic core plugins.
7) Remove/relocate provider-only pages (especially `app/pages/_tests/**`).
8) Only after all that: extract providers into packages and delete provider code from core.

This order keeps “auth works” as long as possible and avoids debugging everything at once.

---

## DX improvements that are worth doing

### A) Clear startup validation (strict mode)
When a surface is enabled but the provider isn’t registered, error loudly with:
- which provider id is missing
- which surface (auth/sync/storage)
- which package to install / how to enable the provider module

### B) Provider inclusion strategy (Nuxt constraint)
Installing a package doesn’t run it unless Nuxt includes its module.

Two options:
- Minimal: core `nuxt.config.ts` conditionally includes known provider modules (Clerk/Convex).
- Best DX for third-party providers: add a build-time discovery step that generates an import map from installed `or3-provider-*` packages, so new providers don’t require editing core config.

### C) Make storage always “gateway” (huge simplification)
The current client storage provider already calls `/api/storage/*`.
Generalize this into a single gateway provider:
- no client bundling changes per storage backend
- adding LocalFS/S3/etc is server-only work

---

## Sanity checks (what “done” looks like)

### Build matrix (must pass)
- No Clerk installed + `auth.provider != clerk` ⇒ `bun run build` + `bun run type-check`
- No Convex installed + no surface selects Convex-backed providers ⇒ `bun run build` + `bun run type-check`

### Runtime sanity
- Workspace UI works via `WorkspaceApi` without SDK imports.
- Sync works in gateway mode through `/api/sync/*`.
- Storage works through `/api/storage/*`.
- Admin actions authenticate via `ProviderTokenBroker` (no Clerk hardcodes outside provider package).
