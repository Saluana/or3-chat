# Provider Decoupling - Visual Implementation Flow

This document provides visual representations of the implementation flow and architecture.

---

## Implementation Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                     PHASE 0: SETUP                           │
│  • Create package directories                                │
│  • Create or3.providers.generated.ts                         │
│  • Update nuxt.config.ts                                     │
│  • Audit coupling                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  PHASE 1: REGISTRIES                         │
│  1. AuthWorkspaceStore registry     (server)                │
│  2. ProviderTokenBroker registry    (server)                │
│  3. SyncGatewayAdapter registry     (server)                │
│  4. StorageGatewayAdapter registry  (server)                │
│  5. WorkspaceApi interface          (client)                │
└──────────────────────┬──────────────────────────────────────┘
                       │ ◀── MUST COMPLETE BEFORE PHASE 2
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               PHASE 2: REFACTOR CORE                         │
│  1. Session → AuthWorkspaceStore                            │
│  2. Token minting → ProviderTokenBroker                     │
│  3. Sync endpoints → SyncGatewayAdapter                     │
│  4. Storage endpoints → StorageGatewayAdapter               │
│  5. Workspace endpoints (new)                               │
│  6. Workspace UI → WorkspaceApi                             │
│  7. Client plugins (gateway mode)                           │
│  8. Handle test pages                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ ◀── MUST COMPLETE BEFORE PHASE 3
                       ▼
┌─────────────────────────────────────────────────────────────┐
│             PHASE 3: PROVIDER PACKAGES                       │
│  • Clerk provider (Nuxt module)                             │
│  • Convex provider (Nuxt module, server + client)           │
│  • LocalFS provider (example)                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         PHASE 4: CLEANUP & VERIFICATION                      │
│  • Delete provider code from core                           │
│  • Remove dependencies                                      │
│  • Update config schemas                                    │
│  • Build matrix tests                                       │
│  • Functional tests                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              PHASE 5: DOCUMENTATION                          │
│  • Provider system docs                                     │
│  • Creating a provider guide                                │
│  • Migration guide                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture: Before vs After

### BEFORE (Tightly Coupled)

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE CODEBASE                             │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  app/plugins/convex-sync.client.ts          │             │
│  │    import { useConvex } from 'convex-vue'  │  ◀── BREAKS │
│  │    import { api } from '~~/convex/_gen'    │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  server/api/sync/pull.post.ts              │             │
│  │    import { ConvexHttpClient }             │  ◀── BREAKS │
│  │    import { api } from '~~/convex/_gen'    │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  server/middleware/00.clerk.ts             │             │
│  │    import { clerkMiddleware }              │  ◀── BREAKS │
│  └────────────────────────────────────────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
          ❌ Cannot build without providers installed
```

### AFTER (Decoupled)

```
┌─────────────────────────────────────────────────────────────┐
│                 CORE CODEBASE (Provider-Agnostic)            │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  app/core/workspace/registry.ts            │             │
│  │    export function useWorkspaceApi() { }   │  ✅ No SDK │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  server/api/sync/pull.post.ts              │             │
│  │    const adapter = getActiveSyncAdapter()  │  ✅ No SDK │
│  │    return adapter.pull(event, body)        │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  server/sync/gateway/registry.ts           │             │
│  │    const adapters = new Map()              │  ✅ No SDK │
│  │    export function registerAdapter() { }   │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Dispatches to registered adapters
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌───────────────┐ ┌──────────────┐ ┌──────────────┐
│ or3-provider- │ │ or3-provider-│ │ or3-provider-│
│    clerk      │ │   convex     │ │   localfs    │
│               │ │              │ │              │
│ • Imports SDK │ │ • Imports SDK│ │ • No SDK     │
│ • Registers   │ │ • Registers  │ │ • Registers  │
│   adapters    │ │   adapters   │ │   adapter    │
└───────────────┘ └──────────────┘ └──────────────┘

          ✅ Core builds without providers
          ✅ Providers are optional dependencies
          ✅ Wizard selects which to install
```

---

## Request Flow: Sync Example

### BEFORE

```
Client Request
     │
     ▼
server/api/sync/pull.post.ts
     │
     │ import { ConvexHttpClient } from 'convex/browser'
     │ import { api } from '~~/convex/_generated/api'
     │
     ▼
ConvexHttpClient.query(api.sync.pull, ...)
     │
     ▼
Convex Backend
```

**Problem**: If Convex packages removed, `import` fails at build time.

### AFTER

```
Client Request
     │
     ▼
server/api/sync/pull.post.ts
     │
     │ const adapter = getActiveSyncGatewayAdapter()
     │ return adapter.pull(event, body)
     │
     ▼
