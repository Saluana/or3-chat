# Phase 4: Additional Refinements

**Estimated Time**: 2-3 days  
**Status**: Not Started  
**Prerequisites**: Phase 3 Complete (or Phase 2 for partial completion)  

---

## Overview

Polish the provider decoupling implementation with:
1. Workspace SSR endpoints (complete the WorkspaceApi)
2. Client plugin cleanup (remove provider-specific plugins)
3. Test page refactoring (gate or remove provider dependencies)
4. Final verification and optimization

---

## Task Checklist

### 4.1: Workspace SSR Endpoints (Day 1)

**Goal**: Complete the WorkspaceApi implementation with server endpoints for workspace CRUD operations.

#### 4.1.1: Extend AuthWorkspaceStore Interface
- [ ] Update `server/auth/store/types.ts` to add CRUD methods:
  ```typescript
  export interface AuthWorkspaceStore {
    // Existing methods
    resolveWorkspace(workspaceId: string): Promise<Workspace | null>;
    resolveUser(userId: string): Promise<User | null>;
    
    // New CRUD methods
    listWorkspaces(userId: string): Promise<Workspace[]>;
    createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
    updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace>;
    deleteWorkspace(workspaceId: string): Promise<void>;
    
    // Active workspace management
    getActiveWorkspace(userId: string): Promise<string | null>;
    setActiveWorkspace(userId: string, workspaceId: string): Promise<void>;
    
    // Membership management
    addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
    removeMember(workspaceId: string, userId: string): Promise<void>;
    updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  }
  
  export interface CreateWorkspaceInput {
    name: string;
    ownerId: string;
    slug?: string;
  }
  
  export interface UpdateWorkspaceInput {
    name?: string;
    slug?: string;
  }
  ```

#### 4.1.2: Create Workspace API Endpoints
- [ ] Create `server/api/workspaces/list.get.ts`:
  ```typescript
  export default defineEventHandler(async (event) => {
    const session = await requireSession(event);
    const store = getActiveAuthWorkspaceStore();
    if (!store) {
      throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
    }
    
    const workspaces = await store.listWorkspaces(session.userId);
    return workspaces;
  });
  ```

- [ ] Create `server/api/workspaces/create.post.ts`:
  ```typescript
  export default defineEventHandler(async (event) => {
    const session = await requireSession(event);
    const body = await readBody(event);
    
    const store = getActiveAuthWorkspaceStore();
    if (!store) {
      throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
    }
    
    const workspace = await store.createWorkspace({
      name: body.name,
      ownerId: session.userId,
      slug: body.slug,
    });
    
    return workspace;
  });
  ```

- [ ] Create `server/api/workspaces/[id]/update.patch.ts`:
  ```typescript
  export default defineEventHandler(async (event) => {
    const session = await requireSession(event);
    const workspaceId = getRouterParam(event, 'id');
    const body = await readBody(event);
    
    if (!workspaceId) {
      throw createError({ statusCode: 400, statusMessage: 'Workspace ID required' });
    }
    
    // TODO: Check permissions (user must be owner or admin)
    const store = getActiveAuthWorkspaceStore();
    if (!store) {
      throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
    }
    
    const workspace = await store.updateWorkspace(workspaceId, body);
    return workspace;
  });
  ```

- [ ] Create `server/api/workspaces/[id]/delete.delete.ts`:
  ```typescript
  export default defineEventHandler(async (event) => {
    const session = await requireSession(event);
    const workspaceId = getRouterParam(event, 'id');
    
    if (!workspaceId) {
      throw createError({ statusCode: 400, statusMessage: 'Workspace ID required' });
    }
    
    // TODO: Check permissions (user must be owner)
    const store = getActiveAuthWorkspaceStore();
    if (!store) {
      throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
    }
    
    await store.deleteWorkspace(workspaceId);
    return { success: true };
  });
  ```

- [ ] Create `server/api/workspaces/active/get.get.ts`:
  ```typescript
  export default defineEventHandler(async (event) => {
    const session = await requireSession(event);
    const store = getActiveAuthWorkspaceStore();
    if (!store) {
      throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
    }
    
    const workspaceId = await store.getActiveWorkspace(session.userId);
    return { workspaceId };
  });
  ```

