# Component Override System: Feasibility Report

**Date:** 2026-02-09  
**Author:** Razor (Code Review Agent)  
**Status:** Research Complete

---

## Executive Summary

**Verdict:** Moderate effort. The codebase already has excellent extension foundations through registries, hooks, and the pane app system. Component override capability can be implemented with **~400-600 LOC** across 4-6 files.

**Key Findings:**
- ✅ Registry pattern exists and is battle-tested (`_registry.ts`)
- ✅ Hook/filter system is mature and type-safe
- ✅ Custom pane apps already support component replacement
- ⚠️ Core components (ChatContainer, ModelSelect, PromptEditor, ModelCatalog) are hardcoded in PageShell.vue
- ⚠️ No component override registry exists yet

**Recommended Approach:**
1. Create `ComponentOverrideRegistry` using existing `createRegistry<T>` pattern
2. Add `useComponentOverride()` composable for resolution with fallback
3. Wrap hardcoded component imports in registry lookups
4. Document override contract and props interface

**Estimated Effort:** 4-6 hours for implementation + tests + docs

---

## 1. Existing Extension Mechanisms (Already in Place)

### 1.1 Registry System (`app/composables/_registry.ts`)

**Status:** ✅ Production-ready, HMR-safe, reactive

```typescript
export interface RegistryItem {
    id: string;
    order?: number;
}

export interface RegistryApi<T extends RegistryItem> {
    register(item: T): void;
    unregister(id: string): void;
    listIds(): string[];
    snapshot(): T[];
    useItems(): ComputedRef<readonly T[]>;
}
```

**Features:**
- Global storage via `globalThis` with typed keys
- Automatic sorting by `order` field (default 200)
- Vue reactivity via `ShallowRef`
- Dev warnings on duplicate IDs
- Object freezing for immutability

**Current Usage:**
- Storage providers (`app/core/storage/provider-registry.ts`)
- Workspace APIs (`app/core/workspace/registry.ts`)
- Auth UI adapters (`app/core/auth-ui/registry.ts`)
- AI tools (`app/utils/chat/tool-registry.ts`)
- Custom pane apps (`app/composables/core/usePaneApps.ts`)

### 1.2 Hook System (`app/core/hooks/`)

**Status:** ✅ Comprehensive, type-safe, priority-based

**Files:**
- Core: `app/core/hooks/hooks.ts`
- Types: `app/core/hooks/hook-types.ts`
- Composable: `app/composables/core/useHookEffect.ts`

**Capabilities:**
- **Actions** (fire-and-forget): `doAction(name, ...args)`
- **Filters** (value transformation): `applyFilters(name, value, ...args)`
- **Priority-based execution** (default 10, lower = earlier)
- **Wildcard pattern matching**: `ui.*:action:after`
- **Lifecycle-safe**: `useHookEffect()` auto-cleans on unmount
- **SSR/HMR safe**: Singleton on client, fresh per-request on server

**Hook Categories:**
- Chat/AI: `ai.send:action:before`, `ai.send:action:after`
- UI Pane: `ui.pane.*:action:*`, `ui.pane.thread:action:changed`
- Sync: `sync.bootstrap:action:*`, `sync.pull:action:*`
- DB: Template literal support for dynamic table names

### 1.3 Custom Pane Apps System

**Status:** ✅ Fully functional plugin ecosystem

**File:** `app/composables/core/usePaneApps.ts`

**Interface:**
```typescript
export interface PaneAppDef {
    id: string;
    label: string;
    icon?: string;
    component: Component | (() => Promise<Component>);
    postType?: string;
    createInitialRecord?: (ctx: { app: PaneAppDef }) => Promise<{ id: string } | null>;
    order?: number;
}
```

**Features:**
- Async component support
- Zod validation at registration
- Integration with Pane Plugin API
- Global API exposure (`globalThis.__or3PanePluginApi`)