Registry Lookup (config.sync.provider = 'convex')
     │
     ▼
or3-provider-convex
     │
     │ runtime/server/sync/convex-sync-gateway-adapter.ts
     │   • import ConvexHttpClient
     │   • import api from '~~/convex/_generated/api'
     │   • call ConvexHttpClient.query(api.sync.pull, ...)
     │
     ▼
Convex Backend
```

**Result**: 
- Core has no Convex imports
- If provider not installed, registry throws helpful error at startup
- Core builds without Convex packages

---

## Registry Pattern Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  PROVIDER PACKAGE                            │
│  (or3-provider-convex)                                       │
│                                                              │
│  runtime/server/plugins/register.ts                         │
│  ┌────────────────────────────────────────┐                 │
│  │ export default defineNitroPlugin(() => │                 │
│  │   registerSyncGatewayAdapter({         │                 │
│  │     id: 'convex',                      │                 │
│  │     create: () => convexAdapter        │                 │
│  │   })                                   │                 │
│  │ })                                     │                 │
│  └────────────────────────────────────────┘                 │
│                       │                                      │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        │ Nitro plugin runs at startup
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     CORE REGISTRY                            │
│  server/sync/gateway/registry.ts                            │
│                                                              │
│  const adapters = new Map<string, Adapter>()                │
│                                                              │
│  registerSyncGatewayAdapter({ id, create }) {               │
│    adapters.set(id, { id, create })  ◀────── Stores adapter │
│  }                                                           │
│                                                              │
│  getActiveSyncGatewayAdapter() {                            │
│    const id = config.sync.provider  ◀────────── 'convex'    │
│    const item = adapters.get(id)                            │
│    if (!item) throw Error('Not registered')                 │
│    return item.create()  ◀────────────────── Returns impl   │
│  }                                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Endpoint calls
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           server/api/sync/pull.post.ts                       │
│                                                              │
│  const adapter = getActiveSyncGatewayAdapter()              │
│  return adapter.pull(event, body)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 2 Refactoring Order (Critical)

```
Step 1: Session Provisioning
server/auth/session.ts
    OLD: const user = await convexClient.mutation(api.users.getOrCreate, ...)
    NEW: const store = getActiveAuthWorkspaceStore()
         const { userId } = await store.getOrCreateUser(...)
         
         ↓ Establishes pattern
         
Step 2: Token Minting (all files)
server/api/sync/*.post.ts
server/api/storage/*.post.ts
server/utils/**/*.ts
    OLD: const token = await event.context.auth().getToken(...)
    NEW: const broker = getActiveProviderTokenBroker()
         const token = await broker.getProviderToken(event, ...)
         
         ↓ Removes Clerk coupling
         
Step 3: Sync Endpoints
server/api/sync/pull.post.ts
server/api/sync/push.post.ts
server/api/sync/update-cursor.post.ts
server/api/sync/gc-*.post.ts
    KEEP: auth, can(), validation, rate limiting
    REPLACE: ConvexHttpClient calls
    WITH: adapter.pull/push/updateCursor/gc*()
    REMOVE: all Convex imports
    
         ↓ Proves dispatch pattern
         
Step 4: Storage Endpoints
server/api/storage/presign-upload.post.ts
server/api/storage/presign-download.post.ts
server/api/storage/commit.post.ts
    Same pattern as sync
    
         ↓ Storage gateway works
         
Step 5: Workspace CRUD Endpoints (NEW)
server/api/workspaces/list.get.ts
server/api/workspaces/create.post.ts
server/api/workspaces/update.post.ts
server/api/workspaces/remove.post.ts
server/api/workspaces/set-active.post.ts
    CREATE these endpoints
    CALL: getActiveAuthWorkspaceStore() methods
    
         ↓ Enables step 6
         
Step 6: Workspace UI
app/plugins/workspaces/WorkspaceManager.vue
    REMOVE: convex-vue imports
    REMOVE: ~~/convex/_generated/api imports
    USE: useWorkspaceApi()
    
         ↓ UI decoupled
         
Step 7: Client Plugins
app/plugins/convex-sync.client.ts → DELETE
app/plugins/convex-clerk.client.ts → DELETE
app/plugins/02-storage-gateway.client.ts → CREATE
    CREATE gateway storage provider
    REGISTER via core plugin
    
         ↓ Client decoupled
         
Step 8: Dev/Test Pages
app/pages/_tests/**/*.vue
    DELETE or MOVE files with provider imports
    
         ↓ Core build succeeds