- [ ] Create `server/api/workspaces/active/set.post.ts`:
  ```typescript
  export default defineEventHandler(async (event) => {
    const session = await requireSession(event);
    const body = await readBody(event);
    
    const store = getActiveAuthWorkspaceStore();
    if (!store) {
      throw createError({ statusCode: 500, statusMessage: 'Store not configured' });
    }
    
    await store.setActiveWorkspace(session.userId, body.workspaceId);
    return { success: true };
  });
  ```

#### 4.1.3: Update ConvexAuthWorkspaceStore Implementation
- [ ] Implement new CRUD methods in `ConvexAuthWorkspaceStore` (or package if Phase 3 done)
- [ ] Add Convex mutations/queries for workspace operations
- [ ] Handle workspace membership updates
- [ ] Implement active workspace tracking (in user document or separate table)

#### 4.1.4: Update GatewayWorkspaceApi
- [ ] Update `app/core/workspace/gateway-workspace-api.ts` to call new endpoints:
  ```typescript
  export class GatewayWorkspaceApi implements WorkspaceApi {
    async list(): Promise<Workspace[]> {
      return $fetch('/api/workspaces/list');
    }
    
    async create(input: CreateWorkspaceInput): Promise<Workspace> {
      return $fetch('/api/workspaces/create', {
        method: 'POST',
        body: input,
      });
    }
    
    async update(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace> {
      return $fetch(`/api/workspaces/${workspaceId}/update`, {
        method: 'PATCH',
        body: input,
      });
    }
    
    async delete(workspaceId: string): Promise<void> {
      await $fetch(`/api/workspaces/${workspaceId}/delete`, {
        method: 'DELETE',
      });
    }
    
    async getActive(): Promise<string | null> {
      const result = await $fetch('/api/workspaces/active/get');
      return result.workspaceId;
    }
    
    async setActive(workspaceId: string): Promise<void> {
      await $fetch('/api/workspaces/active/set', {
        method: 'POST',
        body: { workspaceId },
      });
    }
  }
  ```

#### 4.1.5: Test Workspace Endpoints
- [ ] Run dev server: `bun run dev:ssr`
- [ ] Test listing workspaces via API
- [ ] Test creating a workspace
- [ ] Test updating workspace name
- [ ] Test deleting a workspace
- [ ] Test setting active workspace
- [ ] Verify permissions are enforced (if implemented)

---

### 4.2: Client Plugin Cleanup (Day 2)

**Goal**: Remove or refactor client plugins that directly import provider SDKs.

#### 4.2.1: Audit Client Plugins
- [ ] List all files in `app/plugins/` and `plugins/`
- [ ] Identify plugins that import from:
  - `convex-vue`
  - `@clerk/nuxt`
  - `convex`
  - Provider-generated files
- [ ] Categorize each plugin:
  - **Keep as-is**: No provider imports
  - **Refactor**: Can be made provider-agnostic
  - **Gate**: Wrap in provider check
  - **Remove**: No longer needed

**Current Known Plugins** (check for provider imports):
- [ ] `app/plugins/00.config.ts` - Check for provider config
- [ ] `app/plugins/01.convex-vue.client.ts` - **GATE or REFACTOR**
- [ ] `app/plugins/02.theme.client.ts` - Likely OK
- [ ] `app/plugins/03.hooks.client.ts` - Likely OK
- [ ] Any sync/storage plugins - **REFACTOR**

#### 4.2.2: Refactor Convex-Vue Plugin
- [ ] Option A (Gate): Wrap plugin in provider check
  ```typescript
  // app/plugins/01.convex-vue.client.ts
  export default defineNuxtPlugin(() => {
    // Only load if Convex provider is installed
    if (!hasConvexProvider()) return;
    
    const convexVue = require('convex-vue');
    // ... setup
  });
  
  function hasConvexProvider(): boolean {
    try {
      require.resolve('or3-provider-convex');
      return true;
    } catch {
      return false;
    }
  }
  ```

- [ ] Option B (Move): Move to Convex provider package
  - Move plugin to `packages/or3-provider-convex/src/client-plugin.ts`
  - Register plugin from Nuxt module
  - Remove from core `app/plugins/`

- [ ] Choose and implement one option

#### 4.2.3: Refactor Sync/Storage Plugins (if they exist)
- [ ] Check if there are client-side sync plugins
- [ ] Make them use composables instead of direct provider imports
- [ ] Ensure they work with registry pattern
- [ ] Test with and without providers installed