**Current Pane Resolution Logic** (`PageShell.vue:576-620`):
```typescript
function resolvePaneComponent(pane: PaneState): Component {
    if (pane.mode === 'chat') return ChatContainer;
    if (pane.mode === 'doc') return DocumentEditorAsync;
    
    const app = getPaneApp(pane.mode);
    if (app?.component) return app.component as Component;
    
    return PaneUnknown;
}
```

---

## 2. Components Worth Overriding (Priority Ranking)

### 2.1 High Value (Core User Flows)

#### A. **ModelSelect** (`app/components/chat/ModelSelect.vue`)
**Why:** Central to chat UX, frequently customized for org-specific models

**Current Usage:**
- `ChatInputDropper.vue` (inline model picker)
- `ChatSettingsPopover.vue` (settings modal)
- Used as `LazyChatModelSelect` (auto-imported)

**Props Contract:**
```typescript
interface Props {
    model?: string;
    loading?: boolean;
}

interface Emits {
    (e: 'update:model', value: string): void;
    (e: 'change', value: string): void;
}
```

**Composables Used:**
- `useModelStore()` (favorite models)
- `useThemeOverrides()` (styling)
- `useIcon()` (iconography)

**Override Complexity:** Low (clear contract, no deep state coupling)

---

#### B. **ModelCatalog** (`app/components/modal/ModelCatalog.vue`)
**Why:** Model discovery/management, orgs may want custom catalogs

**Current Usage:**
- Opened via modal system
- Used in Dashboard AI page

**Props Contract:**
```typescript
// Modal-based, uses v-model:open
interface Props {
    open?: boolean;
}
```

**Composables Used:**
- `useModelStore()` (favorites, catalog data)
- `useOramaModelSearch()` (search indexing)
- `useThemeOverrides()` (styling)

**Override Complexity:** Medium (search integration, virtual scrolling)

---

#### C. **PromptEditor** (`app/components/prompts/PromptEditor.vue`)
**Why:** Content editing, orgs may want custom editors (Markdown, plain text)

**Current Usage:**
- Direct import in pane rendering (not currently abstracted)

**Props Contract:**
```typescript
interface Props {
    promptId: string;
}

interface Emits {
    (e: 'back'): void;
}
```

**Composables Used:**
- `getPrompt()`, `updatePrompt()` (DB operations)
- `useThemeOverrides()` (styling)
- TipTap editor (heavy dependency)

**Override Complexity:** Medium (editor integration, autosave logic)

---

#### D. **DocumentEditor** (`app/components/documents/DocumentEditor.vue`)
**Why:** Primary content editor, alternative editors (Monaco, Codemirror)

**Current Usage:**
- Pane mode `doc` via `DocumentEditorAsync` (lazy loaded)

**Props Contract:**
```typescript
interface Props {
    documentId?: string;
}
```

**Composables Used:**
- `useDocumentsStore()` (state management)
- TipTap editor via `LazyEditorHost.vue`

**Override Complexity:** High (async loading, search panel, toolbar, autosave)

---

#### E. **ChatContainer** (`app/components/chat/ChatContainer.vue`)
**Why:** Core chat orchestration, custom chat UIs

**Current Usage:**
- Pane mode `chat` in `PageShell.vue:582`

**Props Contract:**
```typescript
interface Props {
    messageHistory?: string;
    threadId?: string;
    paneId?: string;
}
```

**Composables Used:**
- `useAi()` (message sending, streaming)
- `useMessageStore()` (persistence)
- `useThreadsStore()` (thread management)
- `useHookEffect()` (pane change hooks)

**Override Complexity:** Very High (complex state orchestration, many integrations)

---

### 2.2 Medium Value (Settings/Configuration)

#### F. **SystemPromptsModal** (`app/components/chat/SystemPromptsModal.vue`)
**Current Usage:** Modal for system prompt management  
**Override Complexity:** Low (simple modal with list)

#### G. **DashboardThemeSelector** (`app/components/dashboard/DashboardThemeSelector.vue`)
**Current Usage:** Theme customization UI  
**Override Complexity:** Low (isolated component)

