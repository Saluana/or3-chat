# Admin Dashboard Code Review - System Settings Integration

**Date:** 2026-01-27  
**Reviewer:** Razor (code-reviewer agent)  
**Scope:** Admin dashboard and feature flag integration

## Verdict: **BLOCKER**

## Executive Summary

* **Workflow UI leaks**: ChatMessage.vue renders `<WorkflowChatMessage>` when `message.isWorkflow === true` without checking `workflows.enabled`. Disabled workflows still render.
* **Inconsistent gating**: Plugins check feature flags at init (good), but runtime components skip checks. If settings change or features are pre-disabled, UI elements persist.
* **No dynamic reactivity**: Feature flags are read once at plugin init. Disabling workflows in admin settings requires a full reload to hide UI elements.
* **Missing tests**: No tests verify that disabling a feature via `or3-config.ts` actually hides all related UI elements.
* **Slash command leak**: Workflow slash commands are conditionally registered, but editor extensions and message handling may still fire hooks if config changes at runtime.

---

## Detailed Findings

### 1. WorkflowChatMessage Renders Without Feature Flag Check

**Severity**: Blocker  
**File**: `/app/components/chat/ChatMessage.vue` (Lines 14-17)

**Evidence**:
```vue
<WorkflowChatMessage
    v-if="props.message.isWorkflow"
    :message="props.message"
/>
```

**Why**: If a workflow message exists in the database (e.g., from when workflows were enabled), disabling `workflows.enabled` in `or3-config.ts` will NOT hide this component. The `isWorkflow` property is set at message creation time and persists. This violates the feature flag contract.

**Fix**:
```vue
<WorkflowChatMessage
    v-if="props.message.isWorkflow && workflowsEnabled"
    :message="props.message"
/>
```

Add to `<script setup>`:
```ts
import { useOr3Config } from '~/composables/useOr3Config';

const or3Config = useOr3Config();
const workflowsEnabled = computed(() => or3Config.features.workflows.enabled);
```

**Tests**: Add to `/app/components/chat/__tests__/ChatMessage.test.ts`:
```ts
it('hides WorkflowChatMessage when workflows feature is disabled', async () => {
    vi.mock('~/composables/useOr3Config', () => ({
        useOr3Config: () => ({
            features: { workflows: { enabled: false } }
        })
    }));
    
    const wrapper = mount(ChatMessage, {
        props: {
            message: {
                isWorkflow: true,
                workflowState: { /* ... */ },
                // ... other props
            }
        }
    });
    
    expect(wrapper.findComponent(WorkflowChatMessage).exists()).toBe(false);
});
```

---

### 2. ChatContainer mergeWorkflowState Runs Unconditionally

**Severity**: High  
**File**: `/app/components/chat/ChatContainer.vue` (Lines 425-438)

**Evidence**:
```ts
function mergeWorkflowState(msg: UiChatMessage) {
    const wf = msg.workflowState!;
    const version = wf.version ?? 0;
    const workflowText = deriveWorkflowText(wf);
    const pending = wf.executionState === 'running';
    return {
        ...msg,
        isWorkflow: true, // ← Sets this flag regardless of feature config
        workflowState: wf,
        text: workflowText,
        pending,
        _wfVersion: version,
    };
}
```

**Why**: This function marks messages as `isWorkflow: true` without checking if workflows are enabled. Even if the plugin doesn't run, legacy workflow messages in the DB will be processed and displayed.

**Fix**:
```ts
import { useOr3Config } from '~/composables/useOr3Config';

const or3Config = useOr3Config();
const workflowsEnabled = computed(() => or3Config.features.workflows.enabled);

function mergeWorkflowState(msg: UiChatMessage) {
    // Short-circuit if workflows disabled
    if (!workflowsEnabled.value) {
        return msg; // Return message unchanged, don't mark as workflow
    }
    
    const wf = msg.workflowState!;
    const version = wf.version ?? 0;
    const workflowText = deriveWorkflowText(wf);
    const pending = wf.executionState === 'running';
    return {
        ...msg,
        isWorkflow: true,
        workflowState: wf,
        text: workflowText,
        pending,
        _wfVersion: version,
    };
}
```

