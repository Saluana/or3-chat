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

---

## 17) Phase 3 assumes Bun-specific build commands that don't work as specified

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:47-49`

**Snippet**:
```json
"scripts": {
  "build": "bun build src/index.ts --outdir=dist --target=node",
  "typecheck": "tsc --noEmit"
}
```

**Why this is bad**:
The `bun build` command shown here doesn't emit TypeScript declaration files (`.d.ts`), but line 34 explicitly requires `"types": "./dist/index.d.ts"`. This means your package will claim to have types but won't actually ship them, breaking TypeScript consumers. You'll either get type resolution failures or packages silently falling back to `any`.

**Real-world consequences**:
1. Package consumers get no TypeScript intellisense or type safety
2. Type-aware bundlers like tsup or esbuild will throw errors about missing declaration files
3. Monorepo tooling (like TypeScript project references) will fail to resolve types
4. You'll waste hours debugging why "it works locally" but breaks in CI/CD

**Suggested fix**:
Use `tsup` or `tsc` for building packages that need type declarations:
```json
"scripts": {
  "build": "tsup src/index.ts --format esm --dts --clean",
  "typecheck": "tsc --noEmit"
},
"devDependencies": {
  "tsup": "^8.0.0"
}
```

Or if you must use Bun:
```json
"scripts": {
  "build": "bun build src/index.ts --outdir=dist --target=node && tsc --declaration --emitDeclarationOnly --outDir dist",
  "typecheck": "tsc --noEmit"
}
```

---

## 18) Clerk token broker uses a fictional API that doesn't exist

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:156-176`

**Snippet**:
```typescript
const token = await clerkClient.users.getUserOauthAccessToken(
  userId,
  template
);
```

**Why this is bad**:
There is no `getUserOauthAccessToken` method in the Clerk SDK. The actual method for getting provider tokens is `clerkClient.users.getUserOauthAccessToken(userId, provider)`, but more importantly, this is for **OAuth access tokens** (like GitHub/Google tokens), NOT for minting custom JWTs to authenticate with your own backends like Convex.

For Convex integration, you need to use Clerk's JWT templates with session tokens, not OAuth tokens. The actual implementation would use `auth().getToken({ template: 'convex' })` in middleware/API routes, or `clerkClient.sessions.getToken()` for admin operations.

**Real-world consequences**:
1. Code won't compile - method doesn't exist
2. Even if you fix the method name, it won't return the right kind of token for Convex
3. Implementer wastes hours reading Clerk docs trying to figure out what you meant
4. Security risk: might accidentally expose actual OAuth tokens instead of scoped JWTs

**Suggested fix**:
```typescript
// packages/or3-provider-clerk/src/token-broker.ts
import type { ProviderTokenBroker } from '~/server/auth/token-broker/types';
import { auth } from '@clerk/nuxt/server';

export function createClerkTokenBroker(): ProviderTokenBroker {
  return {
    async getProviderToken(event, req) {
      const { getToken } = auth(event);
      
      // Use Clerk JWT templates to mint provider-specific tokens
      // Template must be configured in Clerk Dashboard
      const template = req.template || req.providerId;
      const token = await getToken({ template });
      
      return token;
    },
  };
}
```

---

## 19) Phase 3 requires moving files that don't exist yet

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:56-65`

**Instructions**:
```
- [ ] Move `server/auth/store/impls/convex-auth-workspace-store.ts` → `packages/or3-provider-convex/src/auth-workspace-store.ts`
```

**Why this is bad**:
You're telling implementers to move `server/auth/store/impls/convex-auth-workspace-store.ts` to the package, but the file currently exists (confirmed) and is actively being imported by `server/plugins/00.register-providers.ts`. However, the bigger issue is that the `AuthWorkspaceStore` interface in `server/auth/store/types.ts` does NOT have any of the CRUD methods you defined in Phase 4 (lines 28-46).

This creates a circular dependency problem:
- Phase 3 wants to extract the implementation
- Phase 4 wants to extend the interface
- But Phase 3 "completes" without the extended interface
- So Phase 4 has to modify code in a package that was "finalized" in Phase 3

**Real-world consequences**:
1. Phase 3 completion is meaningless because Phase 4 immediately breaks it
2. Package versioning hell: do you bump major version after Phase 4?
3. Implementer confusion: "Wait, I just moved this, now I have to edit it again?"
4. Wasted effort: should have just done it right the first time

**Suggested fix**:
Move task 4.1.1 (extending AuthWorkspaceStore interface) into Phase 3.1.2, BEFORE moving the files. Update the interface first, then implement the new methods in the Convex adapter, THEN move everything to the package as a complete, working implementation.

---

## 20) Package structure uses tilde imports that will break outside monorepo

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:95-105`

**Snippet**:
```typescript
// Re-export types from core (for convenience)
export type { AuthWorkspaceStore } from '~/server/auth/store/types';
export type { SyncGatewayAdapter } from '~/server/sync/gateway/types';
export type { StorageGatewayAdapter } from '~/server/storage/gateway/types';
```

**Why this is bad**:
The tilde alias (`~`) is a Nuxt-specific path resolution that only works inside the main Nuxt app. It's configured in the root `nuxt.config.ts` and is NOT available in workspace packages by default. When you try to build the package, TypeScript will fail with "Cannot find module '~/server/...'".