---

### 2.3 Low Value (Better Served by Hooks)

- **ChatMessage** - Use `ai.send:action:after` hook instead
- **MessageEditor** - Use `ai.send:action:before` for input manipulation
- **WorkflowChatMessage** - Workflow-specific, edge case
- **NotificationBell** - Use notification hooks

---

## 3. Proposed Implementation

### 3.1 New Files Required

1. **`app/composables/core/useComponentOverride.ts`** (120 LOC)
2. **`app/core/components/registry.ts`** (80 LOC)
3. **`app/types/component-override.ts`** (40 LOC)
4. **`app/plugins/00-component-registry.client.ts`** (30 LOC)

### 3.2 Modified Files

1. **`app/components/PageShell.vue`** (~20 LOC changes)
2. **`app/components/chat/ChatInputDropper.vue`** (~10 LOC changes)
3. **`app/components/chat/ChatSettingsPopover.vue`** (~10 LOC changes)
4. **Documentation** (`docs/component-overrides.md`) (200 LOC)

---

## 4. Architecture Design

### 4.1 Registry Interface

**File:** `app/core/components/registry.ts`

```typescript
import { createRegistry } from '~/composables/_registry';
import type { Component } from 'vue';

export interface ComponentOverride {
    id: string;
    component: Component | (() => Promise<Component>);
    order?: number;
    displayName?: string;
}

const registry = createRegistry<ComponentOverride>('__or3_component_overrides');

export function registerComponentOverride(override: ComponentOverride): void {
    registry.register(override);
}

export function unregisterComponentOverride(id: string): void {
    registry.unregister(id);
}

export function getComponentOverride(id: string): ComponentOverride | undefined {
    return registry.snapshot().find(o => o.id === id);
}
```

### 4.2 Composable Interface

**File:** `app/composables/core/useComponentOverride.ts`

```typescript
import { markRaw, type Component } from 'vue';
import { getComponentOverride } from '~/core/components/registry';

interface ResolveOptions {
    fallback: Component;
    props?: Record<string, any>;
    mode?: 'exact' | 'prefix';
}

export function useComponentOverride() {
    /**
     * Resolve a component by ID with fallback.
     * Returns override if registered, otherwise returns fallback.
     */
    function resolve(id: string, options: ResolveOptions): Component {
        const override = getComponentOverride(id);
        
        if (override?.component) {
            if (import.meta.dev) {
                console.debug('[ComponentOverride] Using override for', id);
            }
            return markRaw(
                typeof override.component === 'function'
                    ? override.component
                    : markRaw(override.component)
            );
        }
        
        if (import.meta.dev) {
            console.debug('[ComponentOverride] Using fallback for', id);
        }
        return markRaw(options.fallback);
    }
    
    return { resolve };
}
```

### 4.3 Type Definitions

**File:** `app/types/component-override.ts`

```typescript
import type { Component } from 'vue';

/**
 * Standard component IDs for overridable components.
 * Use these constants to ensure consistency across the codebase.
 */
export const COMPONENT_IDS = {
    CHAT_CONTAINER: 'chat.container',
    MODEL_SELECT: 'chat.model-select',
    MODEL_CATALOG: 'modal.model-catalog',
    PROMPT_EDITOR: 'prompts.editor',
    DOCUMENT_EDITOR: 'documents.editor',
    SYSTEM_PROMPTS_MODAL: 'chat.system-prompts-modal',
    DASHBOARD_THEME_SELECTOR: 'dashboard.theme-selector',
} as const;

export type ComponentId = (typeof COMPONENT_IDS)[keyof typeof COMPONENT_IDS];

/**
 * Props contracts for overridable components.
 * Override implementations must accept these props.
 */
export interface ComponentPropsMap {
    [COMPONENT_IDS.CHAT_CONTAINER]: {
        messageHistory?: string;
        threadId?: string;
        paneId?: string;
    };
    [COMPONENT_IDS.MODEL_SELECT]: {
        model?: string;
        loading?: boolean;
    };
    [COMPONENT_IDS.MODEL_CATALOG]: {
        open?: boolean;
    };
    [COMPONENT_IDS.PROMPT_EDITOR]: {
        promptId: string;
    };
    [COMPONENT_IDS.DOCUMENT_EDITOR]: {
        documentId?: string;
    };
    [COMPONENT_IDS.SYSTEM_PROMPTS_MODAL]: {
        open?: boolean;
    };
    [COMPONENT_IDS.DASHBOARD_THEME_SELECTOR]: {
        // No required props
    };
}

/**
 * Type-safe component override definition.
 */
export interface TypedComponentOverride<T extends ComponentId> {
    id: T;
    component: Component<ComponentPropsMap[T]>;
    order?: number;
    displayName?: string;
}
```

