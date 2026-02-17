# OR3 Cloud - Prioritized Action Plan

**Based on comprehensive code review - 2026-02-17**

This document provides a practical, time-boxed action plan for addressing findings from the pre-merge code review.

---

## Phase 0: Merge Decision (NOW)

**Decision**: ✅ **MERGE NOW**

**Rationale**:
- No blocking issues found
- Security is excellent
- Tests are comprehensive
- Architecture is solid
- Identified issues are optimizations, not bugs

**Merge confidence**: HIGH

---

## Phase 1: Quick Wins (1-2 hours)

**Do this week after merge**

### 1.1 Fix Promise Chains (10 minutes)

**File**: `app/components/modal/ModelCatalog.vue`

```typescript
// BEFORE (lines 346-353)
onMounted(() => {
    fetchModels().then(() => {
        modelCatalog.value = catalog.value;
    });

    getFavoriteModels().then((models) => {
        favoriteModels.value = models;
    });
});

// AFTER
onMounted(async () => {
    try {
        await fetchModels();
        modelCatalog.value = catalog.value;
    } catch (error) {
        console.error('[ModelCatalog] Failed to load models:', error);
    }

    try {
        const models = await getFavoriteModels();
        favoriteModels.value = models;
    } catch (error) {
        console.error('[ModelCatalog] Failed to load favorites:', error);
    }
});
```

**Impact**: Better error visibility  
**Risk**: Low  
**Test**: Manual - open model catalog, verify it loads

---

### 1.2 Fix Failing Test (30 minutes)

**File**: `tests/stubs/nuxt-imports.ts`

```typescript
// Add to existing mocks:
export const useRuntimeConfig = vi.fn(() => ({
    public: {
        features: {
            workflows: { enabled: true },
            chat: { enabled: true },
            // ... other features
        },
        // ... other public config
    },
    // ... private config if needed
}));
```

**Impact**: Test suite 100% passing  
**Risk**: None  
**Test**: `npm run test -- SideNavContentCollapsed.test.ts`

---

### 1.3 Add Debouncing to Input Handlers (45 minutes)

**Files**: 
- `app/components/theme/TypographySection.vue`
- `app/pages/ai.vue`  
- `app/theme/components/BackgroundLayerEditor.vue`

```typescript
// Add to each file:
import { useDebounceFn } from '@vueuse/core';

// Replace direct handlers with:
const debouncedInput = useDebounceFn((event) => {
    // Original handler code
}, 120); // 120ms debounce

// In template:
<input @input="debouncedInput" />
```

**Impact**: Smoother UX during rapid input  
**Risk**: Low  
**Test**: Manual - type quickly in affected inputs, verify no lag

---

**Total Phase 1 Time**: ~1.5 hours  
**Value**: High - Immediate UX improvements

---

## Phase 2: Code Quality (1 week)

**Target: Week of 2026-02-24**

### 2.1 Consolidate Rate Limiters (2-3 hours)

**Problem**: Two implementations

**Plan**:
1. Audit all consumers of `server/utils/rate-limit.ts`
2. Migrate to `server/utils/sync/rate-limiter.ts`
3. Update imports
4. Delete `server/utils/rate-limit.ts`
5. Run tests

**Files affected**: ~10-15 import statements

**Impact**: Consistent rate limiting  
**Risk**: Medium - Requires careful migration  
**Test**: Full test suite + manual API testing

---

### 2.2 Add Error Handling to Admin Pages (2 hours)

**Files**:
- `app/pages/admin/plugins.vue`
- `app/pages/admin/admin-users.vue`
- `app/pages/admin/system.vue`
- `app/pages/admin/workspaces/[id].vue`

**Pattern**:
```typescript
async function adminAction() {
    try {
        await $fetch('/api/admin/...', { ... });
        toast.add({ title: 'Success', color: 'success' });
    } catch (error) {
        console.error('[Admin] Action failed:', error);
        toast.add({ 
            title: 'Action failed', 
            description: error.message,
            color: 'error' 
        });
    }
}
```

**Impact**: Better admin UX  
**Risk**: Low  
**Test**: Manual - test each admin action

---

### 2.3 Fix Deep Watchers (30 minutes)

**Files**:
- `app/components/dashboard/theme/ColorPaletteSection.vue`
- `app/composables/theme/useUserThemeOverrides.ts`

```typescript
// BEFORE
watch(overrides, handler, { deep: true });

// AFTER
const overrideKeys = computed(() => JSON.stringify(overrides.value));
watch(overrideKeys, handler);

// OR use toRaw for reference comparison
const overridesRef = toRaw(overrides.value);
watch(() => overridesRef, handler, { deep: false });
```

