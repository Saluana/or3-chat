# Workflow Message Integration - Implementation Tasks

## Overview

This task list implements the workflow/agent message integration into the chat interface. Tasks are ordered by dependency and grouped by component/feature area.

**⚠️ ZERO BREAKING CHANGES:** All tasks are additive. No schema migrations, no version bumps, no existing behavior modifications.

---

## Phase 1: Data Model Foundation

### 1. Create Workflow Type Definitions (NO schema changes)

-   [ ] **1.1 Create workflow-types.ts**

    -   File: `app/utils/chat/workflow-types.ts`
    -   Define `NodeExecutionStatus` type: `'pending' | 'running' | 'completed' | 'error'`
    -   Define `WorkflowExecutionState` type: `'idle' | 'running' | 'completed' | 'error' | 'stopped'`
    -   Define `NodeState` interface
    -   Define `BranchState` interface
    -   Define `WorkflowMessageData` interface with `type: 'workflow-execution'` discriminator
    -   Create `isWorkflowMessageData(data)` type guard
    -   Requirements: 1.2
    -   **No breaking changes:** New file, no modifications to existing code

-   [ ] **1.2 Extend UiChatMessage interface (additive only)**

    -   File: `app/utils/chat/uiMessages.ts`
    -   Add `isWorkflow?: boolean` field (optional - existing code unaffected)
    -   Add `workflowState?: { ... }` field with workflow-specific data (optional)
    -   Requirements: 2.1
    -   **No breaking changes:** All new fields are optional

-   [ ] **1.3 Update ensureUiMessage for workflow messages**
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

-   [ ] **2.1 Create useWorkflowStreamAccumulator.ts**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Define `WorkflowStreamingState` interface
    -   Define `WorkflowStreamAccumulatorApi` interface
    -   Requirements: 3.1
    -   **No breaking changes:** New file

-   [ ] **2.2 Implement createWorkflowStreamAccumulator function**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Create reactive state object
    -   Implement RAF batching for token updates (pendingNodeTokens, pendingBranchTokens)
    -   Implement `scheduleFlush()` and `flush()` functions
    -   Requirements: 3.1, 3.2

-   [ ] **2.3 Implement node lifecycle methods**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Implement `nodeStart(nodeId, label, type)`
    -   Implement `nodeToken(nodeId, token)` with RAF batching
    -   Implement `nodeReasoning(nodeId, token)`
    -   Implement `nodeFinish(nodeId, output)`
    -   Implement `nodeError(nodeId, error)`
    -   Requirements: 3.1

-   [ ] **2.4 Implement branch lifecycle methods**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Implement `branchStart(nodeId, branchId, label)`
    -   Implement `branchToken(nodeId, branchId, token)`
    -   Implement `branchComplete(nodeId, branchId, output)`
    -   Requirements: 3.1, 5.3

-   [ ] **2.5 Implement finalization and serialization**

    -   File: `app/composables/chat/useWorkflowStreamAccumulator.ts`
    -   Implement `finalize({ error?, stopped? })`
    -   Implement `reset()`
    -   Implement `toMessageData(workflowId, workflowName, prompt)` for DB serialization
    -   Requirements: 3.1, 8.1

-   [ ] **2.6 Write unit tests for WorkflowStreamAccumulator**
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

-   [ ] **3.1 Create WorkflowExecutionStatus.vue**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Define props interface matching workflowState shape
    -   Create template skeleton with header and node list areas
    -   Requirements: 5.1

-   [ ] **3.2 Implement header section**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Show workflow name
    -   Show overall status indicator (running/completed/error/stopped icons)
    -   Show status text
    -   Add collapse/expand toggle
    -   Requirements: 5.1

-   [ ] **3.3 Implement node pipeline display**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Loop through `executionOrder` to show nodes in execution order
    -   Show status icon per node (pending/active/completed/error)
    -   Show node label and type
    -   Use `<details>` for expandable node output
    -   Requirements: 5.1

-   [ ] **3.4 Implement node output expansion**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Show streaming text while active, final output when complete
    -   Auto-expand currently active node
    -   Show truncated preview when collapsed
    -   Auto-scroll streaming output
    -   Requirements: 5.2