Even if you could make it work in the monorepo (by configuring paths in the package's tsconfig), the package becomes fundamentally broken for external consumers. If someone runs `npm install or3-provider-convex` in a different project, the `~` alias doesn't exist and all type imports fail.

**Real-world consequences**:
1. Package build fails immediately with cryptic TypeScript errors
2. Even if you hack it to build, published package is broken for all consumers
3. Type imports resolve to `any`, defeating the entire purpose of TypeScript
4. No one can use your packages outside the monorepo (kills third-party provider goal)

**Suggested fix**:
Use relative imports in the package `index.ts`, and import core types from a published `or3-core-types` package:

```typescript
// Option 1: Relative imports from a shared types package
export type { AuthWorkspaceStore } from '@or3-chat/core-types/auth';
export type { SyncGatewayAdapter } from '@or3-chat/core-types/sync';
export type { StorageGatewayAdapter } from '@or3-chat/core-types/storage';

// Option 2: Duplicate the minimal type interfaces in the provider package
// (if types are small and stable)
export interface AuthWorkspaceStore {
  // ... minimal interface needed by provider
}
```

Or restructure as a true monorepo with published `@or3-chat/core` package that providers depend on via `peerDependencies`.

---

## 21) Phase 3 completion criteria include impossible requirement

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:386-400`

**Success criteria**:
```
2. ✅ Core builds without any providers installed
3. ✅ Core builds with only Convex installed
4. ✅ Core builds with only Clerk installed
```

**Why this is bad**:
You literally cannot have "Core builds with only Clerk installed" because Clerk is not a sync or storage provider. Clerk is an auth provider, and your architecture requires BOTH auth AND sync/storage to function. Looking at `config.or3cloud.ts` and runtime config, SSR auth requires workspace resolution, which requires a sync provider to fetch workspace data.

Even worse, criteria #2 "Core builds without any providers installed" conflicts with the entire application architecture. Without providers:
- No AuthWorkspaceStore = session resolution fails
- No SyncGatewayAdapter = /api/sync/* endpoints return 500
- No StorageGatewayAdapter = file uploads crash
- The app is a non-functional shell

**Real-world consequences**:
1. Implementer wastes time trying to make impossible scenarios work
2. Creates false sense of "decoupling" when app actually requires providers
3. Testing burden explodes trying to cover scenarios that will never exist in production
4. CI/CD build matrix (lines 356-382) wastes resources on nonsense configurations

**Suggested fix**:
Be honest about what's actually required and what's optional:

```markdown
## Success Criteria

Phase 3 is complete when:

1. ✅ Both provider packages build successfully
2. ✅ Core builds with Convex + Clerk providers installed (baseline config)
3. ✅ Core builds with alternative combinations (e.g., Convex + alternative auth)
4. ✅ Adapters can be swapped at runtime without code changes
5. ✅ No provider SDK imports in core code (except gated plugins)
6. ✅ Documentation clearly states minimum provider requirements
```

And update the build matrix to test realistic combinations:
```yaml
matrix:
  providers:
    - convex-clerk      # Production configuration
    - convex-supabase   # Alternative auth (if implemented)
    # NOT: "none" or "clerk-only" - these don't make sense
```

---

## 22) Nuxt module registration pattern has critical security flaw

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:68-93`

**Snippet**:
```typescript
export default defineNuxtModule({
  setup(options, nuxt) {
    // Add server plugin to register adapters
    nuxt.hook('nitro:config', (config) => {
      config.plugins = config.plugins || [];
      config.plugins.push(resolver.resolve('./server-plugin.ts'));
    });
  },
});
```

And then in server-plugin.ts:
```typescript
- Only register if SSR auth is enabled
```

**Why this is bad**:
The Nuxt module unconditionally adds the server plugin to Nitro, but then the plugin itself checks if SSR auth is enabled. This means:

1. The plugin code is bundled into the Nitro server even when SSR auth is disabled
2. Provider dependencies are included in the bundle even if not used
3. The "optional" dependency isn't actually optional at build time

The whole point of provider packages was to make them installable/uninstallable. But if the module always registers the plugin, the provider SDK becomes a build dependency regardless of runtime config.

**Real-world consequences**:
1. "Optional" providers aren't actually optional - bundle size never decreases
2. Security risk: disabled features still ship code to production
3. Can't uninstall provider package without breaking server build
4. Bundle analysis shows unused code (fails treeshaking audits)

**Suggested fix**:
Check the config in the module setup, not in the plugin:

```typescript
export default defineNuxtModule({
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);
    
    // Only register plugin if SSR auth is enabled
    nuxt.hook('nitro:config', (config) => {
      const ssrAuthEnabled = nuxt.options.runtimeConfig.ssrAuthEnabled;
      
      if (!ssrAuthEnabled) {
        console.log('[or3-provider-convex] Skipping - SSR auth disabled');
        return;
      }
      
      config.plugins = config.plugins || [];
      config.plugins.push(resolver.resolve('./server-plugin.ts'));
    });
  },
});
```

---

## 23) JSON code blocks in markdown are presented as valid package.json but contain invalid syntax

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:27-51`

**Snippet**:
```json
{
  "name": "or3-provider-convex",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./nuxt": "./dist/nuxt.js"
  },
```

**Why this is bad**:
The `exports` field uses `.js` extensions, but modern Nuxt/Nitro with `"type": "module"` and TypeScript will try to import `./dist/nuxt.js` literally. If your build outputs `nuxt.ts` or if the Nuxt module needs to be `.mjs` or `.mts`, this will cause import failures.

More critically, you're missing the `types` condition in exports, which means TypeScript won't find the declaration files:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./nuxt": {
    "types": "./dist/nuxt.d.ts",
    "import": "./dist/nuxt.js"
  }
}
```

**Real-world consequences**:
1. TypeScript consumers get `Could not find declaration file` errors
2. IDE autocomplete doesn't work
3. Package looks unprofessional (fails `publint` and `arethetypeswrong` checks)
4. Rollup/Vite might fail to resolve the nuxt module

**Suggested fix**:
```json
{
  "name": "or3-provider-convex",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./nuxt": {
      "types": "./dist/nuxt.d.ts",
      "import": "./dist/nuxt.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup src/index.ts src/nuxt.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "bun run build"
  }
}
```

---

## 24) Phase 3 deletes temporary code before Phase 4 extends the interfaces it needs

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:246-252`

**Task 3.3.3**:
```markdown
- [ ] Delete `server/plugins/00.register-providers.ts` (no longer needed)
- [ ] Delete `server/auth/store/impls/` directory (moved to package)
- [ ] Delete `server/sync/gateway/impls/` directory (moved to package)
- [ ] Delete `server/storage/gateway/impls/` directory (moved to package)
```

**Why this is bad**:
You're telling implementers to delete `server/auth/store/impls/convex-auth-workspace-store.ts` in Phase 3.3.3, but Phase 4.1.3 says:

> "Implement new CRUD methods in `ConvexAuthWorkspaceStore` (or package if Phase 3 done)"

So where the hell is the implementer supposed to add these methods? The file was deleted. Now they have to:
1. Navigate into `packages/or3-provider-convex/`
2. Edit the package code
3. Rebuild the package
4. Hope the workspace dependency resolution works
5. Deal with potential version conflicts

This is classic premature cleanup. You're optimizing for "clean git history" over "working code at each phase".

**Real-world consequences**:
1. Phase 4 can't be completed without reopening Phase 3 work
2. Git history becomes confusing (delete file, then add similar file in package)
3. Implementer has to context-switch between core and package codebases
4. Testing becomes harder (can't easily run phase 3 + phase 4 code side-by-side)
5. Rollback plan (line 404) doesn't work because files are gone

**Suggested fix**:
Change Phase 3.3.3 to:
```markdown
#### 3.3.3: Mark Temporary Code for Deletion
- [ ] Add comments to `server/plugins/00.register-providers.ts`: 
    `// TODO Phase 4: Delete this file after workspace endpoints complete`
- [ ] Keep implementation directories until Phase 4 verification passes
- [ ] Document in PHASE_3_COMPLETION.md which files are ready for deletion
```

Then in Phase 4.5 (after all endpoints work), add:
```markdown
#### 4.5.6: Clean Up Temporary Code
- [ ] Verify all Phase 4 tests pass
- [ ] Delete `server/plugins/00.register-providers.ts`
- [ ] Delete `server/auth/store/impls/` directory
- [ ] Run full test suite to confirm nothing broke
```

---

## 25) Workspace API type definitions don't match the interface being implemented

**File**: `planning/provider-decoupling/PHASE_4_TASKS.md:26-60`

**Defined interface** (Phase 4):
```typescript
export interface AuthWorkspaceStore {
  listWorkspaces(userId: string): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  getActiveWorkspace(userId: string): Promise<string | null>;
  setActiveWorkspace(userId: string, workspaceId: string): Promise<void>;
  // ...
}
```

**Existing interface** (from `app/core/workspace/types.ts`):
```typescript
export interface WorkspaceApi {
  list(): Promise<WorkspaceSummary[]>;
  create(input: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse>;
  update(input: UpdateWorkspaceRequest): Promise<void>;
  remove(input: RemoveWorkspaceRequest): Promise<void>;
  setActive(input: SetActiveWorkspaceRequest): Promise<void>;
}
```

**Why this is bad**:
You're defining TWO completely different interfaces for the same operations:
1. `AuthWorkspaceStore` on the server (Phase 4.1.1) with methods like `createWorkspace(input: CreateWorkspaceInput)`
2. `WorkspaceApi` on the client (already exists) with methods like `create(input: CreateWorkspaceRequest)`

The type names are different (`CreateWorkspaceInput` vs `CreateWorkspaceRequest`), the return types are different (`Workspace` vs `CreateWorkspaceResponse`), and the method signatures don't align. This means your server endpoints will have to do awkward type mapping between the store and the API.

**Real-world consequences**:
1. Impedance mismatch: server uses `Workspace` type, client uses `WorkspaceSummary`
2. Endpoint code becomes type gymnastics (lines 176-216 in Phase 4)
3. Can't DRY up shared validation logic (different input types)
4. OpenAPI/tRPC code generation becomes impossible (conflicting schemas)
5. Bug farm: easy to forget to map a field and silently drop data

**Suggested fix**:
Use a shared type definitions package:

```typescript
// packages/or3-core-types/src/workspace.ts
export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  slug: string;
  createdAt: number;
}

export interface CreateWorkspaceInput {
  name: string;
  ownerId: string;
  slug?: string;
}

// Server interface
export interface AuthWorkspaceStore {
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  // ...
}

// Client interface (uses SAME types)
export interface WorkspaceApi {
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  // ...
}
```

Or at minimum, make the endpoint implementations explicitly map between types with validation.

---

## 26) Phase 4 has seven TODO comments that punt on critical security logic

**File**: `planning/provider-decoupling/PHASE_4_TASKS.md:108, 129`

**Snippets**:
```typescript
// TODO: Check permissions (user must be owner or admin)
```
```typescript
// TODO: Check permissions (user must be owner)
```

**Why this is bad**:
You're writing detailed 557-line implementation plans but leaving authorization as "TODO" comments. This isn't some edge case feature - it's literally the security model for multi-tenant workspace operations. Without these checks:

1. Any authenticated user can update ANY workspace
2. Any authenticated user can delete ANY workspace
3. Any user can set their active workspace to someone else's private workspace
4. Attackers can enumerate workspace IDs and hijack them

The endpoints are literally worse than no-op stubs, because they actively enable privilege escalation attacks.

**Real-world consequences**:
1. Implementer ships the endpoints as-is (TODO comments are invisible in production)
2. First security audit finds critical vulnerabilities in every workspace endpoint
3. Emergency hotfix required, potentially breaking API contracts
4. Reputation damage: "or3-chat had workspace hijacking vulnerability"
5. GDPR nightmare if workspace data is leaked across tenants

**Suggested fix**:
Either implement proper permissions in Phase 4.1.2, or don't ship the endpoints at all:

```typescript
export default defineEventHandler(async (event) => {
  const session = await requireSession(event);
  const workspaceId = getRouterParam(event, 'id');
  const body = await readBody(event);
  
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'Workspace ID required' });
  }
  
  // Fetch workspace and check ownership
  const store = getActiveAuthWorkspaceStore();
  if (!store) {
    throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
  }
  
  const role = await store.getWorkspaceRole({ 
    userId: session.userId, 
    workspaceId 
  });
  
  if (role !== 'owner' && role !== 'admin') {
    throw createError({ 
      statusCode: 403, 
      statusMessage: 'Only workspace owners and admins can update workspaces' 
    });
  }
  
  const workspace = await store.updateWorkspace(workspaceId, body);
  return workspace;
});
```

---

## 27) Plugin cleanup strategy is nonsensical and will break SSR

**File**: `planning/provider-decoupling/PHASE_4_TASKS.md:254-282`

**Option A (Gate)**:
```typescript
export default defineNuxtPlugin(() => {
  if (!hasConvexProvider()) return;
  
  const convexVue = require('convex-vue');
  // ... setup
});
```

**Why this is bad**:
You're suggesting to use `require('convex-vue')` INSIDE the plugin function body. This doesn't do what you think it does:

1. Nuxt/Vite/esbuild will statically analyze the `require()` call and bundle `convex-vue` anyway
2. The `require()` will fail in ESM-only Nuxt 4 environments (which this project is using: `"type": "module"`)
3. Even if it worked, you're doing a blocking synchronous require in a plugin, killing app startup performance
4. The `hasConvexProvider()` check at runtime is useless because the module was already bundled

This is cargo-cult programming: you're writing code that looks like it should work, but fundamentally misunderstands how module bundlers work.

**Real-world consequences**:
1. Plugin fails to load with "require is not defined" error
2. Even if you hack it with dynamic import(), you get race conditions on app startup
3. SSR hydration mismatches (server has plugin, client might not)
4. Users get white screen of death

**Suggested fix**:
Use Option B (move to provider package) exclusively:

```typescript
// packages/or3-provider-convex/src/client-plugin.ts
import { useConvexClient } from 'convex-vue';