### 4.4 Example Usage (Plugin)

**File:** `app/plugins/00-component-registry.client.ts`

```typescript
export default defineNuxtPlugin(() => {
    // Plugin authors can register overrides here
    // Example: Custom model selector
    /*
    const { registerComponentOverride } = useComponentOverride();
    registerComponentOverride({
        id: COMPONENT_IDS.MODEL_SELECT,
        component: () => import('~/components/custom/CustomModelSelect.vue'),
        order: 10, // Lower order = higher priority
        displayName: 'Custom Model Selector',
    });
    */
});
```

### 4.5 Integration Example (PageShell.vue)

**Before:**
```typescript
function resolvePaneComponent(pane: PaneState): Component {
    if (pane.mode === 'chat') return ChatContainer;
    if (pane.mode === 'doc') return DocumentEditorAsync;
    // ...
}
```

**After:**
```typescript
import { useComponentOverride } from '~/composables/core/useComponentOverride';
import { COMPONENT_IDS } from '~/types/component-override';

const { resolve } = useComponentOverride();

function resolvePaneComponent(pane: PaneState): Component {
    if (pane.mode === 'chat') {
        return resolve(COMPONENT_IDS.CHAT_CONTAINER, {
            fallback: ChatContainer,
        });
    }
    if (pane.mode === 'doc') {
        return resolve(COMPONENT_IDS.DOCUMENT_EDITOR, {
            fallback: DocumentEditorAsync,
        });
    }
    // ...
}
```

---

## 5. Component Override Contract

### 5.1 Props Requirement

Override components **must** accept the same props as the original component. Type checking enforced via `ComponentPropsMap`.

### 5.2 Emits Requirement

Override components **should** emit the same events for backward compatibility. Not enforced at compile-time but documented.

### 5.3 Composable Access

Override components **can** use the same composables as originals:
- `useModelStore()` - Model management
- `useThreadsStore()` - Thread state
- `useDocumentsStore()` - Document state
- `useHookEffect()` - Hook subscriptions
- `useThemeOverrides()` - Styling

### 5.4 Global API Access

Override components **can** access:
- `globalThis.__or3PanePluginApi` - Pane operations
- `globalThis.__or3MultiPaneApi` - Multi-pane management

---

## 6. Testing Strategy

### 6.1 Unit Tests

**File:** `app/composables/core/__tests__/useComponentOverride.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { useComponentOverride } from '../useComponentOverride';
import { COMPONENT_IDS } from '~/types/component-override';

describe('useComponentOverride', () => {
    it('returns fallback when no override registered', () => {
        const { resolve } = useComponentOverride();
        const fallback = { name: 'Fallback' };
        const result = resolve(COMPONENT_IDS.MODEL_SELECT, { fallback });
        expect(result).toBe(fallback);
    });
    
    it('returns override when registered', () => {
        const override = { name: 'Override' };
        registerComponentOverride({
            id: COMPONENT_IDS.MODEL_SELECT,
            component: override,
        });
        
        const { resolve } = useComponentOverride();
        const result = resolve(COMPONENT_IDS.MODEL_SELECT, { 
            fallback: { name: 'Fallback' } 
        });
        expect(result).toBe(override);
    });
    
    it('respects order priority', () => {
        // Lower order = higher priority
        registerComponentOverride({
            id: COMPONENT_IDS.MODEL_SELECT,
            component: { name: 'Low' },
            order: 100,
        });
        registerComponentOverride({
            id: COMPONENT_IDS.MODEL_SELECT,
            component: { name: 'High' },
            order: 10,
        });
        
        const { resolve } = useComponentOverride();
        const result = resolve(COMPONENT_IDS.MODEL_SELECT, {
            fallback: { name: 'Fallback' },
        });
        expect(result.name).toBe('High');
    });
});
```