**Impact**: 5-10ms performance improvement in theme editor  
**Risk**: Low  
**Test**: Manual - edit theme, verify saves work

---

**Total Phase 2 Time**: ~6-8 hours  
**Value**: High - Production quality improvements

---

## Phase 3: Component Refactoring (2-3 weeks)

**Target: March 2026**

### 3.1 Extract useAi.ts (1 day - 6-8 hours)

**File**: `app/composables/chat/useAi.ts` (2103 lines)

**Plan**:
1. Extract to `useAi-internal/`:
   - `message-preparation.ts` - Build messages for model
   - `streaming-handlers.ts` - Stream lifecycle
   - `tool-calling.ts` - Tool execution logic
   - `background-jobs.ts` - Already exists, good!

2. Main file keeps:
   - Public API surface
   - Hook orchestration
   - State management
   - ~800 lines target

**Impact**: Maintainability  
**Risk**: Medium - Core functionality  
**Test**: Full chat test suite

---

### 3.2 Extract SideBar.vue (1 day - 6-8 hours)

**File**: `app/components/sidebar/SideBar.vue` (1324 lines)

**Extract to**:
- `SidebarRenameModal.vue`
- `SidebarDeleteModal.vue`
- `SidebarProjectTree.vue`
- `SidebarChatList.vue`

**Main file target**: ~400 lines

**Impact**: Maintainability  
**Risk**: Medium - Core UI  
**Test**: Manual sidebar testing

---

### 3.3 Extract ChatInputDropper.vue (1 day - 6-8 hours)

**File**: `app/components/chat/ChatInputDropper.vue` (1261 lines)

**Extract to**:
- `ChatInputAttachments.vue` - File upload UI
- `ChatInputSettings.vue` - Settings popover
- `ChatInputToolbar.vue` - Bottom controls

**Main file target**: ~600 lines

**Impact**: Maintainability  
**Risk**: Medium - Core chat UI  
**Test**: Full chat input testing

---

### 3.4 Extract WorkflowExecutionStatus.vue (4 hours)

**File**: `app/components/chat/WorkflowExecutionStatus.vue` (1115 lines)

**Extract to**:
- `WorkflowNode.vue` - Single node render
- `WorkflowApprovalDialog.vue` - HITL
- `useWorkflowStatusHelpers.ts` - Helper functions

**Main file target**: ~500 lines

**Impact**: Maintainability  
**Risk**: Low - Well isolated  
**Test**: Workflow execution tests

---

**Total Phase 3 Time**: ~20-24 hours over 2-3 weeks  
**Value**: Medium - Long-term maintainability

---

## Phase 4: Type Safety Improvements (2 weeks)

**Target: Late March 2026**

### 4.1 Remove `any` from Production Code (8-12 hours)

**Priority order**:
1. `app/plugins/90.theme.client.ts` - 6 instances
2. `app/components/chat/ChatInputDropper.vue:30` - Editor type
3. `app/core/hooks/typed-hooks.ts` - 18 instances
4. `app/plugins/WorkflowSlashCommands/executeWorkflow.ts` - 10 instances

**Strategy**: 
- Create proper type definitions
- Use generics where appropriate
- Extract complex types to `types/`

**Impact**: Type safety  
**Risk**: Low - Type-level only  
**Test**: `npm run type-check`

---

### 4.2 Improve Third-Party Types (4-6 hours)

**Files**:
- `types/orama.d.ts`
- `types/pwa.d.ts`
- `types/streamsaver.d.ts`

**Plan**:
- Create detailed type shims
- Consider contributing upstream
- Document type limitations

**Impact**: Better autocomplete  
**Risk**: Low  
**Test**: Type-check + manual usage

---

**Total Phase 4 Time**: ~12-18 hours  
**Value**: Medium - Developer experience

---

## Phase 5: Registry Pattern Consolidation (1 day)

**Target**: Q2 2026

### 5.1 Create Generic Registry (2 hours)

**New file**: `shared/utils/registry.ts`

```typescript
export interface Registry<T> {
    register(key: string, value: T): void;
    get(key: string): T | null;
    has(key: string): boolean;
    list(): T[];
    clear(): void;
}

export function createRegistry<T>(): Registry<T> {
    const store = new Map<string, T>();
    return {
        register(key, value) { 
            store.set(key, value); 
        },
        get(key) { 
            return store.get(key) ?? null; 
        },
        has(key) {
            return store.has(key);
        },
        list() { 
            return Array.from(store.values()); 
        },
        clear() {
            store.clear();
        },
    };
}
```