-   [ ] **3.5 Implement parallel branch visualization**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Filter branches by nodeId prefix
    -   Show branches as nested collapsibles within parent node
    -   Show branch status indicators
    -   Show branch streaming/output text
    -   Requirements: 5.3

-   [ ] **3.6 Add error display within nodes**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Show error message in red banner within node details
    -   Highlight failed node with error icon
    -   Requirements: 6.2

-   [ ] **3.7 Add theme/icon integration**

    -   File: `app/components/chat/WorkflowExecutionStatus.vue`
    -   Use `useIcon()` for all icons (define new workflow.status.\* icons if needed)
    -   Use `useThemeOverrides()` for theming
    -   Apply CSS variables for colors
    -   Requirements: NFR-3

-   [ ] **3.8 Write component tests**
    -   File: `app/components/chat/__tests__/WorkflowExecutionStatus.test.ts`
    -   Test rendering with various execution states
    -   Test collapse/expand behavior
    -   Test node expansion
    -   Requirements: 5.1, 5.2

---

## Phase 4: ChatMessage Integration

### 4. Modify ChatMessage for Workflow Rendering

-   [ ] **4.1 Add workflow detection computed**

    -   File: `app/components/chat/ChatMessage.vue`
    -   Add `isWorkflow` computed property checking `props.message.isWorkflow`
    -   Requirements: 2.1

-   [ ] **4.2 Add WorkflowExecutionStatus to template**

    -   File: `app/components/chat/ChatMessage.vue`
    -   Import `WorkflowExecutionStatus` component
    -   Add conditional render above message content when `isWorkflow`
    -   Pass workflow state props
    -   Requirements: 5.1

-   [ ] **4.3 Ensure final output renders correctly**
    -   File: `app/components/chat/ChatMessage.vue`
    -   Verify `StreamMarkdown` renders `message.text` (which is `finalOutput` for workflows)
    -   Test markdown/code rendering in final output
    -   Requirements: 6.1

---

## Phase 5: Slash Command Integration

### 5. Modify workflow-slash-commands.client.ts

-   [ ] **5.1 Import workflow accumulator and types**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Import `createWorkflowStreamAccumulator`
    -   Import `WorkflowMessageData` type
    -   Requirements: 3.1, 4.1

-   [ ] **5.2 Create workflow message with correct type**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Modify `tx.appendMessage` call to include `message_type: 'workflow'`
    -   Initialize with empty `WorkflowMessageData` structure
    -   Requirements: 1.1, 1.2

-   [ ] **5.3 Initialize accumulator and wire callbacks**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Create accumulator instance at start of workflow execution
    -   Map `onNodeStart` → `accumulator.nodeStart()`
    -   Map `onToken` → `accumulator.nodeToken()`
    -   Map `onNodeFinish` → `accumulator.nodeFinish()`
    -   Map `onBranchStart` → `accumulator.branchStart()`
    -   Map `onBranchToken` → `accumulator.branchToken()`
    -   Map `onBranchComplete` → `accumulator.branchComplete()`
    -   Map `onError` → `accumulator.finalize({ error })`
    -   Requirements: 4.1

-   [ ] **5.4 Implement reactive state updates**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Create mechanism to update tailAssistant reactive ref with workflow state
    -   Emit `workflow.execution:action:state_update` hook for ChatContainer
    -   Requirements: 4.1

-   [ ] **5.5 Implement throttled persistence**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Create `persistWorkflowState()` function
    -   Throttle to 500ms during streaming
    -   Persist immediately on completion/error
    -   Update message `data` field with `accumulator.toMessageData()`
    -   Requirements: 8.1

-   [ ] **5.6 Handle workflow completion**

    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Call `accumulator.finalize()` on success
    -   Persist final state
    -   Clear accumulator reference
    -   Requirements: 8.1

-   [ ] **5.7 Wire stop functionality to accumulator**
    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   On `workflow:stop` event, call `accumulator.finalize({ stopped: true })`
    -   Persist stopped state
    -   Requirements: 7.1