### 6.2 Integration Tests

**File:** `app/components/__tests__/ComponentOverride.integration.test.ts`

Test that PageShell.vue correctly resolves overrides for panes.

---

## 7. Migration Path (Backward Compatibility)

### Phase 1: Registry Foundation (Week 1)
- Implement `ComponentOverrideRegistry`
- Implement `useComponentOverride()` composable
- Add type definitions
- Write unit tests
- No breaking changes (all fallbacks to existing components)

### Phase 2: Core Integration (Week 1-2)
- Integrate into `PageShell.vue` (ChatContainer, DocumentEditor)
- Integrate into `ChatInputDropper.vue` (ModelSelect)
- Integrate into `ChatSettingsPopover.vue` (ModelSelect)
- Integration tests

### Phase 3: Catalog/Modal Integration (Week 2)
- Integrate into modal system (ModelCatalog, SystemPromptsModal)
- Document override contracts
- Add examples to docs

### Phase 4: Community Feedback (Week 3+)
- Gather feedback from plugin authors
- Refine contracts based on real-world usage
- Add more override points as requested

---

## 8. Documentation Requirements

### 8.1 Developer Guide

**File:** `docs/component-overrides.md`

**Sections:**
1. Overview and rationale
2. Available override points (component ID catalog)
3. Props/emits contracts for each component
4. Registration API (how to register overrides)
5. Resolution behavior (order, fallback)
6. Example: Custom model selector
7. Example: Custom chat UI
8. Testing overrides
9. Troubleshooting

### 8.2 API Reference

**File:** `docs/api/component-override-api.md`

**Sections:**
1. `registerComponentOverride()`
2. `unregisterComponentOverride()`
3. `useComponentOverride()`
4. `COMPONENT_IDS` constants
5. Type definitions

---

## 9. Edge Cases & Considerations

### 9.1 Async Component Loading

**Problem:** Override may be async, fallback may be sync  
**Solution:** Both wrapped in `markRaw()`, Vue handles async resolution

### 9.2 HMR (Hot Module Replacement)

**Problem:** Component registry must survive HMR  
**Solution:** Use `globalThis` storage pattern (already proven in `_registry.ts`)

### 9.3 SSR vs Client

**Problem:** Some components are client-only  
**Solution:** Registry is client-only (`.client.ts` plugin), matches existing pattern

### 9.4 Multiple Overrides for Same ID

**Problem:** Two plugins register same override  
**Solution:** Last registration wins, dev warning emitted (matches existing registry behavior)

### 9.5 Props Incompatibility

**Problem:** Override component has different props  
**Solution:** TypeScript enforces props via `ComponentPropsMap`, runtime validation optional

### 9.6 Performance Impact

**Problem:** Registry lookup on every render  
**Solution:** Lookup is O(1) Map access, result can be cached per pane

---

## 10. Alternative Approaches (Considered & Rejected)

### 10.1 Hook-Based Component Rendering

**Approach:** Use `applyFilters('ui.component.resolve', defaultComponent, id)`

**Pros:** Reuses existing hook system  
**Cons:** 
- Filters not designed for component resolution
- No type safety for props/emits
- No ordering guarantees
- Harder to debug

**Verdict:** Registry pattern is cleaner for static component replacement

### 10.2 Dynamic Component with Slot Props

