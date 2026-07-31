# Provider Decoupling - Quick Start Implementation Guide

**Based on**: requirements.md, design.md, tasks.md, implementation-guide.md  
**For**: OR3 Chat - Nuxt 4, TypeScript, Bun  
**Goal**: Enable core to build without provider SDKs installed

---

## TL;DR - What We're Doing

**Problem**: Core code directly imports `@clerk/nuxt`, `convex`, `convex-vue` in auto-included zones (`app/plugins`, `server/api`), causing build failures when those packages are removed.

**Solution**: 
1. Create registries for providers (auth, sync, storage, workspace)
2. Refactor core to dispatch through registries instead of importing SDKs
3. Extract provider implementations into Nuxt module packages
4. Use wizard-generated file to include only selected providers

**Result**: Core builds without provider SDKs; providers are true optional dependencies.

---

## Implementation Order (Critical Path)

### Phase 0: Setup (Days 1-2)
**Must complete first - sets up workspace**

1. Create package directories for providers
2. Create `or3.providers.generated.ts` (wizard will manage this)
3. Update `nuxt.config.ts` to import provider modules list
4. Audit current coupling (grep for provider imports)

**Deliverables**:
- `packages/or3-provider-{clerk,convex,localfs,sqlite}/` directories
- `or3.providers.generated.ts` file
- Coupling audit document

---

### Phase 1: Registries (Days 3-5)
**Core contracts - must exist before refactoring**

Create these 5 registries in order:

1. **AuthWorkspaceStore** (`server/auth/store/registry.ts`)
   - Maps provider identity → internal user/workspace
   - `registerAuthWorkspaceStore()`, `getActiveAuthWorkspaceStore()`

2. **ProviderTokenBroker** (`server/auth/token-broker/registry.ts`)
   - Mints provider tokens (Clerk → Convex auth)
   - `registerProviderTokenBroker()`, `getActiveProviderTokenBroker()`

3. **SyncGatewayAdapter** (`server/sync/gateway/registry.ts`)
   - Server-side sync backend (pull/push/cursor/GC)
   - `registerSyncGatewayAdapter()`, `getActiveSyncGatewayAdapter()`

4. **StorageGatewayAdapter** (`server/storage/gateway/registry.ts`)
   - Server-side storage backend (presign upload/download)
   - `registerStorageGatewayAdapter()`, `getActiveStorageGatewayAdapter()`

5. **WorkspaceApi** (`app/core/workspace/registry.ts`)
   - Client-side workspace CRUD interface
   - `registerWorkspaceApi()`, `useWorkspaceApi()`

**Key Pattern** (all registries follow this):
```typescript
const registry = new Map<string, Factory>();

export function registerX(item) {
  registry.set(item.id, item);
}

export function getActiveX(): X {
  const id = useRuntimeConfig().someProvider;
  const item = registry.get(id);
  if (!item) throw createError({ ... helpful message ... });
  return item.create();
}
```

**Deliverables**:
- 5 registry files with types
- No provider imports, just interfaces

---

### Phase 2: Refactor Core (Days 6-9)
**Remove SDK imports, use registries**

**Order matters** - do in this sequence:

1. **Session provisioning** (`server/auth/session.ts`)
   - Replace Convex user/workspace calls with `getActiveAuthWorkspaceStore()`
   - Keep exact failure modes

2. **Token minting** (all files with `getToken()`)
   - Replace Clerk `event.context.auth().getToken()` with `getActiveProviderTokenBroker().getProviderToken()`
   - Common locations: `server/api/sync/*.post.ts`, `server/api/storage/*.post.ts`

3. **Sync endpoints** (`server/api/sync/*.post.ts`)
   - Keep: auth, `can()`, validation, rate limiting
   - Replace: Convex client calls with `getActiveSyncGatewayAdapter().pull/push/...`
   - Remove: all Convex imports

4. **Storage endpoints** (`server/api/storage/*.post.ts`)
   - Same pattern as sync
   - Replace with `getActiveStorageGatewayAdapter().presignUpload/...`

5. **Workspace CRUD endpoints** (create new)
   - Create `/api/workspaces/list|create|update|remove|set-active`
   - All call `getActiveAuthWorkspaceStore()` methods
   - Note: May need to extend `AuthWorkspaceStore` interface with CRUD methods

6. **Workspace UI** (`app/plugins/workspaces/WorkspaceManager.vue`)
   - Remove `convex-vue` and `~~/convex/_generated/api` imports
   - Use `useWorkspaceApi().list/create/update/remove/setActive()`

7. **Client plugins**
   - Delete `app/plugins/convex-sync.client.ts` (moves to provider package)
   - Delete `app/plugins/convex-clerk.client.ts` (moves to provider package)
   - Create gateway storage provider plugin

