# Workflow Message Integration - Implementation Tasks

## Overview

This task list implements the workflow/agent message integration into the chat interface. Tasks are ordered by dependency and grouped by component/feature area.

**⚠️ ZERO BREAKING CHANGES:** All tasks are additive. No schema migrations, no version bumps, no existing behavior modifications.

---

## Phase 1: Data Model Foundation

### 1. Create Workflow Type Definitions (NO schema changes)

-   [x] **1.1 Create workflow-types.ts (v2 Update - Message Type Discriminator)**

    -   File: `app/utils/chat/workflow-types.ts`
    -   Define `NodeExecutionStatus` type: `'pending' | 'running' | 'completed' | 'error'`
    -   Define `WorkflowExecutionState` type: `'idle' | 'running' | 'completed' | 'error' | 'stopped'`
    -   Define `NodeState` interface
    -   Define `BranchState` interface
    -   Define `WorkflowMessageData` interface with `type: 'workflow-execution'` discriminator
    -   **v2 Addition:** Define base message type with `type: 'message'` for non-workflow messages
    -   Create `isWorkflowMessageData(data)` type guard for discriminated union
    -   Create message type union for safe type narrowing
    -   Requirements: 1.1, 1.2, v2 default message typing
    -   **No breaking changes:** New file, no modifications to existing code

-   [x] **1.2 Extend UiChatMessage interface (additive only)**

    -   File: `app/utils/chat/uiMessages.ts`
    -   Add `isWorkflow?: boolean` field (optional - existing code unaffected)
    -   Add `workflowState?: { ... }` field with workflow-specific data (optional)
    -   Requirements: 2.1
    -   **No breaking changes:** All new fields are optional

-   [x] **1.3 Update ensureUiMessage for workflow messages**
    -   File: `app/utils/chat/uiMessages.ts`
    -   Import `isWorkflowMessageData` from workflow-types
    -   Add conditional logic: `if (isWorkflowMessageData(data)) { ... }`
    -   Populate `isWorkflow` and `workflowState` fields only when discriminator matches
    -   Use `finalOutput` as `text` for workflow messages
    -   Requirements: 2.1
    -   **No breaking changes:** Regular messages continue to work unchanged

---

## Phase 2: Streaming Infrastructure

### 2. Create WorkflowStreamAccumulator

-   [x] **2.1 Create useWorkflowStreamAccumulator.ts**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Define `WorkflowStreamingState` interface
    -   Define `WorkflowStreamAccumulatorApi` interface
    -   Requirements: 3.1
    -   **No breaking changes:** New file

-   [x] **2.2 Implement createWorkflowStreamAccumulator function**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Create reactive state object
    -   Implement RAF batching for token updates (pendingNodeTokens, pendingBranchTokens)
    -   Implement `scheduleFlush()` and `flush()` functions
    -   Requirements: 3.1, 3.2

-   [x] **2.3 Implement node lifecycle methods**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Implement `nodeStart(nodeId, label, type)`
    -   Implement `nodeToken(nodeId, token)` with RAF batching
    -   Implement `nodeReasoning(nodeId, token)`
    -   Implement `nodeFinish(nodeId, output)`
    -   Implement `nodeError(nodeId, error)`
    -   Requirements: 3.1

-   [x] **2.4 Implement branch lifecycle methods**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Implement `branchStart(nodeId, branchId, label)`
    -   Implement `branchToken(nodeId, branchId, token)`
    -   Implement `branchComplete(nodeId, branchId, output)`
    -   Requirements: 3.1, 5.3

-   [x] **2.5 Implement finalization and serialization**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Implement `finalize({ error?, stopped? })`
    -   Implement `reset()`
    -   Implement `toMessageData(workflowId, workflowName, prompt)` for DB serialization
    -   Requirements: 3.1, 8.1

