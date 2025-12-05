# Workflow Message Integration - Requirements

## Overview

This document defines the requirements for integrating workflow/agent execution results into the chat interface. When a user invokes a workflow via slash command (e.g., `/research-agent summarize this topic`), the execution should be displayed as a specialized message type that shows:

-   Real-time node execution status
-   Streaming token output per node
-   Parallel branch progress
-   Tool calls and their results
-   Final workflow output

The current implementation executes workflows but bypasses the chat's reactive streaming infrastructure, causing the UI to show stale or no content. This feature will add proper message type discrimination and a rich execution visualization component.

---

## ⚠️ 0. Backward Compatibility (CRITICAL)

### 0.1 Zero Breaking Changes

**As a** framework user  
**I want** all existing functionality to work unchanged after this update  
**So that** my application doesn't break when upgrading

**Acceptance Criteria:**

-   WHEN an existing message without workflow data is loaded THEN it SHALL render as a normal chat message
-   WHEN the `data` field is `null`, `undefined`, or any non-workflow shape THEN it SHALL be treated as a regular chat message
-   WHEN a component accesses `UiChatMessage` THEN missing optional fields (`isWorkflow`, `workflowState`) SHALL be `undefined`
-   WHEN the database is accessed THEN NO schema migration SHALL be required
-   WHEN existing hooks are called THEN their signatures SHALL remain unchanged

### 0.2 Additive-Only Changes

**As a** developer  
**I want** all changes to be purely additive  
**So that** existing code paths are not affected

**Acceptance Criteria:**

-   WHEN `UiChatMessage` is extended THEN all new fields SHALL be optional (`?`)
-   WHEN new hooks are added THEN they SHALL use a new `workflow:` prefix namespace
-   WHEN `ChatMessage.vue` is modified THEN workflow UI SHALL only render IF `isWorkflow === true`
-   WHEN `ensureUiMessage()` is called with a non-workflow message THEN its behavior SHALL be identical to before

---

## 1. Message Type Discrimination

### 1.1 Data Field Discriminator

**As a** developer  
**I want** workflow messages to be identified by a type discriminator in the `data` field  
**So that** the system can differentiate chat messages from workflow execution messages without schema changes

**Acceptance Criteria:**

-   WHEN a workflow execution starts THEN the assistant message SHALL store `data.type: 'workflow-execution'`
-   WHEN querying messages THEN the system SHALL use `data?.type === 'workflow-execution'` to detect workflow messages
-   WHEN a message lacks `data.type` THEN it SHALL be treated as a regular chat message (backward compatible)
-   WHEN an existing message has a different `data` shape THEN it SHALL continue to work unchanged

### 1.2 Workflow Data Structure

**As a** developer  
**I want** workflow messages to store execution state in a structured format  
**So that** the UI can render execution progress and results

**Acceptance Criteria:**

-   WHEN a workflow message is stored THEN its `data` field SHALL conform to `WorkflowMessageData` interface
-   WHEN node execution starts THEN the node's state SHALL be recorded in `nodeStates[nodeId]`
-   WHEN parallel branches execute THEN each branch's state SHALL be tracked in `branches[branchId]`
-   WHEN workflow completes THEN `executionState` SHALL be set to `'completed'` or `'error'`

---

## 2. UI Message Type Extension

### 2.1 Extended UiChatMessage

**As a** frontend developer  
**I want** `UiChatMessage` to include optional workflow-specific fields  
**So that** components can conditionally render workflow execution UI

**Acceptance Criteria:**

-   WHEN `ensureUiMessage` processes a workflow message THEN it SHALL populate `isWorkflow: true`
-   WHEN `ensureUiMessage` processes a non-workflow message THEN `isWorkflow` SHALL be `undefined` or `false`
-   WHEN a workflow message has node states THEN `workflowState.nodeStates` SHALL be accessible
-   WHEN a workflow message has branches THEN `workflowState.branches` SHALL be accessible
-   WHEN a workflow message has a final output THEN `text` SHALL contain the final output