export default defineNuxtPlugin(() => {
  // This plugin only exists if the package is installed
  // No runtime checks needed - module bundler handles it
  const convexClient = useConvexClient();
  // ... setup
});
```

```typescript
// packages/or3-provider-convex/src/nuxt.ts
export default defineNuxtModule({
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);
    
    // Register client plugin
    nuxt.hook('app:resolve', () => {
      nuxt.options.plugins.push({
        src: resolver.resolve('./client-plugin'),
        mode: 'client',
      });
    });
  },
});
```

Delete Option A from the document entirely - it's a footgun.

---

## 28) Test page gating uses synchronous require.resolve in onMounted hook

**File**: `planning/provider-decoupling/PHASE_4_TASKS.md:340-351`

**Snippet**:
```vue
<script setup lang="ts">
const hasConvex = ref(false);

onMounted(() => {
  try {
    require.resolve('or3-provider-convex');
    hasConvex.value = true;
  } catch {
    hasConvex.value = false;
  }
});
</script>
```

**Why this is bad**:
You're calling `require.resolve()` in client-side code. This will:
1. Fail immediately with "require is not defined" (ESM modules don't have `require`)
2. Even if it worked, `require.resolve` checks the NODE module resolution, not browser bundles
3. The `onMounted()` causes a flash of wrong content (renders "not installed" first, then updates)
4. Causes hydration mismatches in SSR mode (server sees different content than client)

This is trying to solve a build-time problem (is package installed?) with runtime code. It's backwards.

**Real-world consequences**:
1. Test pages crash with undefined error
2. Users see "Provider Not Installed" flash even when provider is installed
3. SSR hydration errors spam the console
4. False negatives: package might be installed but check fails due to bundler behavior

**Suggested fix**:
Use build-time environment variables or move test pages to provider packages:

```vue
<!-- Option 1: Build-time check via Nuxt config -->
<template>
  <div v-if="hasConvex">
    <!-- Test UI -->
  </div>
  <div v-else>
    <UAlert 
      color="yellow" 
      title="Convex Provider Not Installed"
    />
  </div>