-   [x] **2.6 Write unit tests for WorkflowStreamAccumulator**
    -   File: `app/composables/chat/__tests__/useWorkflowStreamAccumulator.test.ts`
    -   Test RAF batching (multiple tokens → single flush)
    -   Test node state transitions
    -   Test branch tracking
    -   Test error/stopped finalization
    -   Test `toMessageData()` output
    -   Requirements: 3.1, 3.2

---

## Phase 3: UI Components

### 3. Create WorkflowExecutionStatus Component

-   [x] **3.1 Create WorkflowExecutionStatus.vue**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Define props interface matching workflowState shape
    -   Create template skeleton with header and node list areas
    -   Requirements: 5.1

-   [x] **3.2 Implement header section**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Show workflow name
    -   Show overall status indicator (running/completed/error/stopped icons)
    -   Show status text
    -   Add collapse/expand toggle
    -   Requirements: 5.1

-   [x] **3.3 Implement node pipeline display**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Loop through `executionOrder` to show nodes in execution order
    -   Show status icon per node (pending/active/completed/error)
    -   Show node label and type
    -   Use `<details>` for expandable node output
    -   Requirements: 5.1

-   [x] **3.4 Implement node output expansion**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Show streaming text while active, final output when complete
    -   Auto-expand currently active node
    -   Show truncated preview when collapsed
    -   Auto-scroll streaming output
    -   Requirements: 5.2

-   [x] **3.5 Implement parallel branch visualization**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Filter branches by nodeId prefix
    -   Show branches as nested collapsibles within parent node
    -   Show branch status indicators
    -   Show branch streaming/output text
    -   **Handle `__merge__` branch ID specially** - display as "Merging results..." or similar
    -   Requirements: 5.3

-   [x] **3.6 Add error display within nodes**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Show error message in red banner within node details
    -   Highlight failed node with error icon
    -   Requirements: 6.2

-   [x] **3.7 Add theme/icon integration (v2 Update - Theme System)**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Use `useIcon()` for all icons (define new workflow.status.\* icons if needed)
    -   Import and use theme composable from `plugins/theme.ts`
    -   **Use semantic tokens only:** `var(--md-surface)`, `var(--md-outline-variant)`, `var(--md-primary)`, `var(--md-error)`, etc.
    -   **NO ad-hoc CSS variables** - all colors must come from theme system
    -   Apply theme tokens for surface, border, accent, and semantic state colors
    -   Ensure accessibility-compliant contrast ratios via theme system
    -   Requirements: NFR-3, NFR-5, v2 theme integration

-   [x] **3.8 Write component tests**
    -   File: `app/components/chat/__tests__/WorkflowExecutionStatus.test.ts`
    -   Test rendering with various execution states
    -   Test collapse/expand behavior
    -   Test node expansion
    -   Requirements: 5.1, 5.2

---

## Phase 4: ChatMessage Integration (v2 Update - Rendering Split)

### 4. Create Dedicated WorkflowChatMessage Component

-   [x] **4.1 Create WorkflowChatMessage.vue component**

    -   File: `app/components/chat/WorkflowChatMessage.vue`
    -   Create dedicated component for workflow message rendering
    -   Define props: `message: UiChatMessage` with workflow state
    -   Import `WorkflowExecutionStatus` and `StreamMarkdown`
    -   Requirements: v2 rendering split
    -   **No breaking changes:** New component, doesn't affect existing code

-   [x] **4.2 Implement workflow message rendering**

    -   File: `app/components/chat/WorkflowChatMessage.vue`
    -   Render `WorkflowExecutionStatus` component with workflow state
    -   Render final output using `StreamMarkdown`
    -   Apply theme tokens for styling
    -   Requirements: 5.1, 6.1, NFR-3

-   [x] **4.3 Modify ChatMessage.vue for conditional delegation**

    -   File: `app/components/chat/ChatMessage.vue`
    -   Import `WorkflowChatMessage` component
    -   Add discriminator function: `isWorkflowMessage(message)`
    -   Use `v-if` to conditionally render `WorkflowChatMessage` for workflow messages
    -   Keep existing rendering logic for regular messages
    -   Requirements: 1.1, v2 rendering split
    -   **No breaking changes:** Existing message rendering unchanged