```

**Key**: Each step enables the next. Don't skip or reorder.

---

## File Organization: Before vs After

### BEFORE

```
project-root/
├── app/
│   ├── plugins/
│   │   ├── convex-sync.client.ts        ❌ Imports convex-vue
│   │   ├── convex-clerk.client.ts       ❌ Imports convex-vue, Clerk
│   │   └── workspaces/
│   │       └── WorkspaceManager.vue     ❌ Imports convex-vue
│   └── pages/
│       └── _tests/
│           └── test-sync.vue            ❌ Imports convex-vue
├── server/
│   ├── api/
│   │   ├── sync/
│   │   │   └── pull.post.ts             ❌ Imports Convex
│   │   └── storage/
│   │       └── presign-upload.post.ts   ❌ Imports Convex
│   ├── middleware/
│   │   └── 00.clerk.ts                  ❌ Imports Clerk
│   ├── auth/
│   │   └── session.ts                   ❌ Imports Convex
│   └── utils/
│       └── convex-client.ts             ❌ Imports Convex
├── convex/                              ❌ Required for types
└── package.json
    └── dependencies:
        ├── "@clerk/nuxt"                ❌ Always installed
        ├── "convex"                     ❌ Always installed
        ├── "convex-nuxt"                ❌ Always installed
        └── "convex-vue"                 ❌ Always installed