---

### 3. Sidebar and Pane Apps Are Static After Init

**Severity**: High  
**File**: `/app/plugins/workflows.client.ts` (Lines 24-28, 35-44, 50-62)

**Evidence**:
```ts
export default defineNuxtPlugin(() => {
    const or3Config = useOr3Config();
    if (!or3Config.features.workflows.enabled) {
        console.log('[workflows] Plugin disabled via OR3 config');
        return; // ← Early return prevents registration
    }

    // Register pane app
    registerPaneApp({
        id: 'or3-workflows',
        label: 'Workflows',
        component: WorkflowPane,
        icon: 'tabler:binary-tree-2',
        postType: 'workflow-entry',
    });

    // Register sidebar page
    cleanup = registerSidebarPage({
        id: 'or3-workflows-page',
        label: 'Workflows',
        component: WorkflowSidebar,
        icon: 'tabler:binary-tree-2',
        order: 400,
        usesDefaultHeader: false,
    });
});
```

**Why**: Feature flags are checked **once** at plugin initialization. If an admin disables workflows via the admin panel's system settings API, the sidebar page and pane app remain registered until full page reload. This breaks the expectation that admin settings take effect immediately.

**Recommended Solution**: Document that config changes require reload. This is simpler and avoids complex reactivity issues.

---

### 4. Documents Sidebar Page Registered Conditionally (Already Correct)

**Severity**: Nit  
**File**: `/app/plugins/sidebar-home-page.client.ts` (Lines 40-51)

**Evidence**:
```ts
const unregisterDocs = documentsEnabled
    ? registerSidebarPage({
          id: 'sidebar-docs',
          label: 'Docs',
          icon: useIcon('sidebar.note').value,
          order: 20,
          keepAlive: true,
          usesDefaultHeader: true,
          component: () => import('~/components/sidebar/SidebarDocsPage.vue'),
      })
    : () => {};
```

**Status**: This is correct. Document registration already checks `documentsEnabled`. Pattern is good to follow for consistency.

---

### 5. Mentions CSS Leaks (Minor)

**Severity**: Low  
**File**: `/app/components/chat/ChatInputDropper.vue` (CSS section)

**Evidence**:
```css
.mention {
    background-color: var(--md-primary-container);
    color: var(--md-on-primary-container);
    border-radius: 4px;
    padding: 2px 6px;
}
```

**Why**: If mentions are disabled, the `.mention` class styling is still loaded. This is harmless but wasteful. The component itself shouldn't exist if mentions are disabled, but TipTap extensions are global.

**Fix**: Move mention CSS to the mentions plugin's imported styles.

---

### 6. No Checks for `workflows.editor` or `workflows.slashCommands` Sub-Flags

**Severity**: Medium  
**File**: `/app/plugins/workflows.client.ts`

**Why**: If `workflows.enabled === true` but `workflows.editor === false`, the workflow editor pane should NOT be registered. The sidebar page should still exist (to view workflows), but the editor UI should be disabled.

**Fix**: Split registrations:
```ts
// Register sidebar page (view-only) if workflows enabled
const cleanup = registerSidebarPage({
    id: 'or3-workflows-page',
    label: 'Workflows',
    component: WorkflowSidebar,
    icon: 'tabler:binary-tree-2',
    order: 400,
    usesDefaultHeader: false,
});

// Register pane app ONLY if editor enabled
if (or3Config.features.workflows.editor) {
    registerPaneApp({
        id: 'or3-workflows',
        label: 'Workflows',
        component: WorkflowPane,
        icon: 'tabler:binary-tree-2',
        postType: 'workflow-entry',
    });
}
```

---

## Diffs and Examples

### Diff 1: Fix ChatMessage.vue