---

## Phase 6: Hook Integration

### 6. Add Workflow Execution Hooks

-   [ ] **6.1 Define hook types**

    -   File: `app/core/hooks/hook-types.ts`
    -   Add `workflow.execution:action:start` hook type
    -   Add `workflow.execution:action:node_complete` hook type
    -   Add `workflow.execution:action:complete` hook type
    -   Add `workflow.execution:action:state_update` hook type
    -   Requirements: 4.2

-   [ ] **6.2 Emit hooks from slash command plugin**
    -   File: `app/plugins/workflow-slash-commands.client.ts`
    -   Emit `workflow.execution:action:start` when execution begins
    -   Emit `workflow.execution:action:node_complete` in `onNodeFinish`
    -   Emit `workflow.execution:action:complete` when execution finishes
    -   Requirements: 4.2

---

## Phase 7: Icon Registration

### 7. Register Workflow Icons

-   [ ] **7.1 Add workflow status icons to icon registry**
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

### 9. Error Handling

-   [ ] **9.1 Handle workflow validation errors**

    -   Ensure validation errors display in error banner
    -   Set node state to error if validation fails on a specific node
    -   Requirements: 6.2

-   [ ] **9.2 Handle execution errors gracefully**
    -   Test error during node execution
    -   Verify error node is highlighted
    -   Verify partial output is preserved
    -   Requirements: 6.2, 8.2

### 10. Performance Validation

-   [ ] **10.1 Validate RAF batching performance**

    -   Profile with high-frequency token stream
    -   Verify main thread blocking < 16ms
    -   Requirements: 9.1

-   [ ] **10.2 Validate memory cleanup**
    -   Test accumulator disposal on unmount
    -   Verify no memory leaks in long sessions
    -   Requirements: 9.2

---

## Phase 9: Documentation

### 11. Update Documentation

-   [ ] **11.1 Document WorkflowMessageData schema**

    -   Add documentation for workflow message format
    -   Include examples of workflow message data
    -   Requirements: Documentation

-   [ ] **11.2 Document new hooks**

    -   Add workflow execution hooks to hooks documentation
    -   Include usage examples for plugin authors
    -   Requirements: Documentation

-   [ ] **11.3 Update ChatMessage component docs**
    -   Document new workflow-specific props and behavior
    -   Requirements: Documentation

---

## Dependency Graph

```
Phase 1 (Data Model)
  ├── 1.1 Schema extension
  ├── 1.2 workflow-types.ts
  ├── 1.3 UiChatMessage extension
  └── 1.4 ensureUiMessage update
        │
        ▼
Phase 2 (Streaming)
  ├── 2.1-2.5 WorkflowStreamAccumulator
  └── 2.6 Unit tests
        │
        ▼
Phase 3 (UI Components)
  ├── 3.1-3.7 WorkflowExecutionStatus.vue
  └── 3.8 Component tests
        │
        ▼
Phase 4 (ChatMessage)
  └── 4.1-4.3 ChatMessage modifications
        │
        ▼
Phase 5 (Integration)
  └── 5.1-5.7 workflow-slash-commands.client.ts
        │
        ├──► Phase 6 (Hooks) - parallel
        └──► Phase 7 (Icons) - parallel
              │
              ▼
        Phase 8 (Testing)
              │
              ▼
        Phase 9 (Documentation)
```

---

## Estimated Timeline

| Phase | Description               | Effort    |
| ----- | ------------------------- | --------- |
| 1     | Data Model Foundation     | 2-3 hours |
| 2     | Streaming Infrastructure  | 4-5 hours |
| 3     | UI Components             | 4-6 hours |
| 4     | ChatMessage Integration   | 1-2 hours |
| 5     | Slash Command Integration | 3-4 hours |
| 6     | Hook Integration          | 1 hour    |
| 7     | Icon Registration         | 0.5 hours |
| 8     | Testing & Polish          | 3-4 hours |
| 9     | Documentation             | 1-2 hours |

**Total Estimated Effort: 20-27 hours**

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