```

### AFTER

```
project-root/
├── app/
│   ├── core/
│   │   ├── workspace/
│   │   │   ├── types.ts                 ✅ Interface only
│   │   │   ├── registry.ts              ✅ No imports
│   │   │   └── gateway-workspace-api.ts ✅ Calls /api/workspaces/*
│   │   ├── sync/
│   │   │   └── sync-provider-registry.ts ✅ Already exists
│   │   └── storage/
│   │       ├── provider-registry.ts     ✅ Already exists
│   │       └── gateway-storage-provider.ts ✅ Calls /api/storage/*
│   ├── plugins/
│   │   ├── 01-workspace-api.client.ts   ✅ Registers gateway API
│   │   └── 02-storage-gateway.client.ts ✅ Registers gateway storage
│   └── pages/
│       └── _tests/                      ✅ No provider imports
├── server/
│   ├── api/
│   │   ├── sync/
│   │   │   └── pull.post.ts             ✅ Dispatches to adapter
│   │   ├── storage/
│   │   │   └── presign-upload.post.ts   ✅ Dispatches to adapter
│   │   └── workspaces/
│   │       ├── list.get.ts              ✅ NEW
│   │       └── create.post.ts           ✅ NEW
│   ├── auth/
│   │   ├── session.ts                   ✅ Uses AuthWorkspaceStore
│   │   ├── store/
│   │   │   ├── types.ts                 ✅ Interface only
│   │   │   └── registry.ts              ✅ NEW
│   │   └── token-broker/
│   │       ├── types.ts                 ✅ NEW
│   │       └── registry.ts              ✅ NEW
│   ├── sync/
│   │   └── gateway/
│   │       ├── types.ts                 ✅ NEW
│   │       └── registry.ts              ✅ NEW
│   └── storage/
│       └── gateway/
│           ├── types.ts                 ✅ NEW
│           └── registry.ts              ✅ NEW
├── packages/                            ✅ NEW
│   ├── or3-provider-clerk/
│   │   ├── package.json                 ✅ Has @clerk/nuxt dep
│   │   └── src/
│   │       ├── module.ts                ✅ Nuxt module
│   │       └── runtime/
│   │           └── server/
│   │               ├── middleware/
│   │               │   └── 00.clerk.ts  ✅ Moved here
│   │               ├── auth/
│   │               │   ├── clerk-auth-provider.ts
│   │               │   └── clerk-token-broker.ts
│   │               └── plugins/
│   │                   └── register.ts  ✅ Calls registry
│   ├── or3-provider-convex/
│   │   ├── package.json                 ✅ Has convex deps
│   │   └── src/
│   │       ├── module.ts
│   │       └── runtime/
│   │           ├── plugins/
│   │           │   ├── convex-sync.client.ts     ✅ Moved here
│   │           │   └── convex-auth-bridge.client.ts
│   │           ├── sync/
│   │           │   └── convex-sync-provider.ts   ✅ Moved here
│   │           └── server/
│   │               ├── store/
│   │               │   └── convex-auth-workspace-store.ts
│   │               ├── sync/
│   │               │   └── convex-sync-gateway-adapter.ts
│   │               ├── storage/
│   │               │   └── convex-storage-gateway-adapter.ts
│   │               └── plugins/
│   │                   └── register.ts
│   └── or3-provider-localfs/
│       ├── package.json                 ✅ No external deps
│       └── src/
│           ├── module.ts
│           └── runtime/
│               └── server/
│                   ├── storage/
│                   │   └── localfs-storage-adapter.ts
│                   ├── api/
│                   │   └── storage/
│                   │       └── localfs/
│                   │           ├── upload.post.ts
│                   │           └── download.get.ts
│                   └── plugins/
│                       └── register.ts
├── or3.providers.generated.ts           ✅ NEW (wizard-managed)
└── package.json
    └── dependencies:                    ✅ NO provider SDKs in core!
```

---

## Testing Flow

```
┌─────────────────────────────────────────────────────────────┐
│         After Each Phase 1 Step (Registry)                  │
│                                                              │
│  1. Import registry                                         │
│  2. Register mock implementation                            │
│  3. Call getActive*()                                       │
│  4. Verify error handling for missing provider              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         After Each Phase 2 Step (Refactor)                  │
│                                                              │
│  1. Run existing tests (should still pass)                  │
│  2. Manual test affected functionality                      │
│  3. Verify no provider imports remain                       │
│  4. git commit                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           After Phase 3 (Provider Packages)                 │
│                                                              │
│  1. Test each provider package independently                │
│  2. Verify registrations happen                             │
│  3. Test full flow with each provider                       │
│  4. Test provider combinations                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            Phase 4: Build Verification                      │
│                                                              │
│  Test 1: Remove @clerk/nuxt                                 │
│    bun remove @clerk/nuxt                                   │
│    Update or3.providers.generated.ts                        │
│    bun run build  ✅ Should succeed                         │
│    bun run type-check  ✅ Should succeed                    │
│                                                              │
│  Test 2: Remove convex packages                             │
│    bun remove convex convex-nuxt convex-vue                 │
│    rm -rf convex/                                           │
│    Update or3.providers.generated.ts                        │
│    bun run build  ✅ Should succeed                         │
│    bun run type-check  ✅ Should succeed                    │
│                                                              │
│  Test 3: Both removed                                       │
│    (Ensure no surfaces configured to use them)              │
│    bun run build  ✅ Should succeed                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│          Phase 4: Functional Verification                   │
│                                                              │
│  With Default Stack (Clerk + Convex):                       │
│    □ Login/logout                                           │
│    □ Session provisioning                                   │
│    □ Workspace list/create/update/delete                    │
│    □ Sync push/pull                                         │
│    □ Realtime updates                                       │
│    □ Storage upload/download                                │
│    □ Admin actions                                          │
│                                                              │
│  With Alternative Providers:                                │
│    □ LocalFS storage                                        │
│    □ Gateway sync mode                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Common Pitfalls & Solutions

### Pitfall 1: "I moved the code but it still won't build"

**Symptom**: Build fails with "Cannot find module 'convex'" even though you moved the file.

**Cause**: Another file still imports it, or it's in an auto-included zone.

**Solution**:
```bash
# Find ALL imports
grep -r "from 'convex" app/ server/ --exclude-dir=node_modules
grep -r "from '~~/convex" app/ server/ --exclude-dir=node_modules

# Check hot zones specifically
grep -r "convex\|clerk" app/pages app/plugins server/api server/middleware server/plugins
```

### Pitfall 2: "Dynamic import still breaks build"

**Symptom**:
```typescript
if (config.sync.provider === 'convex') {
  const { useConvex } = await import('convex-vue');  // Still breaks!
}
```

**Cause**: Vite/TypeScript resolve imports at build time, not runtime.

**Solution**: Move to provider package (Nuxt module). Only registered modules are included.

### Pitfall 3: "Provider registers but throws 'not found' error"

**Symptom**: Registration plugin runs, but `getActive*()` throws "not registered".

**Cause**: Registration timing - provider plugin runs after first usage attempt.

**Solution**: 
- Server: Use Nitro plugins (run at startup) not event handlers
- Client: Use Nuxt plugins (run before app mount) not inline code

### Pitfall 4: "Convex realtime stopped working"

**Symptom**: Push/pull works, but live updates don't.

**Cause**: Using gateway sync provider instead of direct Convex client.

**Solution**: Convex provider must register a "direct" sync provider that uses Convex SDK for subscriptions. This is why Phase 3.3 includes client-side plugins.

### Pitfall 5: "TypeScript errors in provider package"

**Symptom**: `Cannot find module '~~/server/auth/registry'` in provider package.

**Cause**: Provider package doesn't have access to core types during development.

**Solution**: 
- Provider packages are peer dependencies - they resolve core types at runtime
- For development, link provider package: `bun link` in provider dir, `bun link or3-provider-X` in core
- Or use workspace setup: `workspaces: ["packages/*"]` in root package.json

---

**Last Updated**: 2024-02-04  
**Related**: See QUICK_START_GUIDE.md for detailed instructions

