# Workflow Slash Commands - Implementation Tasks

## Overview

Implementation checklist for the workflow slash commands feature. Tasks are grouped by component and ordered by dependency.

---

## 1. Create Plugin Directory Structure

- [ ] **1.1 Create plugin folder**
  - Create `/app/plugins/WorkflowSlashCommands/` directory
  - Requirements: N/A (setup task)

- [ ] **1.2 Create file stubs**
  - Create empty files:
    - `useWorkflowSlashCommands.ts`
    - `suggestions.ts`
    - `WorkflowPopover.vue`
    - `WorkflowList.vue`
    - `executeWorkflow.ts`
  - Requirements: 1.1

---

## 2. Implement Workflow Search

- [ ] **2.1 Create WorkflowItem type**
  - Define interface with id, label, updatedAt
  - Export from `useWorkflowSlashCommands.ts`
  - Requirements: 1.2

- [ ] **2.2 Implement searchWorkflows function**
  - Query Dexie posts table for `postType === 'or3-workflow'`
  - Filter by query substring (case-insensitive)
  - Return top 10 results sorted by updatedAt
  - Requirements: 2.1

- [ ] **2.3 Implement getWorkflowByName function**
  - Query by exact title match
  - Return workflow with parsed meta (WorkflowData)
  - Return null if not found
  - Requirements: 2.1

- [ ] **2.4 Implement getWorkflowById function**
  - Query by exact id match  
  - Return workflow with parsed meta (WorkflowData)
  - Return null if not found
  - Requirements: 2.1

---

## 3. Implement UI Components

- [ ] **3.1 Create WorkflowList component**
  - Accept items, command, selectedIndex props
  - Render scrollable list of workflow items
  - Show workflow icon, name, and relative time
  - Handle keyboard navigation (up/down/enter)
  - Handle click selection
  - Show empty state when no workflows
  - Requirements: 2.1, 3 (styling)

- [ ] **3.2 Create WorkflowPopover component**
  - Wrap WorkflowList in UPopover
  - Position relative to TipTap cursor
  - Handle Escape to close
  - Forward keyboard events to list
  - Requirements: 3.1

- [ ] **3.3 Style components for theme**
  - Use --md-* CSS variables
  - Ensure dark mode compatibility
  - Match existing MentionsPopover style
  - Requirements: 3.1, 3.2

---

## 4. Implement TipTap Suggestion Extension

- [ ] **4.1 Create suggestion configuration**
  - Configure trigger char as `/`
  - Set allowedPrefixes to [null, ' ', '\n']
  - Wire up items function to searchWorkflows
  - Requirements: 2.2, 3.2

- [ ] **4.2 Implement render lifecycle**
  - onStart: Mount WorkflowPopover via VueRenderer
  - onUpdate: Update popover props
  - onKeyDown: Forward to popover
  - onExit: Unmount and destroy
  - Requirements: 4.1

- [ ] **4.3 Configure command insertion**
  - On selection, insert `/WorkflowName ` text
  - Store workflow id as node attribute for later lookup
  - Keep cursor after inserted text
  - Requirements: 4.2

---

## 5. Create Client Plugin

- [ ] **5.1 Create workflow-slash-commands.client.ts**
  - Export defineNuxtPlugin
  - Add basic plugin structure
  - Requirements: 1.2

- [ ] **5.2 Register editor extension via hooks**
  - Listen for `editor:request-extensions`
  - Configure and provide SlashCommand extension
  - Filter via `ui.chat.editor:filter:extensions`
  - Requirements: 4.1, 4.2, 4.3, 5.1

- [ ] **5.3 Register hook types**
  - Add any new hooks to `app/core/hooks/hook-types.ts`
  - Requirements: 5.2

---

## 6. Implement Workflow Execution

- [ ] **6.1 Create parseSlashCommand function**
  - Extract workflow name from `/Name` pattern
  - Extract remaining text as prompt
  - Handle edge cases (no prompt, special chars in name)
  - Requirements: 2.3

- [ ] **6.2 Create executeWorkflow function**
  - Accept workflow, prompt, history, apiKey, callbacks
  - Initialize OpenRouterExecutionAdapter
  - Execute with streaming callbacks
  - Return execution result
  - Requirements: 6.1

- [ ] **6.3 Create getConversationHistory helper**
  - Load messages from current thread
  - Format as ChatMessage[] for execution adapter
  - Handle empty thread case
  - Requirements: 6.2

---

## 7. Integrate with Chat Send Flow

- [ ] **7.1 Intercept message send**
  - Hook into `ai.chat.messages:filter:before_send`
  - Check if message starts with `/`
  - Parse workflow name and prompt
  - Requirements: 6.1, 5.1

- [ ] **7.2 Execute workflow on send**
  - Load workflow by name/id
  - Get conversation history
  - Get API key from useUserApiKey
  - Call executeWorkflow
  - Requirements: 6.2, 6.3, 7.1

- [ ] **7.3 Stream output to chat**
  - Create streaming assistant message
  - Update message content on each token
  - Mark complete when execution finishes
  - Requirements: 7.2

- [ ] **7.4 Handle execution errors**
  - Show toast for workflow not found
  - Show toast for validation errors
  - Show toast for execution errors
  - Prompt login if no API key
  - Requirements: 7.2, 7.3

---

## 8. Add Stop Functionality

- [ ] **8.1 Track active adapter**
  - Store adapter reference during execution
  - Clear on completion or error
  - Requirements: 7.2

- [ ] **8.2 Implement stop handler**
  - Call adapter.stop() on stop button click
  - Cancel any pending token streaming
  - Mark message as cancelled
  - Requirements: 8.1

---

## 9. Testing

- [ ] **9.1 Unit tests for search**
  - Test searchWorkflows with various queries
  - Test getWorkflowByName exact match
  - Test edge cases (empty query, special chars)
  - Requirements: 2.2, 2.3

- [ ] **9.2 Unit tests for parsing**
  - Test parseSlashCommand extraction
  - Test various command formats
  - Test edge cases
  - Requirements: 6.1

- [ ] **9.3 Integration tests**
  - Test popover appears on /
  - Test keyboard navigation works
  - Test selection inserts text
  - Requirements: 3, 4

- [ ] **9.4 E2E tests**
  - Create workflow
  - Type / and select workflow
  - Send message and verify execution
  - Verify output appears in chat
  - Requirements: All

---

## 10. Documentation

- [ ] **10.1 Add user documentation**
  - Document slash command usage
  - Add examples
  - Requirements: All

- [ ] **10.2 Add developer documentation**
  - Document hooks integration
  - Document extension points
  - Requirements: All

---

## Dependency Graph

```
1.1 → 1.2 → 2.1 → 2.2, 2.3, 2.4
              ↓
           3.1 → 3.2 → 3.3
              ↓
           4.1 → 4.2 → 4.3
              ↓
           5.1 → 5.2 → 5.3
              ↓
           6.1 → 6.2 → 6.3
              ↓
           7.1 → 7.2 → 7.3 → 7.4
              ↓
           8.1 → 8.2
              ↓
           9.x → 10.x
```
