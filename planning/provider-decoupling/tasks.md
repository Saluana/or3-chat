# tasks.md

## Phase 1 — Make it less hardcoded (in-repo refactor)

### 1. Kill compile-time imports in auto-loaded Nuxt plugins/middleware
- [ ] Replace provider-specific client plugins with thin dispatchers that dynamically import provider packages
  - Requirements: 2.2, 2.3
  - [ ] Remove top-level imports of `convex-vue` and `~~/convex/_generated/api` from auto-loaded plugins
  - [ ] Add a client dispatcher plugin that loads the selected sync provider package at runtime
  - [ ] Add a client dispatcher plugin that loads the selected auth provider package at runtime

- [ ] Gate server middleware/plugin registration by selected auth provider, not just `auth.enabled`
  - Requirements: 1.1, 2.1
  - [ ] Update server auth middleware dispatcher so it does not import Clerk when provider != clerk
  - [ ] Update server plugin registration so it only registers the configured provider’s AuthProvider

### 2. Introduce a minimal provider package loader/registry
- [ ] Implement a provider loader interface with dynamic imports
  - Requirements: 1.1, 1.2, 1.3, 2.3
  - [ ] Map provider IDs → dynamic import functions (initially for clerk/convex)
  - [ ] Add “isAvailable” checks so missing deps fail fast or soft depending on strict mode

### 3. Make workspace management provider-agnostic
- [ ] Create a `WorkspaceApi` boundary and refactor WorkspaceManager UI to use it
  - Requirements: 3.1
  - [ ] Implement Convex version of WorkspaceApi behind a dynamic import (only when convex is installed)
  - [ ] Implement gateway/SSR fallback WorkspaceApi (server endpoints) to enable non-Convex providers
  - [ ] Remove direct Convex usage from `WorkspaceManager.vue`

### 4. Replace Convex-only session provisioning with AuthWorkspaceStore adapter
- [ ] Implement a server-side registry for `AuthWorkspaceStore` adapters
  - Requirements: 3.2
  - [ ] Add `getActiveAuthWorkspaceStore()` resolver based on config
  - [ ] Implement Convex-backed store adapter (still in-repo for Phase 1)

- [ ] Refactor server session resolution to call `AuthWorkspaceStore` rather than Convex directly
  - Requirements: 3.2
  - [ ] Keep the current provisioning failure modes intact
  - [ ] Add tests for “missing store adapter” behavior

### 5. Stop hardcoding Clerk tokens inside Convex admin adapters
- [ ] Replace `getClerkProviderToken(...)` usage with token broker calls
  - Requirements: 1.1, 5.1
  - [ ] Add a server-side token broker interface (or reuse existing patterns) so adapters request tokens by provider id
  - [ ] Ensure admin actions can authenticate when auth provider is not clerk

### 6. Make provider IDs runtime-extensible
- [ ] Remove compile-time provider ID unions as the source of truth
  - Requirements: 4.1
  - [ ] Change config schema provider fields to `string` and validate using runtime registry in strict mode
  - [ ] Keep defaults as clerk/convex but do not hardcode lists that block extensions

### 7. Verification gates
- [ ] Add build/typecheck scenarios that prove decoupling
  - Requirements: 2.1, 2.2
  - [ ] Typecheck/build with Clerk removed (auth.provider != clerk)
  - [ ] Typecheck/build with Convex removed (sync/storage != convex)


## Phase 2 — Extract into installable provider packages

### 1. Create provider packages (repo or external)
- [ ] Create `or3-clerk` package
  - Requirements: 4.1
  - [ ] Expose Nuxt module that installs/configures `@clerk/nuxt`
  - [ ] Register server auth provider + middleware
  - [ ] Provide admin adapter for auth status

- [ ] Create `or3-convex` package
  - Requirements: 4.1, 4.2
  - [ ] Expose Nuxt module that installs/configures `convex-nuxt` and client wiring
  - [ ] Provide SyncProvider + StorageProvider adapters
  - [ ] Provide `AuthWorkspaceStore` adapter backed by Convex
  - [ ] Provide admin adapters for sync/storage

### 2. Solve Convex backend distribution
- [ ] Provide an init/generator workflow for Convex backend code
  - Requirements: 4.2
  - [ ] Add `bunx or3-convex init` to copy `convex/**` templates into host repo
  - [ ] Ensure Convex codegen (`convex/_generated/**`) runs in host repo, not inside core OR3 package

### 3. Remove provider code from core app
- [ ] Delete/migrate Convex/Clerk provider implementations from core
  - Requirements: 4.1
  - [ ] Core app only depends on provider registries + interfaces
  - [ ] Provider packages self-register via their Nuxt modules

### 4. Documentation
- [ ] Document how to swap providers (install/uninstall)
  - Requirements: 1.1, 1.2, 1.3
  - [ ] Provide a “no Convex” and “no Clerk” setup guide
