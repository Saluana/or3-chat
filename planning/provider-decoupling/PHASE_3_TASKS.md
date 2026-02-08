# Phase 3: Provider Package Extraction

**Estimated Time**: 3-5 days  
**Status**: Not Started  
**Prerequisites**: Phase 1 & 2 Complete ✅  

---

## Overview

Extract temporary provider implementations from core codebase into standalone, optional npm packages. This enables:
1. Building the core without provider dependencies installed
2. Community/third-party provider development
3. Cleaner separation of concerns
4. Smaller core bundle size

---

## Task Checklist

### 3.1: Create Package Structure for or3-provider-convex (Day 1)

**Goal**: Set up the Convex provider as an independent package that can be optionally installed.

#### 3.1.1: Initialize Package Directory
- [ ] Create `packages/or3-provider-convex/` directory
- [ ] Create `packages/or3-provider-convex/package.json` with:
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
    "peerDependencies": {
      "convex": "^1.31.0",
      "nuxt": "^3.0.0"
    },
    "dependencies": {
      "jsonwebtoken": "^9.0.3"
    },
    "scripts": {
      "build": "bun build src/index.ts --outdir=dist --target=node",
      "typecheck": "tsc --noEmit"
    }
  }
  ```
- [ ] Create `packages/or3-provider-convex/tsconfig.json` extending root
- [ ] Create `packages/or3-provider-convex/README.md` with usage instructions

#### 3.1.2: Move Convex Adapters to Package
- [ ] Create `packages/or3-provider-convex/src/` directory
- [ ] Move `server/auth/store/impls/convex-auth-workspace-store.ts` → `packages/or3-provider-convex/src/auth-workspace-store.ts`
  - Update imports to use relative paths
  - Re-export from `src/index.ts`
- [ ] Move `server/sync/gateway/impls/convex-sync-gateway-adapter.ts` → `packages/or3-provider-convex/src/sync-gateway-adapter.ts`
  - Update imports to use relative paths
  - Re-export from `src/index.ts`
- [ ] Move `server/storage/gateway/impls/convex-storage-gateway-adapter.ts` → `packages/or3-provider-convex/src/storage-gateway-adapter.ts`
  - Update imports to use relative paths
  - Re-export from `src/index.ts`

#### 3.1.3: Create Nuxt Module for Convex Provider
- [ ] Create `packages/or3-provider-convex/src/nuxt.ts` as Nuxt module:
  ```typescript
  import { defineNuxtModule, createResolver } from '@nuxt/kit';
  
  export default defineNuxtModule({
    meta: {
      name: 'or3-provider-convex',
      configKey: 'or3ProviderConvex',
    },
    setup(options, nuxt) {
      const resolver = createResolver(import.meta.url);
      
      // Add server plugin to register adapters
      nuxt.hook('nitro:config', (config) => {
        config.plugins = config.plugins || [];
        config.plugins.push(resolver.resolve('./server-plugin.ts'));
      });
    },
  });
  ```
- [ ] Create `packages/or3-provider-convex/src/server-plugin.ts`:
  - Import adapter creation functions
  - Register all three adapters (auth, sync, storage)
  - Only register if SSR auth is enabled
  - Add error handling for missing dependencies

#### 3.1.4: Update Package Index
- [ ] Create `packages/or3-provider-convex/src/index.ts`:
  ```typescript
  export { createConvexAuthWorkspaceStore } from './auth-workspace-store';
  export { createConvexSyncGatewayAdapter } from './sync-gateway-adapter';
  export { createConvexStorageGatewayAdapter } from './storage-gateway-adapter';
  
  // Re-export types from core (for convenience)
  export type { AuthWorkspaceStore } from '~/server/auth/store/types';
  export type { SyncGatewayAdapter } from '~/server/sync/gateway/types';
  export type { StorageGatewayAdapter } from '~/server/storage/gateway/types';
  ```

#### 3.1.5: Build & Test Package
- [ ] Run `bun build` in package directory
- [ ] Verify dist/ output contains all files
- [ ] Check that types are generated correctly
- [ ] Test importing the package locally

---

### 3.2: Create Package Structure for or3-provider-clerk (Day 2)

**Goal**: Extract Clerk provider code into a standalone package.

#### 3.2.1: Initialize Package Directory
- [ ] Create `packages/or3-provider-clerk/` directory
- [ ] Create `packages/or3-provider-clerk/package.json` with:
  ```json
  {
    "name": "or3-provider-clerk",
    "version": "0.1.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": "./dist/index.js",
      "./nuxt": "./dist/nuxt.js"
    },
    "peerDependencies": {
      "@clerk/nuxt": "^1.13.0",
      "nuxt": "^3.0.0"
    },
    "scripts": {
      "build": "bun build src/index.ts --outdir=dist --target=node",
      "typecheck": "tsc --noEmit"
    }
  }
  ```
- [ ] Create `packages/or3-provider-clerk/tsconfig.json`
- [ ] Create `packages/or3-provider-clerk/README.md`

#### 3.2.2: Audit Current Clerk Usage
- [ ] Search codebase for all `@clerk/nuxt` imports
- [ ] Identify files that need refactoring:
  - Server middleware using Clerk
  - Client composables using Clerk
  - Admin adapters using Clerk tokens
- [ ] Document which code stays in core vs moves to package

#### 3.2.3: Create Clerk Token Broker Implementation
- [ ] Create `packages/or3-provider-clerk/src/token-broker.ts`:
  ```typescript
  import type { ProviderTokenBroker } from '~/server/auth/token-broker/types';
  import { clerkClient } from '@clerk/nuxt/server';
  
  export function createClerkTokenBroker(): ProviderTokenBroker {
    return {
      async mintToken(options) {
        const { userId, workspaceId, expiresIn } = options;
        
        // Use Clerk's signJwt or API to generate provider tokens
        const template = 'convex'; // or configured template
        const token = await clerkClient.users.getUserOauthAccessToken(
          userId,
          template
        );
        
        return token;
      },
    };
  }
  ```
- [ ] Create Nuxt module in `packages/or3-provider-clerk/src/nuxt.ts`
- [ ] Create server plugin to register token broker

#### 3.2.4: Extract Clerk-Specific Code
- [ ] Move any Clerk-specific utilities to package
- [ ] Update imports in affected files
- [ ] Ensure core code uses ProviderTokenBroker, not direct Clerk calls

#### 3.2.5: Build & Test Package
- [ ] Run `bun build` in package directory
- [ ] Verify all exports work
- [ ] Test token broker registration

---

### 3.3: Update Root Package Configuration (Day 3)

**Goal**: Configure the monorepo to support workspace packages and optional provider installation.

#### 3.3.1: Configure Bun Workspaces
- [ ] Update root `package.json` to add workspaces:
  ```json
  {
    "workspaces": [
      "packages/*"
    ]
  }
  ```
- [ ] Move provider packages to `optionalDependencies` (or remove entirely):
  ```json
  {
    "optionalDependencies": {
      "or3-provider-convex": "workspace:*",
      "or3-provider-clerk": "workspace:*"
    }
  }
  ```

#### 3.3.2: Update Nuxt Config for Provider Modules
- [ ] Update `nuxt.config.ts` to conditionally load provider modules:
  ```typescript
  export default defineNuxtConfig({
    modules: [
      '@nuxt/ui',
      // ... other modules
      
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
  
  function hasPackageInstalled(packageName: string): boolean {
    try {
      require.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  }
  ```
- [ ] Or use a plugin-based approach where providers auto-register

#### 3.3.3: Delete Temporary Code
- [ ] Delete `server/plugins/00.register-providers.ts` (no longer needed)
- [ ] Delete `server/auth/store/impls/` directory (moved to package)
- [ ] Delete `server/sync/gateway/impls/` directory (moved to package)
- [ ] Delete `server/storage/gateway/impls/` directory (moved to package)
- [ ] Update any import statements that referenced these files

#### 3.3.4: Update Build Scripts
- [ ] Add script to build all packages: `"build:packages": "bun run --cwd packages/or3-provider-convex build && bun run --cwd packages/or3-provider-clerk build"`
- [ ] Update main build script to build packages first
- [ ] Add typecheck script for packages

---

### 3.4: Create Provider Installation Wizard Integration (Day 4)

**Goal**: Allow users to select providers during setup and generate the appropriate config.

#### 3.4.1: Create Provider Registry Metadata
- [ ] Create `config.or3.providers.ts` (or extend existing):
  ```typescript
  export const availableProviders = {
    auth: [
      {
        id: 'clerk',
        name: 'Clerk',
        packageName: 'or3-provider-clerk',
        description: 'Authentication via Clerk',
        envVars: ['NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NUXT_CLERK_SECRET_KEY'],
      },
    ],
    sync: [
      {
        id: 'convex',
        name: 'Convex',
        packageName: 'or3-provider-convex',
        description: 'Real-time sync via Convex',
        envVars: ['VITE_CONVEX_URL'],
      },
    ],
    storage: [
      {
        id: 'convex',
        name: 'Convex Storage',
        packageName: 'or3-provider-convex',
        description: 'File storage via Convex',
        envVars: ['VITE_CONVEX_URL'],
      },
    ],
  };
  ```

#### 3.4.2: Create Provider Selection UI (Optional)
- [ ] Create `app/pages/setup/providers.vue` (or extend existing setup)
- [ ] Add checkboxes for each provider category
- [ ] Show required env vars for selected providers
- [ ] Generate `.env` template based on selections

#### 3.4.3: Create CLI Setup Command (Recommended)
- [ ] Create `scripts/cli/setup-providers.ts`:
  - Prompt user to select providers
  - Install selected provider packages
  - Generate `.env` with required variables
  - Update `config.or3cloud.ts` with selections
- [ ] Add npm script: `"setup:providers": "tsx scripts/cli/setup-providers.ts"`

#### 3.4.4: Update Documentation
- [ ] Update `planning/provider-decoupling/QUICK_START_GUIDE.md` with Phase 3 instructions
- [ ] Add "Adding a New Provider" guide
- [ ] Document provider package structure and requirements
- [ ] Add troubleshooting section for package issues

---

### 3.5: Verification & Testing (Day 5)

**Goal**: Ensure the package extraction works correctly in all scenarios.

#### 3.5.1: Test Build Without Providers
- [ ] Uninstall provider packages: `bun remove or3-provider-convex or3-provider-clerk`
- [ ] Run `bun install`
- [ ] Run `bun run type-check` (should pass)
- [ ] Run `bun run build` (should build successfully)
- [ ] Verify no provider imports in build output
- [ ] Check bundle size is reduced

#### 3.5.2: Test Build With Convex Only
- [ ] Install only Convex provider: `bun add or3-provider-convex@workspace:*`
- [ ] Run `bun run type-check` (should pass)
- [ ] Run `bun run build` (should build)
- [ ] Start dev server: `bun run dev:ssr`
- [ ] Verify sync endpoints work
- [ ] Verify storage endpoints work
- [ ] Check session resolution works

#### 3.5.3: Test Build With All Providers
- [ ] Install all providers: `bun add or3-provider-convex@workspace:* or3-provider-clerk@workspace:*`
- [ ] Run `bun run type-check` (should pass)
- [ ] Run `bun run build` (should build)
- [ ] Start dev server: `bun run dev:ssr`
- [ ] Verify all functionality works
- [ ] Test end-to-end user flow

#### 3.5.4: Test Provider Package Exports
- [ ] In a separate test project, install packages
- [ ] Import and use adapter creation functions
- [ ] Register adapters manually
- [ ] Verify TypeScript types are available
- [ ] Check that peerDependencies are correctly specified

#### 3.5.5: Update CI/CD Build Matrix
- [ ] Create `.github/workflows/build-matrix.yml`:
  ```yaml
  name: Build Matrix
  on: [push, pull_request]
  jobs:
    build:
      strategy:
        matrix:
          providers:
            - none
            - convex-only
            - clerk-only
            - all
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v1
        - run: bun install
        - if: matrix.providers == 'convex-only'
          run: bun add or3-provider-convex@workspace:*
        - if: matrix.providers == 'clerk-only'
          run: bun add or3-provider-clerk@workspace:*
        - if: matrix.providers == 'all'
          run: bun add or3-provider-convex@workspace:* or3-provider-clerk@workspace:*
        - run: bun run type-check
        - run: bun run build
  ```

---

## Success Criteria

Phase 3 is complete when:

1. ✅ Both provider packages build successfully
2. ✅ Core builds without any providers installed
3. ✅ Core builds with only Convex installed
4. ✅ Core builds with only Clerk installed
5. ✅ Core builds with all providers installed
6. ✅ All typechecks pass in all scenarios
7. ✅ No provider SDK imports in core code
8. ✅ Provider packages are properly typed
9. ✅ Documentation is updated
10. ✅ CI/CD build matrix passes

---

## Rollback Plan

If Phase 3 encounters issues:

1. **Revert package extraction**: Copy implementations back to core
2. **Re-enable temporary plugin**: Restore `server/plugins/00.register-providers.ts`
3. **Remove workspace config**: Remove workspaces from package.json
4. **Document blockers**: Add notes to `dumb-issues.md` about what prevented completion

Phase 2 implementation will continue to work as a fallback.

---

## Dependencies & Blockers

**Prerequisites**:
- ✅ Phase 1 & 2 complete
- ✅ All adapters tested and working

**Potential Blockers**:
- Bun workspace support issues
- Nuxt module registration edge cases
- TypeScript path resolution in packages
- Peer dependency version conflicts

**Mitigation**:
- Use npm/pnpm workspaces if Bun has issues
- Fallback to manual plugin registration if module auto-loading fails
- Use explicit relative imports if path aliases break
- Pin exact peer dependency versions

---

## Notes for Implementer

1. **Start with Convex package** - It's the most complex and will surface issues early
2. **Test after each task** - Don't wait until the end to verify builds
3. **Keep temporary code until verified** - Only delete old implementations after packages work
4. **Document package structure** - Future providers will copy this pattern
5. **Use relative imports** - Avoid Nuxt aliases (`~/`) in package code
6. **Consider bundle size** - Packages should be small and focused
7. **Think about versioning** - Semver for packages vs core compatibility

---

## Time Estimates

- **3.1 Convex Package**: 6-8 hours (includes learning curve)
- **3.2 Clerk Package**: 4-6 hours (pattern established)
- **3.3 Root Config**: 2-3 hours
- **3.4 Wizard Integration**: 3-4 hours
- **3.5 Verification**: 4-6 hours

**Total**: 19-27 hours (3-5 working days)

**Realistic Timeline**: Plan for 5 days to account for blockers and testing