</template>

<script setup lang="ts">
// Injected by Nuxt config based on installed packages
const config = useRuntimeConfig();
const hasConvex = config.public.providers?.convex || false;
</script>
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      providers: {
        convex: hasPackageInstalled('or3-provider-convex'),
        clerk: hasPackageInstalled('or3-provider-clerk'),
      },
    },
  },
});

function hasPackageInstalled(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}
```

Or better yet: MOVE TEST PAGES TO PROVIDER PACKAGES where they belong.

---

## 29) Time estimates are wildly optimistic fantasy land bullshit

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:448-458`

**Estimates**:
```
- **3.1 Convex Package**: 6-8 hours (includes learning curve)
- **3.2 Clerk Package**: 4-6 hours (pattern established)
- **3.3 Root Config**: 2-3 hours
- **3.4 Wizard Integration**: 3-4 hours
- **3.5 Verification**: 4-6 hours

**Total**: 19-27 hours (3-5 working days)
```

**Why this is bad**:
Creating the Convex package (task 3.1) involves:
- Setting up a new package from scratch
- Configuring TypeScript, tsconfig extends, path resolution
- Moving and refactoring 3 different adapter implementations
- Creating a Nuxt module (many devs have never done this)
- Creating a Nitro plugin that registers adapters
- Fixing all the import paths
- Ensuring types work across package boundaries
- Testing the build output