-   [x] **4.4 Ensure final output renders correctly**
    -   File: `app/components/chat/WorkflowChatMessage.vue`
    -   Verify `StreamMarkdown` renders `message.text` (which is `finalOutput` for workflows)
    -   Test markdown/code rendering in final output
    -   Requirements: 6.1

---

## Phase 5: Slash Command Integration

### 5. Modify workflow-slash-commands.client.ts

-   [x] **5.1 Import workflow accumulator and types**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Import `createWorkflowStreamAccumulator`
    -   Import `createAccumulatorCallbacks` from `@or3/workflow-core`
    -   Import `WorkflowMessageData` type
    -   Import `nowSec` from `~/db/utils` for correct timestamp format
    -   Requirements: 3.1, 4.1

-   [x] **5.2 Create workflow message with correct data**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Use existing `db.messages.put()` pattern but with workflow data structure
    -   Store `data.type: 'workflow-execution'` as discriminator
    -   Initialize with empty `WorkflowMessageData` structure
    -   **Use `nowSec()` NOT `Date.now()` for timestamps**
    -   Requirements: 1.1, 1.2
    -   **No breaking changes:** Uses existing `data` field

-   [x] **5.3 Initialize accumulator and wire callbacks (SIMPLIFIED)**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Create accumulator instance at start of workflow execution
    -   **Use `createAccumulatorCallbacks` helper** to wire all callbacks:

        ```typescript
        import { createAccumulatorCallbacks } from '@or3/workflow-core';

        const callbacks = createAccumulatorCallbacks(workflow, {
            onNodeStart: accumulator.nodeStart,
            onNodeToken: accumulator.nodeToken,
            onNodeReasoning: accumulator.nodeReasoning,
            onNodeFinish: (nodeId, output) => {
                accumulator.nodeFinish(nodeId, output);
                schedulePersist();
            },
            onNodeError: (nodeId, error) => {
                accumulator.nodeError(nodeId, error);
                schedulePersist();
            },
            onBranchStart: accumulator.branchStart,
            onBranchToken: accumulator.branchToken,
            onBranchComplete: accumulator.branchComplete,
        });
        ```

    -   The helper automatically:
        -   Looks up node metadata (label, type) from the workflow
        -   Maps `StreamAccumulatorCallbacks` to `ExecutionCallbacks`
        -   Handles all branch callback signatures (including 4-param branchToken)
    -   **Note:** `onNodeStart` now receives optional `NodeInfo` with `{label, type}` automatically
    -   Requirements: 4.1

-   [x] **5.4 Implement reactive state bridge (CRITICAL)**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Emit `workflow.execution:action:state_update` hook with reactive state reference
    -   The accumulator.state is `reactive()` - pass it directly so watchers update
    -   Requirements: 4.1
    -   **This is critical for UI updates - DB writes alone don't trigger re-renders**

-   [x] **5.5 Implement throttled persistence**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Create `schedulePersist()` function with 500ms throttle
    -   Create `persistFinal()` for immediate final write
    -   **Use `nowSec()` for `updated_at` timestamp**
    -   Update message `data` field with `accumulator.toMessageData()`
    -   Requirements: 8.1

-   [x] **5.6 Handle workflow completion**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   In `controller.promise.then()`: call `accumulator.finalize()`
    -   In `controller.promise.catch()`: call `accumulator.finalize({ error })`
    -   Persist final state
    -   Emit `workflow.execution:action:complete` hook
    -   Requirements: 8.1

-   [x] **5.7 Wire stop functionality to accumulator**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   On `workflow:stop` event, call `accumulator.finalize({ stopped: true })`
    -   Persist stopped state
    -   Requirements: 7.1

-   [x] **5.8 Handle `__merge__` branch display**
    -   The parallel node emits `__merge__` as branchId for merge step
    -   Display as "Merging results..." in `WorkflowExecutionStatus.vue`
    -   The branch callbacks include this automatically - just handle UI display
    -   Requirements: 5.3

