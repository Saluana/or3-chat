# Workflow Slash Commands - Requirements

## Overview

Enable users to invoke workflows directly from the chat input using slash commands (e.g., `/Proofreader my text...`). When a user types `/` followed by a workflow name, a suggestions popover appears showing matching workflows. Upon selection, the workflow executes with the remaining text as input and the conversation history as context.

---

## Requirements

### 1. Slash Command Trigger

**User Story**: As a user, I want to type `/` in the chat input and see a list of my workflows, so that I can quickly invoke them without navigating to the workflow editor.

**Acceptance Criteria**:
- WHEN user types `/` at the start of their message or after whitespace
- THEN a popover SHALL appear showing available workflows
- WHEN user continues typing after `/`
- THEN the list SHALL filter to show workflows matching the typed query
- WHEN user presses Escape
- THEN the popover SHALL close without inserting any text
- WHEN user clicks outside the popover
- THEN the popover SHALL close

### 2. Workflow Suggestions Popover

**User Story**: As a user, I want to see a searchable list of my workflows in a popover, so that I can quickly find and select the one I need.

**Acceptance Criteria**:
- WHEN the slash command popover opens
- THEN it SHALL display workflow names with their last-updated timestamp
- WHEN user types a query
- THEN workflows SHALL be filtered using fuzzy/substring matching
- WHEN no workflows match
- THEN the popover SHALL show "No workflows found"
- IF user has no workflows
- THEN the popover SHALL show "No workflows yet" with a hint to create one

### 3. Workflow Selection

**User Story**: As a user, I want to select a workflow using keyboard or mouse, so that I can invoke it efficiently.

**Acceptance Criteria**:
- WHEN user presses Up/Down arrows
- THEN the selection SHALL move between workflow options
- WHEN user presses Enter or Tab on a selected workflow
- THEN the workflow name SHALL be inserted as `/WorkflowName `
- WHEN user clicks on a workflow
- THEN the workflow name SHALL be inserted as `/WorkflowName `
- WHEN a workflow is selected
- THEN the cursor SHALL be placed after the workflow name for prompt input

### 4. Workflow Execution on Send

**User Story**: As a user, I want my message to execute the selected workflow with my prompt text, so that I get the workflow's output in the chat.

**Acceptance Criteria**:
- WHEN user sends a message starting with `/WorkflowName prompt text`
- THEN the system SHALL identify the workflow by name
- IF the workflow exists
- THEN the workflow SHALL execute with `prompt text` as input
- IF the workflow does NOT exist
- THEN an error message SHALL be shown: "Workflow 'WorkflowName' not found"
- WHEN the workflow executes
- THEN the conversation history SHALL be passed as context
- WHEN execution completes
- THEN the workflow output SHALL appear as an assistant message

### 5. Streaming Output

**User Story**: As a user, I want to see the workflow's output stream in real-time, so that I don't have to wait for the full response.

**Acceptance Criteria**:
- WHEN a workflow is executing
- THEN tokens SHALL stream into the chat as they're generated
- WHEN multiple nodes produce output
- THEN outputs SHALL be concatenated in execution order
- WHEN execution is in progress
- THEN a loading indicator SHALL be shown
- WHEN user clicks Stop
- THEN the workflow execution SHALL be cancelled

### 6. Error Handling

**User Story**: As a user, I want to see clear error messages when workflow execution fails, so that I can understand and fix issues.

**Acceptance Criteria**:
- IF a workflow fails validation before execution
- THEN the error message SHALL indicate the validation failure
- IF a workflow fails during execution
- THEN the error message SHALL indicate which node failed and why
- IF the API key is missing or invalid
- THEN the user SHALL be prompted to connect to OpenRouter

### 7. Conversation Context

**User Story**: As a user, I want workflows to have access to the conversation history, so that they can provide contextually relevant responses.

**Acceptance Criteria**:
- WHEN a workflow executes
- THEN it SHALL receive the full conversation history from the current thread
- IF the thread is new (no history)
- THEN the workflow SHALL execute with only the user's prompt
- WHEN conversation history is provided
- THEN it SHALL be passed in the `conversationHistory` parameter to the execution adapter

---

## Non-Functional Requirements

### Performance
- The slash command popover SHOULD appear within 100ms of typing `/`
- Workflow search SHOULD complete within 50ms for up to 100 workflows
- Workflow execution SHOULD begin within 500ms of sending

### Accessibility
- The popover SHOULD be navigable via keyboard only
- Selected items SHOULD have proper ARIA attributes
- Screen readers SHOULD announce workflow names and selection state

### Compatibility
- The feature SHOULD work alongside the existing `@` mention system
- The feature SHOULD respect the current theme (light/dark mode)
- The feature SHOULD work on mobile devices