---

### 5.2 Migrate All Registries (4-6 hours)

**Files to migrate**:
- `server/utils/rate-limit/registry.ts`
- `server/auth/store/registry.ts`
- `server/auth/registry.ts`
- `server/sync/gateway/registry.ts`
- `server/storage/gateway/registry.ts`
- `app/core/storage/provider-registry.ts`
- `app/core/workspace/registry.ts`

**Impact**: -200 lines of duplicate code  
**Risk**: Medium - Used everywhere  
**Test**: Full test suite

---

**Total Phase 5 Time**: ~6-8 hours  
**Value**: High - Code reduction

---

## Phase 6: Dependency Maintenance (Ongoing)

### 6.1 NPM Audit (30 minutes/month)

```bash
npm audit
npm audit fix
# Review breaking changes
npm audit fix --force  # Only if safe
```

---

### 6.2 Monitor TipTap Compatibility (Weekly)

Track `tiptap-markdown` for v3 support:
- GitHub issues
- Package updates
- Consider alternatives if stale

---

### 6.3 Update Deprecated Deps (Quarterly)

```bash
# Check for updates
npm outdated

# Update non-breaking
npm update

# Test thoroughly
npm test
```

---

## Timeline Overview

```
Week 1 (Now):
  ✅ Merge to master
  → Phase 1: Quick wins (1-2 hours)

Week 2:
  → Phase 2: Code quality (6-8 hours)

Weeks 3-5:
  → Phase 3: Component refactoring (20-24 hours)
  
Weeks 6-7:
  → Phase 4: Type safety (12-18 hours)

Week 8+:
  → Phase 5: Registry consolidation (6-8 hours)
  → Phase 6: Ongoing maintenance
```

---

## Success Metrics

### Phase 1 (Quick Wins)
- [ ] Test suite 100% passing
- [ ] No unhandled promise rejections in logs
- [ ] Smooth input in theme editor

### Phase 2 (Code Quality)
- [ ] Single rate limiter implementation
- [ ] Toast notifications on all admin errors
- [ ] Theme editor <5ms render time

### Phase 3 (Component Refactoring)
- [ ] No files >1000 lines in app/components
- [ ] Main composables <800 lines
- [ ] Test coverage maintained

### Phase 4 (Type Safety)
- [ ] <50 explicit `any` in production code
- [ ] `npm run type-check` passes with no errors
- [ ] Better IDE autocomplete

### Phase 5 (Registry Consolidation)
- [ ] Single registry implementation
- [ ] -200 lines of code
- [ ] All tests passing

---

## Risk Mitigation

### High-Risk Changes
- Rate limiter consolidation
- useAi.ts extraction
- Large component refactoring

**Strategy**:
1. Feature flag new code
2. Run in parallel temporarily
3. Compare behavior
4. Switch traffic gradually
5. Monitor errors
6. Rollback plan ready

### Medium-Risk Changes
- Type safety improvements
- Registry consolidation

**Strategy**:
1. Comprehensive tests first
2. Change one file at a time
3. Run full suite between changes
4. Manual smoke testing

### Low-Risk Changes
- Promise chain fixes
- Debouncing additions
- Test fixes

**Strategy**:
1. Make change
2. Test locally
3. Commit
4. Move on

---

## Rollback Plans

### If Phase 1 causes issues:
- Revert individual commits
- Quick fixes are independent

### If Phase 2 causes issues:
- Rate limiter: Keep old one, revert imports
- Error handling: Remove try-catch, logs harmless
- Deep watchers: Revert to deep: true

### If Phase 3 causes issues:
- Component extractions: Inline components back
- Tests should catch breaking changes

---

## Communication

### Before Each Phase
- [ ] Review plan with team
- [ ] Identify testing needs
- [ ] Schedule for low-traffic time

### During Each Phase
- [ ] Commit frequently
- [ ] Update PR descriptions
- [ ] Note any blockers

### After Each Phase
- [ ] Run full test suite
- [ ] Manual smoke test
- [ ] Update documentation
- [ ] Report progress

---

## Questions?

**Not sure where to start?**  
→ Start with Phase 1 (1-2 hours of quick wins)

**Tight on time?**  
→ Phase 1 + 2.1 (Rate limiters) gives best ROI

**Want max impact?**  
→ Complete Phases 1-2, then tackle largest file (useAi.ts)

**Maintenance mode?**  
→ Phase 1 + Phase 6 (dependencies) is sufficient

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-17  
**Author**: Razor (Surgical Code Review Agent)