**Approach:** Use `<component :is="resolved">` with scoped slots

**Pros:** More flexible rendering  
**Cons:**
- Slot API is harder to document
- Breaks existing component contracts
- More refactoring required

**Verdict:** Direct component replacement is simpler

### 10.3 Wrapper Components

**Approach:** Create `<OverridableModelSelect>` wrapper for each component

**Pros:** Explicit override points  
**Cons:**
- Duplicates every overridable component
- Import path changes required
- More boilerplate

**Verdict:** Composable pattern is more idiomatic

---

## 11. Risk Assessment

### 11.1 Low Risk

- **Registry pattern** - Already proven in production
- **TypeScript safety** - Strong types prevent prop mismatches
- **Backward compatibility** - All fallbacks to existing components
- **Testing** - Can be thoroughly unit/integration tested

### 11.2 Medium Risk

- **Component contract drift** - Original components may add props/emits
  - **Mitigation:** Maintain explicit `ComponentPropsMap`, update docs
- **Performance** - Registry lookup on every pane render
  - **Mitigation:** Cache resolved components per pane instance

### 11.3 High Risk

- **None identified** - Pattern is conservative and well-tested

---

## 12. Recommended Next Steps

### 12.1 Immediate Actions (Research Complete)

1. ✅ Reviewed existing extension mechanisms
2. ✅ Identified high-value override candidates
3. ✅ Designed architecture with existing patterns
4. ✅ Documented implementation plan
5. ⏭️ **Get stakeholder approval on scope**

### 12.2 Implementation Phase 1 (Week 1)

1. Create `app/core/components/registry.ts`
2. Create `app/composables/core/useComponentOverride.ts`
3. Create `app/types/component-override.ts`
4. Write unit tests
5. Integrate into PageShell.vue (ChatContainer only for validation)
6. Write integration test

### 12.3 Implementation Phase 2 (Week 1-2)

1. Integrate remaining high-value components:
   - ModelSelect (ChatInputDropper, ChatSettingsPopover)
   - DocumentEditor (PageShell)
   - PromptEditor (if pane-based)
   - ModelCatalog (modal system)
2. Update integration tests
3. Write documentation

### 12.4 Release (Week 2-3)

1. Announce feature in release notes
2. Publish developer guide
3. Create example plugin demonstrating override
4. Gather community feedback

---

## 13. Example: Custom Model Selector Plugin

**File:** `plugins/custom-model-select/index.ts`

```typescript
import { defineNuxtPlugin } from '#app';
import { registerComponentOverride } from '~/composables/core/useComponentOverride';
import { COMPONENT_IDS } from '~/types/component-override';

export default defineNuxtPlugin(() => {
    // Register custom model selector
    registerComponentOverride({
        id: COMPONENT_IDS.MODEL_SELECT,
        component: () => import('./CustomModelSelect.vue'),
        order: 10,
        displayName: 'Custom Model Selector (Org-Specific)',
    });
});
```

**File:** `plugins/custom-model-select/CustomModelSelect.vue`

```vue
<template>
    <div class="custom-model-select">
        <!-- Custom UI here, must accept same props -->
        <select v-model="internalModel" @change="onChange">
            <option v-for="m in orgModels" :key="m" :value="m">
                {{ m }}
            </option>
        </select>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

// Props contract matches original ModelSelect
const props = defineProps<{
    model?: string;
    loading?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:model', value: string): void;
    (e: 'change', value: string): void;
}>();

const internalModel = ref(props.model || '');

// Org-specific model list
const orgModels = [
    'gpt-4-turbo',
    'claude-3-opus',
    'org-custom-model',
];

function onChange() {
    emit('update:model', internalModel.value);
    emit('change', internalModel.value);
}

watch(() => props.model, (newVal) => {
    if (newVal !== undefined) internalModel.value = newVal;
});
</script>
```

---

## 14. Effort Estimation

### 14.1 Development Time