---

## 3. Workflow Stream Accumulator

### 3.1 Dedicated Accumulator

**As a** developer  
**I want** a specialized stream accumulator for workflow execution  
**So that** node states, branches, and streaming content are tracked reactively

**Acceptance Criteria:**

-   WHEN workflow execution starts THEN a `WorkflowStreamAccumulator` SHALL be created
-   WHEN `onNodeStart` callback fires THEN the accumulator SHALL update `nodeStates[nodeId].status` to `'active'`
-   WHEN `onToken` callback fires THEN the accumulator SHALL append to `nodeStates[nodeId].streamingText`
-   WHEN `onNodeFinish` callback fires THEN the accumulator SHALL set `nodeStates[nodeId].status` to `'completed'`
-   WHEN `onBranchStart` callback fires THEN the accumulator SHALL create `branches[branchId]` with `'active'` status
-   WHEN `onBranchToken` callback fires THEN the accumulator SHALL append to `branches[branchId].streamingText`
-   WHEN `onBranchComplete` callback fires THEN the accumulator SHALL set `branches[branchId].status` to `'completed'`
-   WHEN accumulator state changes THEN Vue reactivity SHALL trigger re-renders within one animation frame

### 3.2 RAF-Batched Updates

**As a** developer  
**I want** workflow accumulator updates to be RAF-batched  
**So that** high-frequency token callbacks don't cause excessive re-renders

**Acceptance Criteria:**

-   WHEN multiple tokens arrive within 16ms THEN they SHALL be batched into a single reactive update
-   WHEN the accumulator version increments THEN watching components SHALL receive exactly one update per frame

---

## 4. Workflow Slash Command Integration

### 4.1 Reactive State Binding

**As a** user  
**I want** to see workflow execution progress in real-time  
**So that** I understand what the workflow is doing

**Acceptance Criteria:**

-   WHEN a slash command triggers a workflow THEN the assistant message SHALL display the workflow execution UI
-   WHEN nodes execute THEN their status indicators SHALL update in real-time
-   WHEN tokens stream THEN the active node's collapsible content SHALL update live
-   WHEN workflow completes THEN the final output SHALL appear as the message content

### 4.2 Hook Integration

**As a** developer  
**I want** the workflow plugin to integrate with the existing hook system  
**So that** other plugins can observe/react to workflow execution

**Acceptance Criteria:**

-   WHEN workflow execution starts THEN `workflow.execution:action:start` hook SHALL fire
-   WHEN a node completes THEN `workflow.execution:action:node_complete` hook SHALL fire
-   WHEN workflow finishes THEN `workflow.execution:action:complete` hook SHALL fire

---

## 5. Execution Status Component

### 5.1 Node Pipeline Display

**As a** user  
**I want** to see which nodes are executing and their progress  
**So that** I can understand the workflow's current state

**Acceptance Criteria:**

-   WHEN a workflow message renders THEN it SHALL display a collapsible execution status section
-   WHEN a node is pending THEN it SHALL display a grey/inactive indicator
-   WHEN a node is active THEN it SHALL display an animated loading indicator
-   WHEN a node completes THEN it SHALL display a green checkmark
-   WHEN a node errors THEN it SHALL display a red error indicator

### 5.2 Node Output Expansion

**As a** user  
**I want** to optionally view each node's streamed output  
**So that** I can debug or understand intermediate results

**Acceptance Criteria:**

-   WHEN clicking a node in the execution status THEN its output SHALL expand/collapse
-   WHEN a node is streaming THEN its output area SHALL auto-scroll to show new content
-   WHEN a node output is collapsed THEN it SHALL show a truncated preview (first 50 chars)
-   WHEN multiple nodes have output THEN only one SHALL be expanded by default (the active one)

### 5.3 Parallel Branch Visualization

**As a** user  
**I want** to see parallel branches executing side-by-side  
**So that** I understand concurrent execution