And you think this takes 6-8 hours including "learning curve"? 

The Nuxt module setup alone can take 2-3 hours if you've never done it. Debugging TypeScript path resolution across packages can eat an entire day. And "Verification" (3.5) is literally testing 5 different build configurations, updating CI/CD, and ensuring nothing broke - that's not 4-6 hours, that's 2-3 days of actually running builds and fixing issues.

**Real-world consequences**:
1. Implementer starts Phase 3, hits roadblocks, feels incompetent ("it should only take 6 hours...")
2. Project manager gets pissed when "3-day task" takes 2 weeks
3. Quality suffers because implementer rushes to meet impossible timeline
4. Technical debt: "I'll fix it later" to stay on schedule
5. Burnout and frustration

**Suggested fix**:
Be realistic about the actual effort:

```markdown
## Time Estimates

- **3.1 Convex Package**: 12-16 hours (includes setup, refactoring, debugging)
- **3.2 Clerk Package**: 8-10 hours (pattern is similar but not identical)
- **3.3 Root Config**: 4-6 hours (workspace setup, testing)
- **3.4 Wizard Integration**: 6-8 hours (CLI tool, docs)
- **3.5 Verification**: 16-20 hours (multiple builds, CI/CD, debugging)

**Total**: 46-60 hours (6-8 working days)

**Realistic Timeline**: Plan for 10 business days to account for:
- Unexpected TypeScript issues
- Nuxt/Nitro build quirks
- Package resolution debugging
- Documentation
- Code review iterations
```

And add a note:
> ⚠️ If this is your first time creating Nuxt modules or workspace packages, double these estimates.

---

## 30) Phase 4 claims workspace endpoints are "optional" but client code requires them

**File**: `planning/provider-decoupling/PHASE_4_TASKS.md:523-525`

**Quote**:
```
1. **Workspace endpoints are optional** - Core sync/storage works without them
```

**Why this is bad**:
The `GatewayWorkspaceApi` implementation (which already exists) makes fetch calls to `/api/workspaces`, `/api/workspaces/[id]`, etc. If these endpoints don't exist, the client code will:

1. Make requests to non-existent endpoints (404 errors)
2. Show error toasts/modals to users
3. Break the workspace switcher UI
4. Break workspace creation flows
5. Potentially cause navigation errors or infinite loading states

How are the endpoints "optional" if the client code explicitly depends on them? This is gaslighting the implementer.

**Real-world consequences**:
1. Implementer skips Phase 4.1 thinking it's optional
2. Application workspace features break
3. Users can't create or switch workspaces
4. Bug reports flood in
5. Emergency hotfix required

**Suggested fix**:
Be honest:

```markdown
## Notes for Implementer

1. **Workspace endpoints are REQUIRED for workspace management features** 
   - The GatewayWorkspaceApi already exists and depends on these endpoints
   - Without them, workspace creation/switching will fail
   - If you want to skip this, you must refactor GatewayWorkspaceApi to 
     fall back to Convex direct client calls (defeats the purpose)
2. **This phase is NOT optional** - It completes the workspace API abstraction
```

Or, if you actually want them to be optional:
```markdown
1. **Workspace endpoints are currently required**
   - Future work: Add fallback to direct provider SDK calls when endpoints missing
   - Would require reinstating provider imports in client code (not recommended)
   - For now, treat Phase 4.1 as mandatory
```

---

## 31) CI/CD build matrix wastes resources testing impossible configurations

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:356-382`

**Build matrix**:
```yaml
strategy:
  matrix:
    providers:
      - none
      - convex-only
      - clerk-only
      - all