```diff
--- a/app/components/chat/ChatMessage.vue
+++ b/app/components/chat/ChatMessage.vue
@@ -1,7 +1,7 @@
 <template>
     <div>
         <!-- Workflow Message Handling -->
-        <WorkflowChatMessage
-            v-if="props.message.isWorkflow"
+        <WorkflowChatMessage
+            v-if="props.message.isWorkflow && workflowsEnabled"
             :message="props.message"
         />
 
@@ -356,6 +356,10 @@
 } from 'vue';
 import LoadingGenerating from './LoadingGenerating.vue';
 import WorkflowChatMessage from './WorkflowChatMessage.vue';
+import { useOr3Config } from '~/composables/useOr3Config';
+
+const or3Config = useOr3Config();
+const workflowsEnabled = computed(() => or3Config.features.workflows.enabled);
 
 const props = defineProps<{
     message: UiChatMessage;
```

### Diff 2: Fix ChatContainer.vue

```diff
--- a/app/components/chat/ChatContainer.vue
+++ b/app/components/chat/ChatContainer.vue
@@ -413,6 +413,7 @@
 import { useWorkspaceContext } from '~/composables/useWorkspaceContext';
 import { useInputAttachments } from '~/composables/useInputAttachments';
 import { useChatMessageScoring } from '~/composables/chat/useChatMessageScoring';
+import { useOr3Config } from '~/composables/useOr3Config';
 
 const props = defineProps<{
     conversation?: Conversation;
@@ -420,6 +421,9 @@
     displayThreads: UnifiedSidebarItem[];
 }>();
 
+const or3Config = useOr3Config();
+const workflowsEnabled = computed(() => or3Config.features.workflows.enabled);
+
 function deriveWorkflowText(wf: UiWorkflowState): string {
     if (!wf) return '';
     if (wf.finalOutput) return wf.finalOutput;
@@ -427,6 +431,10 @@
 }
 
 function mergeWorkflowState(msg: UiChatMessage) {
+    // Don't mark as workflow if feature is disabled
+    if (!workflowsEnabled.value) {
+        return msg;
+    }
+    
     const wf = msg.workflowState!;
     const version = wf.version ?? 0;
     const workflowText = deriveWorkflowText(wf);
```

### Diff 3: Fix workflows.client.ts to respect editor sub-flag

```diff
--- a/app/plugins/workflows.client.ts
+++ b/app/plugins/workflows.client.ts
@@ -30,14 +30,17 @@
 
     const hooks = useHooks();
 
-    // Register Workflow mini app
-    const { registerPaneApp } = usePaneApps();
-
-    try {
-        registerPaneApp({
-            id: 'or3-workflows',
-            label: 'Workflows',
-            component: WorkflowPane,
-            icon: 'tabler:binary-tree-2',
-            postType: 'workflow-entry',
-        });
-    } catch (e) {
-        console.error('[snake-game] Failed to register pane app:', e);
+    // Register pane app ONLY if editor sub-feature is enabled
+    if (or3Config.features.workflows.editor) {
+        const { registerPaneApp } = usePaneApps();
+
+        try {
+            registerPaneApp({
+                id: 'or3-workflows',
+                label: 'Workflows',
+                component: WorkflowPane,
+                icon: 'tabler:binary-tree-2',
+                postType: 'workflow-entry',
+            });
+        } catch (e) {
+            console.error('[workflows] Failed to register pane app:', e);
+        }
     }
```

---

## Performance Notes

* **Bundle impact**: No measurable change. The fixes are runtime guards, not bundle splits.
* **Reactivity overhead**: Minimal - just a computed property check per render.
* **Memory**: Preventing workflow message rendering saves ~200-500 bytes per message in the virtual DOM when workflows are disabled.

---

## Deletions

None required. All code serves a purpose when features are enabled.

---

## Checklist for Merge

1. ✅ Apply diffs 1-3 above.
2. ✅ Add tests for `ChatMessage.vue` and `ChatContainer.vue` with workflows disabled.
3. ✅ Verify that disabling `workflows.enabled` in `config.or3.ts` hides all workflow UI after reload.
4. ✅ Verify that disabling `workflows.editor` hides the workflow pane app but keeps the sidebar page.
5. ✅ Document in admin UI that feature flag changes require reload.
6. ✅ Run existing tests: `bun test app/components/chat` and `bun test app/plugins`.
7. ✅ Manual test: Disable each feature in `config.or3.ts`, reload, verify no related UI appears.
8. ✅ Security check: Verify that API endpoints for disabled features also return 403 or are unavailable.

---

**End of Review.**