8. **Dev/test pages**
   - Delete or move `app/pages/_tests/*` files with provider imports

**Deliverables**:
- Core endpoints dispatch to adapters
- Core UI uses WorkspaceApi
- No provider SDK imports in core hot zones

**Critical**: After each step, verify existing functionality still works

---

### Phase 3: Provider Packages (Days 10-14)
**Extract implementations into Nuxt modules**

**3.1 Clerk Provider** (`packages/or3-provider-clerk`)

Create Nuxt module that:
- Installs `@clerk/nuxt`
- Adds middleware (`00.clerk.ts`)
- Registers `AuthProvider` and `ProviderTokenBroker`

Files to create:
- `src/module.ts` (Nuxt module definition)
- `src/runtime/server/middleware/00.clerk.ts` (copy from core)
- `src/runtime/server/auth/clerk-auth-provider.ts` (copy from core)
- `src/runtime/server/auth/clerk-token-broker.ts` (new - wraps `getToken()`)
- `src/runtime/server/plugins/register.ts` (calls register functions)

**3.2 Convex Provider - Server** (`packages/or3-provider-convex`)

Create Nuxt module that:
- Installs `convex-nuxt`
- Registers `AuthWorkspaceStore`, `SyncGatewayAdapter`, `StorageGatewayAdapter`

Files to create:
- `src/module.ts`
- `src/runtime/server/store/convex-auth-workspace-store.ts` (move logic from `session.ts`)
- `src/runtime/server/sync/convex-sync-gateway-adapter.ts` (move logic from sync endpoints)
- `src/runtime/server/storage/convex-storage-gateway-adapter.ts` (move logic from storage endpoints)
- `src/runtime/server/plugins/register.ts`

**3.3 Convex Provider - Client** (same package)

Add client plugins to preserve realtime sync:
- `src/runtime/plugins/convex-sync.client.ts` (registers direct Convex sync provider)
- `src/runtime/plugins/convex-auth-bridge.client.ts` (bridges Clerk → Convex.setAuth)
- `src/runtime/sync/convex-sync-provider.ts` (move from `app/core/sync/providers/`)

**3.4 LocalFS Provider** (`packages/or3-provider-localfs`) - **Example/proof of concept**

Minimal storage provider:
- Presign returns internal upload/download endpoints with signed tokens
- Endpoints stream files to/from disk

Files:
- `src/module.ts`
- `src/runtime/server/storage/localfs-storage-adapter.ts` (implements `StorageGatewayAdapter`)
- `src/runtime/server/api/storage/localfs/upload.post.ts`
- `src/runtime/server/api/storage/localfs/download.get.ts`
- `src/runtime/server/plugins/register.ts`

**Deliverables**:
- 3 working provider packages
- Providers register implementations via Nitro plugins
- Core no longer has provider-specific code

---

### Phase 4: Cleanup & Verification (Days 15-17)
**Remove old code, prove it works**

1. **Delete provider code from core**:
   ```bash
   rm -rf server/auth/providers/clerk
   rm server/middleware/00.clerk.ts
   rm -rf server/utils/convex-client.ts
   rm -rf server/utils/sync/convex-gateway.ts
   rm -rf app/core/sync/providers/convex-sync-provider.ts
   ```

2. **Remove provider dependencies**:
   ```json
   // package.json - remove:
   "@clerk/nuxt", "convex", "convex-nuxt", "convex-vue"
   ```

3. **Move/delete** `convex/` directory (or document init workflow)

4. **Update config schemas**:
   - Change provider IDs from `z.enum([...])` to `z.string()`
   - Add startup validation plugin that checks registered providers

5. **Build verification**:
   ```bash
   # Test 1: No Clerk
   bun remove @clerk/nuxt
   # Update or3.providers.generated.ts to exclude Clerk
   bun run build && bun run type-check
   
   # Test 2: No Convex
   bun remove convex convex-nuxt convex-vue
   rm -rf convex/
   # Update or3.providers.generated.ts to exclude Convex
   bun run build && bun run type-check
   ```

6. **Functional verification**:
   - Test full auth → workspace → sync → storage flow
   - Verify realtime updates still work (Convex direct mode)
   - Test LocalFS provider

**Deliverables**:
- Core builds without provider SDKs
- All functionality verified working
- Test script for future verification

---

### Phase 5: Documentation (Days 18-19)

Create docs:
- `docs/providers/README.md` - Overview
- `docs/providers/creating-a-provider.md` - How to extend
- `packages/or3-provider-*/README.md` - Installation/usage
- `docs/migration/provider-decoupling.md` - Migration guide