```

**Why this is bad**:
Looking at the actual application architecture:

1. **"none"**: App requires AuthWorkspaceStore for session resolution. Without it, every authenticated request throws 500. This isn't a "it builds" scenario - it's a "builds but is completely broken" scenario.

2. **"convex-only"**: You have Convex for sync/storage but no auth provider. How does the user log in? Who mints the Convex JWT tokens? This is not a functional configuration.

3. **"clerk-only"**: You have Clerk for auth but no sync or storage provider. Where do workspaces come from? Where do projects get saved? This is also not a functional configuration.

You're wasting CI minutes (and money) building configurations that will never run in production and can never pass even basic smoke tests.

**Real-world consequences**:
1. CI build times 4x longer than necessary
2. Costs money on hosted CI (GitHub Actions bills per minute)
3. False sense of security ("all builds passing!" but configs don't work)
4. Confuses contributors ("which build should I check?")
5. Hides real failures in noise

**Suggested fix**:
Test realistic configurations only:

```yaml
name: Build Matrix
on: [push, pull_request]
jobs:
  build:
    strategy:
      matrix:
        include:
          - name: "Convex + Clerk (Production)"
            providers: convex-clerk
            env:
              VITE_CONVEX_URL: ${{ secrets.CONVEX_URL }}
              NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_KEY }}
          
          # Future alternative providers (when implemented)
          # - name: "Convex + Supabase Auth"
          #   providers: convex-supabase
          # - name: "Firebase (All)"
          #   providers: firebase-all
    
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      
      # Install provider packages for this configuration
      - run: bun add or3-provider-convex@workspace:* or3-provider-clerk@workspace:*
        if: matrix.providers == 'convex-clerk'
      
      - run: bun run type-check
      - run: bun run build
      
      # Run smoke tests to verify the build actually works
      - run: bun run test:smoke
```

And delete all the unrealistic "none", "convex-only", "clerk-only" options.

---

## 32) Phase 3 assumes Bun workspaces work exactly like npm workspaces (they don't)

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:196-212`

**Snippet**:
```json
{
  "workspaces": [
    "packages/*"
  ],
  "optionalDependencies": {
    "or3-provider-convex": "workspace:*",
    "or3-provider-clerk": "workspace:*"
  }
}
```

**Why this is bad**:
The `workspace:*` protocol is a **pnpm** feature, not a Bun feature. Bun workspaces use a different resolution strategy:

1. Bun doesn't support `workspace:*` - it uses `workspace:<package-name>` or just the package name
2. `optionalDependencies` in Bun workspaces behaves differently than npm/pnpm
3. Bun's module resolution might not respect optional workspace dependencies the way you expect

The actual Bun workspace syntax should be:
```json
{
  "workspaces": [
    "packages/*"
  ],
  "dependencies": {
    "or3-provider-convex": "workspace:packages/or3-provider-convex"
  }
}
```

But even then, Bun doesn't really have "optional" dependencies in the same way. If the package is in `dependencies`, it gets installed. If it's not, it doesn't. The "optionalDependencies" field exists but Bun treats it more like npm v6 (install if possible, skip if fails) rather than "installable on-demand".

**Real-world consequences**:
1. `bun install` fails with "Invalid workspace:* protocol" error
2. Implementer wastes hours googling "bun workspace protocol"
3. Potential pivot to pnpm/npm mid-project (breaks consistency)
4. CI/CD fails because package manager expectations don't match

**Suggested fix**:
Either commit to pnpm (which properly supports `workspace:*` and optional deps):

```json
{
  "workspaces": [
    "packages/*"
  ],
  "optionalDependencies": {
    "or3-provider-convex": "workspace:*",
    "or3-provider-clerk": "workspace:*"
  }
}
```

Or use Bun's actual syntax and accept that "optional" isn't really a thing:

```json
{
  "workspaces": [
    "packages/*"
  ]
}
```

And just import packages explicitly in `nuxt.config.ts` based on environment/config:

```typescript
// nuxt.config.ts
const hasConvex = existsSync('./packages/or3-provider-convex');
const hasClerk = existsSync('./packages/or3-provider-clerk');

export default defineNuxtConfig({
  modules: [
    ...(hasConvex ? ['or3-provider-convex/nuxt'] : []),
    ...(hasClerk ? ['or3-provider-clerk/nuxt'] : []),
  ],
});
```

---

## 33) Missing critical consideration for database schema migrations

**File**: Both `PHASE_3_TASKS.md` and `PHASE_4_TASKS.md`

**What's missing**:
Neither document mentions how to handle Convex schema changes when adding the new workspace CRUD operations in Phase 4.1.3:

```
- [ ] Implement new CRUD methods in `ConvexAuthWorkspaceStore`
- [ ] Add Convex mutations/queries for workspace operations
```

**Why this is bad**:
The existing `convex/` directory contains the Convex backend schema and functions. To implement the new CRUD methods, you need to:

1. Add new mutations/queries to `convex/` (e.g., `workspaces.ts`)
2. Run `convex dev` or `convex deploy` to push schema changes
3. Regenerate `convex/_generated/api.ts`
4. Update the ConvexAuthWorkspaceStore to use the new mutations/queries
5. Handle backward compatibility if production is already running