#### 4.2.4: Update Plugin Loading Order
- [ ] Ensure provider plugins load before app plugins
- [ ] Update plugin numbering if needed (00, 01, etc.)
- [ ] Add comments explaining why certain plugins are gated
- [ ] Document plugin dependencies in README

#### 4.2.5: Test Plugin Behavior
- [ ] Test with all providers installed
- [ ] Test with no providers installed (app should still load)
- [ ] Test with only Convex installed
- [ ] Check browser console for plugin errors
- [ ] Verify hot reload works correctly

---

### 4.3: Test Page Refactoring (Day 2 afternoon)

**Goal**: Clean up test pages that import providers or move them to appropriate locations.

#### 4.3.1: Audit Test Pages
- [ ] List all pages in `app/pages/_tests/` or similar
- [ ] Check each page for provider imports
- [ ] Categorize:
  - **Keep**: No provider dependencies
  - **Gate**: Wrap in `<ClientOnly>` with provider check
  - **Move**: Move to provider package or separate test app
  - **Delete**: No longer needed

**Common Test Pages** (check these):
- [ ] `app/pages/_tests/convex.vue` - **GATE or MOVE**
- [ ] `app/pages/_tests/sync.vue` - Should use adapters, OK
- [ ] `app/pages/_tests/storage.vue` - Should use adapters, OK
- [ ] Any other test pages