---

## Phase 5.5: Reactivity Bridge (v2 MANDATORY - CRITICAL)

### 5.5. Connect workflow state to Vue reactivity (THE REACTIVE BRIDGE)

**v2 REQUIREMENT:** This is now a mandatory architectural component, not optional. Without this, the UI will show stale content because Dexie writes alone don't trigger Vue reactivity.

-   [x] **5.5.1 Subscribe to workflow state updates in ChatContainer (MANDATORY)**

    -   File: `app/components/chat/ChatContainer.vue` or `app/composables/chat/useAi.ts`
    -   Create `workflowStates = reactive(new Map<string, WorkflowStreamingState>())`
    -   Subscribe to `workflow.execution:action:state_update` hook
    -   Store reactive state reference in the map (keyed by message ID)
    -   **This enables workflow updates through the same reactive channel as streaming chat**
    -   Requirements: 4.1, 9.1, v2 reactive bridge
    -   **Critical:** This is the ONLY way to get real-time workflow UI updates

-   [x] **5.5.2 Merge workflow state into allMessages computed (MANDATORY)**

    -   In ChatContainer/useAi, modify the messages computed to check workflowStates map
    -   If message has workflow state, add `isWorkflow: true` and `workflowState`
    -   The state.version changes will trigger Vue reactivity
    -   **This connects the reactive accumulator to the message rendering system**
    -   Requirements: 4.1, v2 reactive bridge

-   [x] **5.5.3 Clean up state on completion**

    -   Listen for `workflow.execution:action:complete` hook
    -   Optionally remove from workflowStates map after delay
    -   Or keep for historical display
    -   Requirements: 9.2

---

## Phase 6: Hook Integration

### 6. Add Workflow Execution Hooks

-   [x] **6.1 Define hook types**

    -   File: `app/core/hooks/hook-types.ts`
    -   Add `workflow.execution:action:start` hook type
    -   Add `workflow.execution:action:node_complete` hook type
    -   Add `workflow.execution:action:complete` hook type
    -   Add `workflow.execution:action:state_update` hook type
    -   Requirements: 4.2

-   [x] **6.2 Emit hooks from slash command plugin**
    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Emit `workflow.execution:action:start` when execution begins
    -   Emit `workflow.execution:action:node_complete` in `onNodeFinish`
    -   Emit `workflow.execution:action:complete` when execution finishes
    -   Requirements: 4.2

---

## Phase 7: Icon Registration

### 7. Register Workflow Icons

-   [x] **7.1 Add workflow status icons to icon registry**
    -   File: `app/config/icons.ts` or equivalent
    -   Add `workflow.status.running` (spinner/loader)
    -   Add `workflow.status.completed` (checkmark)
    -   Add `workflow.status.error` (x-circle)
    -   Add `workflow.status.stopped` (stop-circle)
    -   Add `workflow.status.pending` (circle-outline)
    -   Requirements: 5.1, NFR-3

---

## Phase 8: Testing & Polish

### 8. Integration Testing

-   [ ] **8.1 Test workflow message persistence**

    -   Write test that executes workflow and verifies DB message has correct structure
    -   Verify `message_type: 'workflow'` is set
    -   Verify `data` contains valid `WorkflowMessageData`
    -   Requirements: 8.1

-   [ ] **8.2 Test workflow message loading**

    -   Write test that loads thread with workflow message
    -   Verify `ensureUiMessage` correctly populates `workflowState`
    -   Verify component renders execution status
    -   Requirements: 8.2

-   [ ] **8.3 Test real-time updates**
    -   Write integration test simulating token stream
    -   Verify UI updates in real-time
    -   Verify RAF batching reduces update count
    -   Requirements: 4.1, 9.1

### 9. Error Handling (v2 Update - Centralized Error System)

-   [x] **9.1 Integrate centralized error system**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Import error utilities from `~/utils/errors` or equivalent
    -   Route all workflow errors through centralized error system
    -   Use `showError()` or similar API for consistent error UX
    -   Requirements: 6.2, NFR-4, v2 error system