But your plan says to move `convex/` into the provider package (Phase 3 / Issue #10 in dumb-issues.md). So where does the Convex backend code live during Phase 4? How do you develop against it? How do you deploy schema changes?

**Real-world consequences**:
1. Implementer gets to Phase 4.1.3 and realizes they can't add Convex mutations (code is gone)
2. Has to pull Convex backend out of the package, make changes, push, regenerate types
3. Risk of schema conflicts if multiple developers are working on this
4. Database schema diverges from code during refactoring
5. Production deployments might break if schema isn't in sync

**Suggested fix**:
Add a Phase 3.6 task:

```markdown
### 3.6: Convex Backend Extraction (Optional - Can defer to later)

**Goal**: Move Convex backend schema and functions into the provider package.

**Decision Point**: 
- **Option A**: Keep `convex/` in core for now (simpler, allows Phase 4 to extend it)
- **Option B**: Move to package now (cleaner separation, but complicates development)

If choosing Option A (recommended):
- [ ] Keep `convex/` directory in core repo during Phase 3 & 4
- [ ] Add note that Convex backend is tightly coupled to core (expected for now)
- [ ] Defer extraction to Phase 5 or external providers work
- [ ] Document how to deploy Convex schema changes

If choosing Option B:
- [ ] Move `convex/` to `packages/or3-provider-convex/convex/`
- [ ] Update `convex.json` paths
- [ ] Update `.gitignore` for generated files
- [ ] Document development workflow (run `convex dev` from package dir)
- [ ] Add prebuild step to sync generated types to core
```

And in Phase 4.1.3, explicitly call out the schema changes needed:

```markdown
#### 4.1.3: Update ConvexAuthWorkspaceStore Implementation

**Convex Schema Changes Required**:
- [ ] Add to `convex/workspaces.ts`:
  ```ts
  export const list = query({...});
  export const create = mutation({...});
  export const update = mutation({...});
  export const remove = mutation({...});
  ```
- [ ] Run `convex dev` to push schema
- [ ] Verify `convex/_generated/api.ts` updated
- [ ] Update ConvexAuthWorkspaceStore to import new mutations/queries
- [ ] Test with `convex dashboard` or dev tools
```

---

## 34) Provider package peerDependencies version ranges are dangerously loose

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:39-42, 134-137`

**Snippet**:
```json
"peerDependencies": {
  "convex": "^1.31.0",
  "nuxt": "^3.0.0"
}
```

**Why this is bad**:
1. `"nuxt": "^3.0.0"` means "any Nuxt 3.x version from 3.0.0 to 3.999.999". But:
   - Nuxt 3.0.0 is ancient (Dec 2022)
   - Nuxt 3.0 and Nuxt 3.11 have wildly different APIs (auto-imports, Nitro changes, etc.)
   - The root project uses `"nuxt": "^4.2.1"` (Nuxt 4!), which won't satisfy this peer dependency
   
2. `"convex": "^1.31.0"` is similarly broad and will allow versions with breaking changes

This creates a support nightmare where users install incompatible versions and wonder why things don't work.

**Real-world consequences**:
1. User installs provider package with Nuxt 4, gets peer dependency warning
2. User forces the install, APIs don't match, cryptic errors
3. GitHub issues: "Provider package doesn't work with Nuxt 4"
4. Maintainer has to support every Nuxt 3.x/4.x combination
5. Breaking changes in Convex SDK break provider package silently

**Suggested fix**:
Use realistic, tested version ranges:

```json
// packages/or3-provider-convex/package.json
{
  "peerDependencies": {
    "convex": "^1.31.0 <2.0.0",
    "nuxt": "^3.11.0 || ^4.0.0"
  },
  "peerDependenciesMeta": {
    "convex": {
      "optional": false
    }
  }
}
```

And document the tested versions:

```markdown
## Compatibility

This package is tested with:
- Nuxt: 4.2.x
- Convex: 1.31.x

Other versions may work but are not officially supported.
```

---

## 35) Phase 4 documentation claims plugins will auto-register from packages but provides no implementation

**File**: `planning/provider-decoupling/PHASE_3_TASKS.md:244`

**Quote**:
```
- [ ] Or use a plugin-based approach where providers auto-register
```

**Why this is bad**:
This is presented as an alternative to the conditional module loading, but you don't explain HOW providers would "auto-register". This isn't a built-in Nuxt feature - you'd have to implement a plugin discovery system. That means:

1. A core plugin that scans for installed provider packages
2. Some convention for providers to expose registration hooks
3. Dynamic import() of provider modules at runtime
4. Error handling for missing/broken providers

This is not a trivial "or just do this instead" option - it's a whole separate architectural approach that would add significant complexity and fragility.

**Real-world consequences**:
1. Implementer chooses this option thinking it's simpler
2. Spends days trying to figure out how to "auto-register" plugins
3. Ends up reinventing Nuxt's module system badly
4. Introduces race conditions and initialization order bugs
5. Gives up and goes back to manual registration (wasted time)

**Suggested fix**:
Either implement the auto-registration system properly (with code examples), or delete this option entirely:

```markdown
#### 3.3.2: Update Nuxt Config for Provider Modules

- [ ] Update `nuxt.config.ts` to conditionally load provider modules:
  ```typescript
  export default defineNuxtConfig({
    modules: [
      '@nuxt/ui',
      // Conditionally include provider modules if installed
      ...(hasPackageInstalled('or3-provider-convex') 
        ? ['or3-provider-convex/nuxt'] 
        : []
      ),
      ...(hasPackageInstalled('or3-provider-clerk') 
        ? ['or3-provider-clerk/nuxt'] 
        : []
      ),
    ],
  });
  ```

**Note**: This is the recommended approach. Auto-registration systems add complexity 
and are harder to debug. Explicit is better than implicit.
```

Delete the "or use plugin-based approach" line entirely.

---

## 36) `file:../...` dependencies make the repo non-installable outside your local workspace

**File**: `package.json:49-50`

**Snippet**:
```json
"or3-provider-clerk": "file:../or3-provider-clerk",
"or3-provider-convex": "file:../or3-provider-convex"
```

**Why this is bad**:
This hard-codes parent-directory paths that only exist on your machine/workspace layout. Anyone cloning just `or3-chat` gets a broken install unless they manually recreate your sibling repo structure.

**Real-world consequences**:
1. Fresh clones fail `bun install`.
2. CI/CD fails unless the pipeline checks out extra sibling repos.
3. The repo is not self-contained, so reproducibility is gone.
4. “Provider decoupling complete” is false for anyone outside your local setup.

**Suggested fix**:
Use one of these, in order:
1. Real published versions: `"or3-provider-convex": "^x.y.z"`.
2. Bun workspace setup inside one repository and `"workspace:*"`.
3. If temporary local linking is required, keep it out of committed `package.json` (documented local override only).

---

## 37) You marked “CI integrated” complete, but there is no CI workflow using the check

**File**: `planning/provider-decoupling/phase-3-task.md:185`

**Snippet**:
```md
- [x] Add script to CI (`bun run check-imports`).
```

**Why this is bad**:
You checked a gate that was never implemented. This is process fraud, not just docs drift.

**Real-world consequences**:
1. Guardrail only runs when someone remembers to run it locally.
2. Provider imports can regress silently.
3. Future contributors trust a protection that does not exist.

**Suggested fix**:
Either:
1. Add an actual workflow in `.github/workflows/*.yml` that runs `bun run check-imports`.
2. Or uncheck this item and mark it explicitly pending.

---

## 38) You declared no-provider matrix “green” while explicitly documenting typecheck failures

**File**: `planning/provider-decoupling/phase-3-task.md:220`, `planning/provider-decoupling/phase-3-task.md:226`

**Snippet**:
```md
- [x] `bun run type-check` — 1 error in clerk-specific test file only
...
- [x] `bun run type-check` — 3 errors all in convex-specific files/config
```

**Why this is bad**:
The requirement is pass/fail, not “fails but I feel okay about it.” A matrix with errors is not passing.

**Real-world consequences**:
1. Release decisions are made on false signals.
2. “No provider installed” compatibility remains unproven.
3. People waste time debugging known failing states that were reported as complete.

**Suggested fix**:
Make the matrix binary again:
1. Move provider-specific tests out of host or gate them.
2. Make no-provider scenarios typecheck with zero errors.
3. Only then check the matrix boxes.

---

## 39) Host tests now deep-import provider internals, forcing brittle tsconfig hacks

**Files**:
- `server/sync/gateway/impls/__tests__/convex-sync-gateway-adapter.test.ts:3`
- `app/core/sync/providers/__tests__/convex-sync-provider.test.ts:2`
- `nuxt.config.ts:267-268`
- `nuxt.config.ts:318-319`

**Snippet**:
```ts
import { ConvexSyncGatewayAdapter } from 'or3-provider-convex/src/runtime/server/sync/convex-sync-gateway-adapter';
```

```ts
'or3-provider-convex/src/*': ['../node_modules/or3-provider-convex/src/*']
```

**Why this is bad**:
You coupled host tests to package private internals (`src/runtime/**`). Then you patched Nuxt TS config to make those illegal imports resolve. That is backwards architecture: tests now dictate package internals.

**Real-world consequences**:
1. Any internal refactor in provider package breaks host tests.
2. Dist-only package publishing breaks host typecheck immediately.
3. You lock the package to source layout forever.

**Suggested fix**:
1. Move provider-internal tests to provider repos.
2. Test host behavior through public package entrypoints/contracts only.
3. Delete `or3-provider-*/src/*` path mappings from host Nuxt config.

---

## 40) Import guardrail pattern is easy to bypass and misses major Convex import forms

**File**: `scripts/check-banned-imports.sh:10`

**Snippet**:
```bash
BANNED_PATTERN='@clerk/nuxt|convex-vue|from '\''convex'\''|from "convex"|~~/convex/_generated|packages/or3-provider'
```

**Why this is bad**:
This catches only exact `from 'convex'`/`from "convex"` forms. It misses:
- `from 'convex/browser'`
- `from 'convex/server'`
- dynamic imports (`import('convex/...')`)
- re-export forms

**Real-world consequences**:
1. Core hot zones can reintroduce Convex coupling without being caught.
2. Guardrail gives false confidence.
3. Review burden shifts back to humans for something automation should enforce.

**Suggested fix**:
Use a stronger pattern, e.g. `from ['"]convex(/|['"])|import\\(['"]convex/`.
Or switch to a small AST-based import scanner and ban module specifiers by prefix.

---

## 41) “Real npm packages” claim is premature: source-only exports, no build artifact contract

**Files**:
- `/Users/brendon/Documents/or3/or3-provider-convex/package.json:5-8`
- `/Users/brendon/Documents/or3/or3-provider-convex/package.json:23-27`
- `/Users/brendon/Documents/or3/or3-provider-clerk/package.json:5-8`
- `/Users/brendon/Documents/or3/or3-provider-clerk/package.json:18-21`

**Snippet**:
```json
"exports": {
  "./nuxt": "./src/module.ts",
  "./src/*": "./src/*"
},
"scripts": {
  "type-check": "tsc --noEmit"
}
```

**Why this is bad**:
You’re shipping raw source and exposing internal `./src/*` as public API while claiming package extraction is complete. There is no build pipeline, no stable dist contract, and no boundary between public surface and internals.

**Real-world consequences**:
1. Consumers are tied to your exact source layout.
2. Any TS/loader change in host toolchain can break package loading.
3. You cannot evolve internals without breaking downstream consumers importing `src/*`.

**Suggested fix**:
1. Define public API exports only (`./nuxt`, maybe `./testing` explicitly).
2. Add a real build step that emits `dist/`.
3. Stop exporting `./src/*` and stop deep-importing internals from host.