---

## Critical Dependencies

```
Phase 0 (Setup)
  ↓
Phase 1 (Registries) ← MUST be complete before Phase 2
  ↓
Phase 2 (Refactor Core) ← MUST be complete before Phase 3
  ↓
Phase 3 (Provider Packages)
  ↓
Phase 4 (Verification)
  ↓
Phase 5 (Documentation)
```

**Within Phase 2**, order matters:
1. Session first (establishes pattern)
2. Token minting everywhere
3. Endpoints (sync, then storage)
4. Workspace endpoints
5. Workspace UI
6. Client plugins
7. Test pages

---

## Key Files to Create

### Phase 1 - Registries
- `server/auth/store/registry.ts`
- `server/auth/token-broker/types.ts`
- `server/auth/token-broker/registry.ts`
- `server/sync/gateway/types.ts`
- `server/sync/gateway/registry.ts`
- `server/storage/gateway/types.ts`
- `server/storage/gateway/registry.ts`
- `app/core/workspace/types.ts`
- `app/core/workspace/registry.ts`

### Phase 2 - Core Refactoring
- `server/api/workspaces/{list.get,create.post,update.post,remove.post,set-active.post}.ts`
- `app/core/workspace/gateway-workspace-api.ts`
- `app/plugins/01-workspace-api.client.ts`
- `app/core/storage/gateway-storage-provider.ts`
- `app/plugins/02-storage-gateway.client.ts`

### Phase 3 - Provider Packages
- `packages/or3-provider-clerk/src/module.ts`
- `packages/or3-provider-clerk/src/runtime/server/plugins/register.ts`
- `packages/or3-provider-convex/src/module.ts`
- `packages/or3-provider-convex/src/runtime/server/plugins/register.ts`
- `packages/or3-provider-convex/src/runtime/plugins/convex-sync.client.ts`
- `packages/or3-provider-localfs/src/module.ts`

### Phase 4 - Cleanup
- `server/plugins/00-validate-providers.ts` (startup validation)
- `scripts/test-decoupling.sh` (verification script)

---

## Key Files to Modify

### Phase 0
- `nuxt.config.ts` (import provider modules list)
- `.gitignore` (add `or3.providers.generated.ts`)

### Phase 2
- `server/auth/session.ts` (use AuthWorkspaceStore)
- `server/api/sync/pull.post.ts` (dispatch to adapter)
- `server/api/sync/push.post.ts` (dispatch to adapter)
- `server/api/sync/update-cursor.post.ts` (dispatch to adapter)
- `server/api/sync/gc-*.post.ts` (dispatch to adapters)
- `server/api/storage/presign-upload.post.ts` (dispatch to adapter)
- `server/api/storage/presign-download.post.ts` (dispatch to adapter)
- `server/api/storage/commit.post.ts` (dispatch to adapter)
- `app/plugins/workspaces/WorkspaceManager.vue` (use WorkspaceApi)

### Phase 4
- `shared/cloud/provider-ids.ts` (string instead of enum)
- `utils/or3-cloud-config.ts` (string instead of enum)
- `package.json` (remove provider deps)

---

## Key Files to Delete

### Phase 2
- `app/plugins/convex-sync.client.ts`
- `app/plugins/convex-clerk.client.ts`
- `app/pages/_tests/*` (files with provider imports)

### Phase 4
- `server/auth/providers/clerk/` directory
- `server/middleware/00.clerk.ts`
- `server/utils/convex-client.ts`
- `server/utils/sync/convex-gateway.ts`
- `server/admin/stores/convex/` directory
- `server/types/convex-http-client.d.ts`

---

## Gotchas & How to Avoid Them

### 1. Nuxt TypeScript Includes
**Problem**: Nuxt typecheck includes `modules/*/runtime/**/*`, so provider code under `modules/` will be typechecked even when "not selected".

**Solution**: Put provider packages under `packages/` (not `modules/`) or in `node_modules` (after proper packaging).

### 2. Dynamic Imports Don't Help Build
**Problem**: `await import('convex')` behind a runtime check still causes build failures if package is missing.

**Solution**: Use actual package boundaries (Nuxt modules). Only registered modules get included in build.

### 3. Registration Timing
**Problem**: Providers must register before first use, but Nuxt plugins run after app init.

**Solution**: Server-side registrations happen in Nitro plugins (run at startup). Client-side registrations happen in Nuxt plugins (before app mount).

### 4. Convex Realtime Sync
**Problem**: Gateway mode doesn't support realtime subscriptions.

**Solution**: Convex provider registers a "direct" sync provider that uses Convex SDK client for realtime updates. This is why the Convex provider includes client-side code.