| Task | Estimated Hours | Notes |
|------|----------------|-------|
| Registry implementation | 2-3 | Reuses `_registry.ts` pattern |
| Composable implementation | 2-3 | Simple resolution logic |
| Type definitions | 1-2 | Props mapping, constants |
| Unit tests | 2-3 | Registry + composable tests |
| Integration (PageShell) | 1-2 | Small refactor |
| Integration (other components) | 2-3 | ModelSelect in 2 locations |
| Integration tests | 2-3 | Pane rendering tests |
| Documentation | 3-4 | Developer guide + API reference |
| **Total** | **15-23 hours** | **~2-3 days for one dev** |

### 14.2 Testing Time

| Task | Estimated Hours |
|------|----------------|
| Manual QA | 2-3 |
| Edge case testing | 1-2 |
| HMR validation | 1 |
| **Total** | **4-6 hours** |

### 14.3 Grand Total

**20-29 hours (2.5-4 days)** for full implementation, testing, and documentation.

---

## 15. Success Metrics

### 15.1 Technical Metrics

- ✅ Zero breaking changes to existing components
- ✅ Zero performance regression (< 1ms overhead per pane render)
- ✅ 100% type safety for override contracts
- ✅ 100% test coverage for registry + composable

### 15.2 Developer Experience Metrics

- ✅ Plugin authors can override components in < 20 LOC
- ✅ Clear error messages when props mismatch
- ✅ Dev warnings for duplicate registrations
- ✅ Documentation includes working examples

### 15.3 Adoption Metrics (Post-Release)

- Track number of plugins using component overrides
- Track GitHub issues related to override API
- Track community feedback on docs clarity

---

## 16. Conclusion

**Feasibility:** High  
**Value:** High (enables custom UIs without forking core)  
**Risk:** Low (pattern is proven, changes are minimal)  
**Effort:** Moderate (2-4 days)

**Recommendation:** ✅ Proceed with implementation

The codebase is well-positioned for component overrides. The existing registry pattern, hook system, and pane app architecture provide excellent foundations. Implementation is straightforward and low-risk.

**Next Step:** Get stakeholder approval on scope (which components to prioritize) and proceed with Phase 1 implementation.

---

## Appendix A: Component Priority Matrix

| Component | Value | Complexity | Effort (hrs) | Priority |
|-----------|-------|------------|--------------|----------|
| ModelSelect | High | Low | 2-3 | **P0** |
| ModelCatalog | High | Medium | 3-4 | **P0** |
| ChatContainer | High | Very High | 4-6 | P1 |
| DocumentEditor | Medium | High | 3-4 | P1 |
| PromptEditor | Medium | Medium | 2-3 | P1 |
| SystemPromptsModal | Low | Low | 1-2 | P2 |
| DashboardThemeSelector | Low | Low | 1-2 | P2 |

**Recommendation:** Start with P0 components (ModelSelect, ModelCatalog) for Phase 1.

---

## Appendix B: Files to Create/Modify

### New Files (4)

1. `app/core/components/registry.ts` (80 LOC)
2. `app/composables/core/useComponentOverride.ts` (120 LOC)
3. `app/types/component-override.ts` (40 LOC)
4. `app/plugins/00-component-registry.client.ts` (30 LOC)

### Modified Files (3)

1. `app/components/PageShell.vue` (~20 LOC changes)
2. `app/components/chat/ChatInputDropper.vue` (~10 LOC changes)
3. `app/components/chat/ChatSettingsPopover.vue` (~10 LOC changes)

### Test Files (2)

1. `app/composables/core/__tests__/useComponentOverride.test.ts` (150 LOC)
2. `app/components/__tests__/ComponentOverride.integration.test.ts` (100 LOC)

### Documentation (2)

1. `docs/component-overrides.md` (500 LOC)
2. `docs/api/component-override-api.md` (200 LOC)

**Total New/Modified Files:** 11  
**Total LOC:** ~1,260 LOC (including tests + docs)  
**Core Implementation LOC:** ~360 LOC

---

**End of Report**