-   [x] **9.2 Handle workflow validation errors with theme tokens**

    -   Ensure validation errors display through centralized system
    -   Set node state to error if validation fails on a specific node
    -   Use theme error tokens (`var(--md-error)`, `var(--md-error-container)`)
    -   Requirements: 6.2, NFR-3, v2 error system

-   [x] **9.3 Handle execution errors gracefully**
    -   Test error during node execution
    -   Verify error node is highlighted with theme error colors
    -   Verify partial output is preserved
    -   Verify errors appear in centralized error system
    -   Requirements: 6.2, 8.2, NFR-4

### 10. Performance Validation

-   [ ] **10.1 Validate RAF batching performance**

    -   Profile with high-frequency token stream
    -   Verify main thread blocking < 16ms
    -   Requirements: 9.1

-   [ ] **10.2 Validate memory cleanup**
    -   Test accumulator disposal on unmount
    -   Verify no memory leaks in long sessions
    -   Requirements: 9.2

### 11. Accessibility Testing (v2 NEW - Theme System)

-   [ ] **11.1 Validate theme token contrast ratios**

    -   Verify all workflow status colors meet WCAG AA contrast standards
    -   Test with both light and dark themes
    -   Use theme system's built-in contrast validation
    -   Requirements: NFR-5, v2 theme integration

-   [ ] **11.2 Test screen reader accessibility**

    -   Verify semantic states have appropriate ARIA labels
    -   Test status indicators with screen readers
    -   Ensure collapsible sections announce state changes
    -   Requirements: NFR-5

-   [ ] **11.3 Test keyboard navigation**
    -   Verify all collapsible sections work with keyboard only
    -   Test tab order and focus management
    -   Ensure stop button is keyboard accessible
    -   Requirements: NFR-5

---

## Phase 9: Documentation

### 12. Update Documentation (v2 Updates)

-   [ ] **12.1 Document WorkflowMessageData schema and discriminators**

    -   Add documentation for workflow message format
    -   Include examples of workflow message data
    -   **v2 Addition:** Document message type discriminators and discriminated unions
    -   Document default `type: 'message'` for non-workflow messages
    -   Requirements: Documentation, v2 default message typing

-   [ ] **12.2 Document new hooks and reactive bridge**

    -   Add workflow execution hooks to hooks documentation
    -   Include usage examples for plugin authors
    -   **v2 Addition:** Document reactive bridge architecture and requirements
    -   Explain why reactive bridge is mandatory for real-time updates
    -   Requirements: Documentation, v2 reactive bridge

-   [ ] **12.3 Document WorkflowChatMessage component**

    -   Document new `WorkflowChatMessage.vue` component
    -   Explain rendering split and conditional delegation
    -   Document prop contracts and type safety
    -   Requirements: Documentation, v2 rendering split

-   [ ] **12.4 Document theme system integration**
    -   Document semantic token usage in workflow components
    -   List all theme tokens used (surface, border, accent, error)
    -   Explain accessibility benefits of theme system
    -   Requirements: Documentation, v2 theme integration

-   [ ] **12.5 Document centralized error system integration**
    -   Document how workflow errors integrate with centralized system
    -   Include examples of error handling
    -   Requirements: Documentation, v2 error system

---

## Dependency Graph (v2 Update)