### 5. AuthWorkspaceStore CRUD
**Problem**: Interface only has `getOrCreate*` methods, but we need full CRUD for workspace UI.

**Solution**: Extend interface in Phase 2, Step 5. Add methods:
- `createWorkspace()`
- `updateWorkspace()`
- `removeWorkspace()`
- `setActiveWorkspace()`

### 6. Token Minting Everywhere
**Problem**: Easy to miss a `getToken()` call.

**Solution**: Grep thoroughly:
```bash
grep -r "getToken" server/ | grep -v node_modules | grep -v ".test."
```

---

## Testing Strategy

### After Each Phase 1 Step
- Import registry in test file
- Register mock implementation
- Call `getActive*()` function
- Verify error handling for missing provider

### After Each Phase 2 Step
- Run existing endpoint/UI tests
- Verify behavior unchanged
- Check no provider imports remain

### After Phase 3
- Test each provider package independently
- Verify registrations happen
- Test full flow with each provider

### Phase 4 Verification
**Build Tests**:
- Remove Clerk → build succeeds
- Remove Convex → build succeeds
- Typecheck passes in both cases

**Functional Tests**:
- Auth flow works
- Workspace CRUD works
- Sync push/pull works
- Realtime updates work (Convex)
- Storage upload/download works
- Admin actions work

---

## Rollback Procedure

If something breaks:

1. **Immediate rollback** (restore functionality):
   ```bash
   git checkout HEAD -- or3.providers.generated.ts
   git checkout HEAD -- nuxt.config.ts
   bun install
   bun run build
   ```

2. **Phase-level rollback** (revert a phase):
   ```bash
   git revert <phase-commits>
   bun install
   bun run build
   ```

3. **Step-level rollback** (revert a step):
   ```bash
   git checkout HEAD -- <modified-files>
   # Test
   ```

**Prevention**: Commit after each step, tag after each phase.

---

## Success Checklist

### Build Requirements
- [ ] Core builds when `@clerk/nuxt` removed
- [ ] Core builds when `convex*` packages removed  
- [ ] Core builds when `convex/_generated/` absent
- [ ] Typecheck passes in all above configurations

### Code Requirements
- [ ] No provider imports in `app/pages/**`
- [ ] No provider imports in `app/plugins/**`
- [ ] No provider imports in `server/api/**`
- [ ] No provider imports in `server/middleware/**`
- [ ] No provider imports in `server/plugins/**`

### Functional Requirements
- [ ] Login/logout works
- [ ] Session provisioning works
- [ ] Workspace list/create/update/delete works
- [ ] Sync push/pull works
- [ ] Realtime updates work (Convex direct mode)
- [ ] Storage upload/download works
- [ ] Admin actions work
- [ ] Token minting works (via broker)

### Extensibility Proof
- [ ] LocalFS storage provider works
- [ ] Can add new provider without editing core
- [ ] Provider registration fails gracefully with helpful error

---

## Next Steps

1. **Review this plan** with the team
2. **Create GitHub issues** for each phase
3. **Assign ownership** of phases
4. **Set up branch strategy** (feature branches per phase?)
5. **Start Phase 0** (non-breaking setup work)

---

## Quick Reference - Registry Pattern

All registries follow this pattern:

```typescript
// types.ts
export interface X {
  id: string;
  someMethod(...): Promise<...>;
}

// registry.ts
import type { X } from './types';

export type XFactory = () => X;
export interface XRegistryItem {
  id: string;
  order?: number;
  create: XFactory;
}

const registry = new Map<string, XRegistryItem>();

export function registerX(item: XRegistryItem): void {
  registry.set(item.id, item);
}

export function getX(id: string): X | null {
  const item = registry.get(id);
  return item ? item.create() : null;
}

export function getActiveX(): X {
  const config = useRuntimeConfig();
  const id = config.someProvider; // e.g., config.auth.provider
  const x = getX(id);
  
  if (!x) {
    throw createError({
      statusCode: 500,
      statusMessage: `X '${id}' not registered. Install: or3-provider-${id}`,
    });
  }
  
  return x;
}
```

Providers register via Nitro/Nuxt plugins:

```typescript
// Provider's runtime/server/plugins/register.ts or runtime/plugins/register.client.ts
import { registerX } from '~~/path/to/registry';
import { myXImplementation } from '../somewhere';

export default defineNitroPlugin(() => {  // or defineNuxtPlugin for client
  registerX({
    id: 'my-provider',
    create: () => myXImplementation,
  });
});
```

---

**Last Updated**: 2024-02-04  
**Status**: Ready for implementation  
**Estimated Completion**: 13-19 days (2-4 weeks)