#### 4.3.2: Gate Provider-Specific Test Pages
- [ ] Wrap test pages in provider checks:
  ```vue
  <!-- app/pages/_tests/convex.vue -->
  <template>
    <div v-if="hasConvex">
      <!-- Test UI -->
    </div>
    <div v-else>
      <UAlert 
        color="yellow" 
        title="Convex Provider Not Installed"
        description="Install or3-provider-convex to use this test page."
      />
    </div>
  </template>
  
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

#### 4.3.3: Move Provider Tests to Packages (Optional)
- [ ] Create `packages/or3-provider-convex/test-pages/` directory
- [ ] Move Convex-specific test pages
- [ ] Document how to access test pages from provider packages
- [ ] Update navigation/links if needed

#### 4.3.4: Clean Up Test Navigation
- [ ] Update test page index/menu
- [ ] Add "Provider Tests" section if applicable
- [ ] Remove dead links
- [ ] Add descriptions for what each test page does

#### 4.3.5: Verify Test Pages Work
- [ ] Visit each test page with providers installed
- [ ] Visit each test page without providers installed
- [ ] Ensure gated pages show appropriate messages
- [ ] Check that test functionality still works

---

### 4.4: Final Verification & Optimization (Day 3)

**Goal**: Ensure everything works correctly and is optimized.

#### 4.4.1: Run Full Type Check
- [ ] Run `bun run type-check` with all providers
- [ ] Run `bun run type-check` without providers (if Phase 3 done)
- [ ] Fix any type errors
- [ ] Verify no `@ts-ignore` comments were added

#### 4.4.2: Run Lint
- [ ] Run `bun run lint` (or eslint)
- [ ] Fix linting errors
- [ ] Update ESLint config if needed
- [ ] Ensure consistent code style

#### 4.4.3: Bundle Size Analysis
- [ ] Run `bun run analyze`
- [ ] Check bundle sizes before/after Phase 4
- [ ] Identify any unexpected dependencies
- [ ] Ensure tree-shaking is working
- [ ] Document bundle size improvements

#### 4.4.4: Performance Testing
- [ ] Test dev server startup time
- [ ] Test build time
- [ ] Test page load performance
- [ ] Check for any introduced performance regressions
- [ ] Profile critical paths if needed

#### 4.4.5: End-to-End Testing
- [ ] Test complete user workflow:
  1. Sign up/sign in
  2. Create workspace
  3. Switch workspaces
  4. Create project
  5. Sync data
  6. Upload file
  7. Delete workspace
- [ ] Test error scenarios:
  - Network failures
  - Invalid inputs
  - Permission errors
- [ ] Test with different provider combinations

#### 4.4.6: Documentation Updates
- [ ] Update main README with Phase 4 completion
- [ ] Update IMPLEMENTATION_COMPLETE.md
- [ ] Update FINAL_STATUS.md with Phase 4 status
- [ ] Create Phase 4 completion summary
- [ ] Add any new troubleshooting tips

---

### 4.5: Optional Refinements (If Time Permits)

These are nice-to-have improvements but not required for Phase 4 completion.

#### 4.5.1: Provider Health Checks
- [ ] Create `server/api/health/providers.get.ts`:
  ```typescript
  export default defineEventHandler(async () => {
    return {
      auth: !!getActiveAuthWorkspaceStore(),
      sync: !!getActiveSyncGatewayAdapter(),
      storage: !!getActiveStorageGatewayAdapter(),
      tokenBroker: !!getActiveProviderTokenBroker(),
    };
  });
  ```
- [ ] Add health check to admin dashboard
- [ ] Show which providers are active

#### 4.5.2: Provider Switching UI (Advanced)
- [ ] Create admin page to view/manage providers
- [ ] Show installed vs available providers
- [ ] Link to provider installation docs
- [ ] Display provider configuration status

#### 4.5.3: Provider Error Handling
- [ ] Add better error messages when provider is missing
- [ ] Create custom error page for provider issues
- [ ] Add retry logic for transient provider failures
- [ ] Log provider errors to monitoring system

#### 4.5.4: Provider Metrics
- [ ] Track which adapters are being used
- [ ] Measure adapter performance
- [ ] Log adapter errors separately
- [ ] Create dashboard for provider health

#### 4.5.5: Developer Experience
- [ ] Create `bun run dev:no-providers` script for testing
- [ ] Add provider status to dev toolbar
- [ ] Create developer guide for adding providers
- [ ] Add provider templates/scaffolding

---

## Success Criteria

Phase 4 is complete when:

1. ✅ All workspace SSR endpoints implemented and working
2. ✅ WorkspaceApi fully functional via gateway endpoints
3. ✅ Client plugins are provider-agnostic or properly gated
4. ✅ Test pages work with and without providers
5. ✅ All typechecks pass
6. ✅ Linting passes
7. ✅ Bundle size is optimized
8. ✅ End-to-end tests pass
9. ✅ Documentation is updated
10. ✅ No provider imports in core (except gated plugins)

---

## Rollback Plan

If Phase 4 encounters issues:

1. **Keep existing implementations**: Workspace endpoints can be added later
2. **Keep plugin structure**: Gating can be added incrementally
3. **Document blockers**: Add to `dumb-issues.md`
4. **Partial completion is OK**: Phase 4 tasks are independent

Core functionality from Phases 1-3 will continue to work.

---

## Dependencies & Blockers

**Prerequisites**:
- ✅ Phase 1 & 2 complete
- ⚠️ Phase 3 optional (affects plugin strategy)

**Potential Blockers**:
- Workspace CRUD complexity
- Permission system design
- Plugin loading order issues
- Test page maintenance burden

**Mitigation**:
- Start with simple CRUD, add permissions later
- Use runtime checks instead of build-time gating
- Document plugin dependencies clearly
- Prioritize essential test pages

---

## Notes for Implementer

1. **Workspace endpoints are optional** - Core sync/storage works without them
2. **Plugin gating is better than moving** - Keep plugins in core if possible
3. **Test pages can be deleted** - Don't spend too much time on these
4. **Focus on verification** - Make sure nothing broke
5. **Document as you go** - Update planning docs with discoveries
6. **Ask for help** - Phase 4 is polish, not critical path

---

## Time Estimates

- **4.1 Workspace Endpoints**: 4-6 hours
- **4.2 Plugin Cleanup**: 2-3 hours
- **4.3 Test Page Refactoring**: 1-2 hours
- **4.4 Verification**: 3-4 hours
- **4.5 Optional Refinements**: 2-4 hours (skip if short on time)

**Total**: 12-19 hours (2-3 working days)

**Realistic Timeline**: Plan for 3 days to account for testing and documentation

---

## Post-Phase 4 Recommendations

After Phase 4 completion, consider:

1. **Community Provider Development**: Create template/guide for third-party providers
2. **Provider Marketplace**: Catalog of available providers
3. **Provider Testing Suite**: Shared tests that all providers must pass
4. **Provider Versioning**: How to handle breaking changes
5. **Provider Documentation**: Comprehensive guide for each provider

These are future enhancements beyond the core decoupling work.
