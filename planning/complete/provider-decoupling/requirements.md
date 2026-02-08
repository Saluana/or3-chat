# requirements.md

## Summary
OR3 Cloud must be **provider-swappable** for:
- SSR auth (session + authorization)
- Sync backend (Dexie ⇄ server)
- Blob storage backend (presign/upload/download + metadata)

And it must be swappable **without turning “not configured” into “won’t build”**.

The intern’s plan is directionally right, but it under-specifies the *actual hard part* in Nuxt:
**the build graph**.

If a file that Nuxt/Vite/Nitro compiles imports `convex-vue`, `convex/browser`, or `@clerk/nuxt/server` (even behind a runtime `if`), you still have a *compile-time dependency*.

This doc defines what “decoupled” means (acceptance criteria) so implementation can be one-shot.

---

## Definitions (read first)

### Compile-time coupling (what we’re fixing)
Typecheck/build fails when a provider is missing. Examples:
- `@clerk/nuxt` removed ⇒ `nuxt build` fails because a server middleware file imports it.
- `convex/_generated/**` removed ⇒ `nuxt build` fails because a page or server route imports it.

### Runtime gating (what is *not* enough)
Code like:
```ts
if (config.sync.provider !== 'convex') return;
const { useConvexClient } = await import('convex-vue');
```
…does not guarantee uninstallability in Nuxt/Vite, because Vite still has to resolve the import target when bundling.

### Build-graph hot zones (Nuxt/Nitro auto-includes these)
Provider-specific imports are forbidden in:
- `app/pages/**` (all pages are compiled)
- `app/plugins/**` (auto-loaded)
- `server/api/**` (auto-registered routes)
- `server/middleware/**` (auto-registered middleware)
- `server/plugins/**` (auto-registered Nitro plugins)

If provider code must exist, it must live **outside these zones** (ideally: outside core entirely).

---

## Scope

### In scope (must be solved)
- Auth: request context + session resolution + `can()` gating
- Sync:
  - Client: `SyncProvider` registration (direct vs gateway)
  - Server: `/api/sync/*` endpoints (gateway mode)
- Storage:
  - Client: `ObjectStorageProvider` registration
  - Server: `/api/storage/*` endpoints
- Workspace lifecycle:
  - Client UI (list/create/update/delete/set-active)
  - Server provisioning (user/workspace mapping via canonical store)

### Also required for “no Convex build” to be true (currently imports Convex)
These surfaces currently pull Convex into the build graph, so they must be addressed or explicitly disabled by configuration:
- Rate limits provider (`server/utils/rate-limit/**`)
- Background jobs provider (`server/utils/background-jobs/**`) + server notification emitter (`server/utils/notifications/emit.ts`)
- Dev/test pages under `app/pages/_tests/**` (currently import `convex-vue` / `convex/_generated`)

If we ignore these, “sync/storage decoupled” is still a lie because the repo still won’t build without Convex.

---

## Requirements

### 1) Provider swappability (DX)

**1.1 Auth provider swappable without core edits**
- Change config + install/uninstall provider package; do not edit core app logic.
- Note (Nuxt reality): provider packages that need to run code at build/start must be included via a Nuxt module (or a build-time discovery step that generates an import map). Built-in providers (Clerk/Convex) can be supported without further core edits; truly third-party providers require discovery if we want “install-only” UX.
- Acceptance:
  - WHEN `auth.enabled=true` and `auth.provider=<id>` THEN only `<id>`’s auth code is active.
  - IF `<id>` is not installed/registered THEN:
    - strict mode ⇒ fail fast with a clear startup error
    - non-strict ⇒ disable auth with a clear warning + degrade to unauthenticated

**Install-time constraint (OR3 recommended)**
- Provider changes are applied at **install/setup time** via the wizard:
  - install/uninstall packages
  - write config
  - rebuild/restart