```
Phase 1 (Data Model + v2 Discriminators)
  ├── 1.1 workflow-types.ts with discriminated unions
  ├── 1.2 UiChatMessage extension
  └── 1.3 ensureUiMessage update
        │
        ▼
Phase 2 (Streaming)
  ├── 2.1-2.5 WorkflowStreamAccumulator
  └── 2.6 Unit tests
        │
        ▼
Phase 3 (UI Components + v2 Theme Integration)
  ├── 3.1-3.6 WorkflowExecutionStatus.vue
  ├── 3.7 Theme system integration (semantic tokens)
  └── 3.8 Component tests
        │
        ▼
Phase 4 (v2 NEW: Dedicated Component + Rendering Split)
  ├── 4.1 Create WorkflowChatMessage.vue
  ├── 4.2 Implement workflow rendering
  ├── 4.3 Modify ChatMessage.vue for conditional delegation
  └── 4.4 Test final output rendering
        │
        ▼
Phase 5 (Integration + v2 Error System)
  ├── 5.1-5.3 workflow-slash-commands.client.ts with createAccumulatorCallbacks
  ├── 5.4 Reactive state bridge (emit hooks)
  ├── 5.5 Throttled persistence with nowSec()
  ├── 5.6-5.7 Completion and stop handling
  └── 5.8 __merge__ branch handling
        │
        ├──► Phase 5.5 (v2 CRITICAL: Reactive Bridge) - parallel
        │     ├── 5.5.1 Subscribe to workflow state updates
        │     ├── 5.5.2 Merge workflow state into allMessages
        │     └── 5.5.3 Clean up state on completion
        │
        ├──► Phase 6 (Hooks) - parallel
        │
        ├──► Phase 7 (Icons) - parallel
        │
        └──► Phase 9 (v2 NEW: Error System Integration) - parallel
              │
              ▼
        Phase 8 (Testing)
              │
              ▼
        Phase 10 (Performance)
              │
              ▼
        Phase 11 (v2 NEW: Accessibility Testing)
              │
              ▼
        Phase 12 (Documentation + v2 Updates)
```

---

## Estimated Timeline (v2 Update)

| Phase | Description                    | Effort        | Notes                                                   |
| ----- | ------------------------------ | ------------- | ------------------------------------------------------- |
| 1     | Data Model Foundation          | 2-3 hours     | +0.5h for discriminated union types                     |
| 2     | Streaming Infrastructure       | 4-5 hours     |                                                         |
| 3     | UI Components                  | 5-7 hours     | +1h for theme system integration                        |
| 4     | WorkflowChatMessage Component  | 2-3 hours     | +1h for new dedicated component                         |
| 5     | Slash Command Integration      | **2-3 hours** | ⬇️ Reduced from 3-4h with `createAccumulatorCallbacks`  |
| 5.5   | **Reactive Bridge (MANDATORY)** | **2-3 hours** | ⚠️ CRITICAL: Required for real-time updates            |
| 6     | Hook Integration               | 1 hour        |                                                         |
| 7     | Icon Registration              | 0.5 hours     |                                                         |
| 8     | Testing & Polish               | 3-4 hours     |                                                         |
| 9     | Error System Integration       | 1-2 hours     | +1-2h for centralized error system                      |
| 10    | Performance Validation         | 1-2 hours     |                                                         |
| 11    | Accessibility Testing          | 2-3 hours     | +2-3h for theme system accessibility                    |
| 12    | Documentation                  | 2-3 hours     | +1h for v2 additions                                    |

**Total Estimated Effort: 28-39 hours** (increased from 19-26h due to v2 requirements)

**v2 Additions Account For:**
- Dedicated `WorkflowChatMessage.vue` component (+1h)
- Reactive bridge implementation (+2-3h) **CRITICAL**
- Centralized error system integration (+1-2h)
- Theme system integration with semantic tokens (+1h)
- Accessibility testing with theme system (+2-3h)
- Additional documentation for v2 features (+1h)

---

## Risk Mitigation

### Risk: Breaking existing chat functionality

-   **Mitigation**: All workflow-specific code is additive; `message_type` defaults to `'chat'`; existing paths unchanged

### Risk: Performance degradation during streaming

-   **Mitigation**: RAF batching proven pattern from existing `StreamAccumulator`; throttled DB writes

### Risk: Accumulator memory leaks

-   **Mitigation**: Clear buffers on finalization; dispose on component unmount; add 100KB warning

### Risk: Complex parallel branch state

-   **Mitigation**: Use composite keys (`nodeId:branchId`); isolate branch state from node state