**Acceptance Criteria:**

-   WHEN a parallel node executes branches THEN each branch SHALL appear as a nested collapsible
-   WHEN branches stream simultaneously THEN their indicators SHALL update independently
-   WHEN all branches complete THEN the parallel node SHALL show completion

---

## 6. Final Output Display

### 6.1 Primary Content

**As a** user  
**I want** the workflow's final output displayed prominently  
**So that** I can see the result without expanding details

**Acceptance Criteria:**

-   WHEN workflow completes successfully THEN the output node's content SHALL render as the primary message content
-   WHEN output contains markdown THEN it SHALL render using `StreamMarkdown` component
-   WHEN output contains code blocks THEN syntax highlighting SHALL apply

### 6.2 Error Display

**As a** user  
**I want** to see clear error information when workflows fail  
**So that** I can understand what went wrong

**Acceptance Criteria:**

-   WHEN workflow fails THEN an error banner SHALL appear at the top of the message
-   WHEN error has a node context THEN the failing node SHALL be highlighted in the execution status
-   WHEN error has a message THEN it SHALL be displayed in the error banner

---

## 7. Abort/Stop Functionality

### 7.1 Stop Button

**As a** user  
**I want** to stop a running workflow  
**So that** I can cancel long-running or unwanted executions

**Acceptance Criteria:**

-   WHEN workflow is executing THEN a stop button SHALL appear (same as chat stop)
-   WHEN stop is clicked THEN `adapter.stop()` SHALL be called
-   WHEN workflow is stopped THEN `executionState` SHALL be set to `'stopped'`
-   WHEN workflow is stopped THEN partial output SHALL be preserved and visible

---

## 8. Persistence & Recovery

### 8.1 Database Persistence

**As a** user  
**I want** workflow execution state persisted to the database  
**So that** I can refresh the page and see past workflow results

**Acceptance Criteria:**

-   WHEN node state changes THEN it SHALL be persisted within 500ms
-   WHEN workflow completes THEN final state SHALL be persisted immediately
-   WHEN loading a thread with workflow messages THEN execution state SHALL be restored

### 8.2 Recovery from Interruption

**As a** user  
**I want** to see partial results if the page reloads during execution  
**So that** I don't lose progress

**Acceptance Criteria:**

-   WHEN page reloads during workflow execution THEN message SHALL show last persisted state
-   WHEN execution was interrupted THEN `executionState` SHALL show `'interrupted'`
-   WHEN reloading a completed workflow THEN full execution trace SHALL be visible

---

## 9. Performance

### 9.1 Render Efficiency

**As a** user  
**I want** smooth scrolling and interaction during workflow execution  
**So that** the UI remains responsive

**Acceptance Criteria:**

-   WHEN workflow streams tokens THEN main thread blocking SHALL be < 16ms per frame
-   WHEN execution status updates THEN re-renders SHALL be scoped to the affected message
-   WHEN many nodes exist THEN virtualization SHALL apply if node count > 10

### 9.2 Memory Management

**As a** developer  
**I want** workflow execution state to not cause memory leaks  
**So that** long sessions remain stable

**Acceptance Criteria:**

-   WHEN workflow completes THEN streaming buffers SHALL be cleared
-   WHEN navigating away from thread THEN workflow accumulators SHALL be disposed
-   WHEN accumulated text exceeds 100KB THEN a warning SHALL be logged

---

## Non-Functional Requirements

### NFR-1: Backward Compatibility

-   Existing chat messages (without `message_type`) SHALL render normally
-   Existing slash commands that don't trigger workflows SHALL work unchanged

### NFR-2: Mobile Support

-   Workflow execution UI SHALL be responsive on mobile viewports
-   Collapsible sections SHALL support touch gestures

### NFR-3: Theme Compatibility

-   Workflow UI components SHALL use theme CSS variables
-   Status indicators SHALL be visible in both light and dark themes