- We do **not** require hot-swapping providers without a rebuild.
- For install-time selection, default to **strict** behavior: missing provider package/registration is a startup error (do not “soft disable” silently).

**1.2 Sync provider swappable without core edits**
- Acceptance:
  - WHEN `sync.enabled=true` and `sync.provider=<id>` THEN the client uses `<id>` if registered.
  - IF `<id>` is missing THEN:
    - strict mode ⇒ fail fast (preferable; sync is data integrity)
    - non-strict ⇒ disable sync or fall back to a registered gateway provider (explicitly configured)

**1.3 Storage provider swappable without core edits**
- Acceptance:
  - WHEN `storage.enabled=true` and `storage.provider=<id>` THEN only `<id>`’s storage backend is used.
  - IF `<id>` is missing THEN strict mode fails fast; non-strict disables storage + queue.

---

### 2) No provider SDKs in core build graph

**2.1 Core builds without Clerk installed**
- Acceptance:
  - WHEN `@clerk/nuxt` is removed from `package.json` and `auth.provider != clerk`
    THEN `bun run build` and `bun run type-check` succeed.

**2.2 Core builds without Convex installed**
- Acceptance:
  - WHEN `convex`, `convex-nuxt`, `convex-vue` are removed from `package.json`
    AND `convex/**` (including `convex/_generated/**`) is absent
    AND no configured surface selects a Convex-backed provider
    THEN `bun run build` and `bun run type-check` succeed.

**2.3 No provider imports in auto-included zones**
- Acceptance:
  - Core code under `app/pages/**`, `app/plugins/**`, `server/api/**`, `server/middleware/**`, `server/plugins/**`
    SHALL NOT import any provider SDKs or generated provider files.
  - This includes **type-only** imports (TypeScript still resolves modules).

---

### 3) Provider-agnostic workspace lifecycle

**3.1 Workspace UI is backend-agnostic**
- Acceptance:
  - Workspace UI SHALL depend on a `WorkspaceApi` interface, not SDKs.
  - `app/plugins/workspaces/WorkspaceManager.vue` (or its replacement) SHALL NOT import `convex-vue` or `~~/convex/_generated/api`.

**3.2 Session provisioning uses `AuthWorkspaceStore`**
- Acceptance:
  - `server/auth/session.ts` SHALL map provider identity ⇒ internal user/workspace through a configured `AuthWorkspaceStore` adapter.
  - Missing adapter behavior is governed by `auth.sessionProvisioningFailure` (`throw` / `unauthenticated` / `service-unavailable`).

---

### 4) Server gateway endpoints are provider-agnostic

Core SSR endpoints must be stable for gateway mode, but must not bake in providers.

**4.1 Sync gateway endpoints dispatch**
- `/api/sync/push|pull|update-cursor|gc-*` SHALL call a provider-selected server adapter (registry/dispatcher) and not import Convex types.

**4.2 Storage endpoints dispatch**
- `/api/storage/presign-*|commit|gc/*` SHALL call a provider-selected server adapter (registry/dispatcher) and not import Convex types.

---

### 5) Packaging/extraction (the only durable “optional dependency” solution)

**5.1 Provider implementations live in installable packages**
- Acceptance:
  - Core OR3 app does not list provider SDKs in dependencies.
  - Provider packages own their SDK imports and register implementations via registries/hooks.
  - Provider packages are loadable without touching core app logic (either via explicit Nuxt modules for built-ins, or via a build-time discovery/import-map for third-party providers).

**5.2 Convex backend distribution is explicit**
- Acceptance:
  - Installing Convex provider includes a clear init/codegen workflow.
  - Without Convex provider installed, `convex/**` is not required to exist.

---

### 6) Non-functional

**6.1 Simplicity**
- Keep the boundary boring:
  - registries + small interfaces
  - no “framework within a framework”

**6.2 Performance**
- Provider selection is resolved once at boot and cached; no hot-path registry scans.
- No extra network round trips compared to today’s default behavior.
