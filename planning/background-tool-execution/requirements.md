# Background Tool & Workflow Execution - Requirements

## Introduction

The OR3 Chat background streaming system currently supports streaming text responses from AI models when users navigate away from a chat thread. However, tool calls and workflow executions are **parsed but not executed** in background mode. This creates an incomplete experience where the AI can initiate tool calls, but they silently fail when the user isn't actively viewing the chat.

This document defines requirements to enable full tool and workflow execution in background streaming mode, address identified memory leaks, optimize performance, and ensure a robust system for autonomous agent operations.

## Current State Analysis

**What Works:**
- Text streaming continues in background (AI responses persist when user navigates away)
- SSE (Server-Sent Events) for reconnection via `/api/jobs/[id]/stream`
- Tool calls are **parsed** in `parseOpenRouterSSE.ts` (yields `type: 'tool_call'` events)
- Notification system for completed background jobs

**What's Broken:**
- **Tool calls are ignored**: `stream-handler.ts` only handles `type: 'text'` events in the `for await` loop (lines 184-216)
- **No tool execution loop**: There's no mechanism to execute tools and send results back to the model
- **No workflow execution**: Workflows that depend on tool calls cannot run in background
- **Memory leaks**: Job viewers tracking (`viewers.ts`) doesn't clean up listeners properly
- **Performance issues**: Every text chunk triggers SSE broadcasts to all listeners without throttling

## Requirements

### 1. Background Tool Execution

#### 1.1 Tool Call Handling
**User Story:** As a user, when I trigger a chat that uses tools and navigate away, the tools should execute automatically in the background without my presence.

**Acceptance Criteria:**
- **WHEN** the stream handler receives a `tool_call` event **THEN** it **SHALL** accumulate the tool call for execution
- **WHEN** the stream completes with `finish_reason === 'tool_calls'` **THEN** it **SHALL** execute all accumulated tool calls
- **WHEN** a tool call is executed **THEN** its result **SHALL** be persisted to the job storage with status tracking
- **WHEN** tool execution completes **THEN** the system **SHALL** construct a new request with tool results and resume streaming
- **WHEN** a tool execution fails **THEN** the error **SHALL** be captured and passed back to the model as a tool error result

#### 1.2 Multi-Turn Tool Conversations
**User Story:** As a user, I want the AI to be able to call tools multiple times in sequence without my interaction, enabling complex multi-step operations.

**Acceptance Criteria:**
- **WHEN** the AI returns tool results to the model **THEN** the model **MAY** request additional tool calls
- **WHEN** the system detects multiple tool call rounds **THEN** it **SHALL** execute up to a configurable maximum (e.g., 10 rounds)
- **WHEN** the maximum tool rounds are exceeded **THEN** the job **SHALL** fail with a clear error message
- **WHEN** any tool round fails **THEN** the job **SHALL** terminate gracefully and persist the partial result

#### 1.3 Tool Registry Integration
**User Story:** As a developer, I need tool execution in background mode to use the same tool registry and handlers as foreground execution for consistency.

**Acceptance Criteria:**
- **WHEN** background mode executes a tool **THEN** it **SHALL** use the server-side equivalent of the client tool registry
- **WHEN** a tool is not registered **THEN** the execution **SHALL** return a structured error to the model
- **WHEN** a tool times out (>10s) **THEN** the execution **SHALL** abort and return a timeout error
- **WHEN** tool arguments fail validation **THEN** the execution **SHALL** return a validation error to the model

### 2. Background Workflow Execution

#### 2.1 Workflow Invocation
**User Story:** As a user, when I trigger a workflow via slash command and navigate away, the workflow should continue executing in the background.

**Acceptance Criteria:**
- **WHEN** a background stream is initiated with workflow metadata (`_workflowId`, `_workflowPrompt`) **THEN** the system **SHALL** recognize it as a workflow execution job
- **WHEN** a workflow job is created **THEN** the job type **SHALL** be marked as `'workflow'` (vs. `'chat'`)
- **WHEN** a workflow executes in background **THEN** node states **SHALL** be persisted to the job storage incrementally
- **WHEN** the workflow completes **THEN** the final output node result **SHALL** be stored in `job.content`

#### 2.2 Workflow Tool Calls
**User Story:** As a user, workflows that depend on agent nodes calling tools should work in background mode.

**Acceptance Criteria:**
- **WHEN** a workflow agent node calls a tool **THEN** the background handler **SHALL** execute the tool using the tool registry
- **WHEN** a workflow node requires HITL (human-in-the-loop) **THEN** the background job **SHALL** pause and emit a notification requesting user input
- **WHEN** a paused workflow receives HITL response **THEN** it **SHALL** resume execution from the paused node

#### 2.3 Workflow State Persistence
**User Story:** As a developer, I need workflow execution state to survive server restarts (when using Convex provider).

**Acceptance Criteria:**
- **WHEN** a workflow executes in background **THEN** its `nodeStates`, `executionOrder`, and `currentNodeId` **SHALL** be persisted to job storage
- **WHEN** a workflow job is rehydrated after server restart **THEN** it **SHALL** resume from the last active node
- **WHEN** a workflow fails **THEN** the `failedNodeId` and error **SHALL** be persisted for debugging

### 3. Memory Leak Prevention

#### 3.1 Job Viewer Cleanup
**User Story:** As a system administrator, I need the server to release memory for completed jobs that no longer have active viewers.

**Acceptance Criteria:**
- **WHEN** all viewers disconnect from a completed job **THEN** the live job state **SHALL** be cleaned up within 30 seconds
- **WHEN** a viewer disconnects mid-stream **THEN** the viewer count **SHALL** decrement immediately
- **WHEN** a job has zero viewers **AND** status is terminal (`complete`, `error`, `aborted`) **THEN** listeners **SHALL** be garbage collected
- **WHEN** the cleanup timer expires **THEN** the job **SHALL** be removed from `jobStreams` map

#### 3.2 Tool Call State Management
**User Story:** As a developer, I need tool call state to be scoped per job and cleaned up after job completion.

**Acceptance Criteria:**
- **WHEN** tool calls are accumulated during streaming **THEN** they **SHALL** be stored in job-scoped state (not global)
- **WHEN** a tool execution completes **THEN** its intermediate state **SHALL** be discarded (only results persisted)
- **WHEN** a job fails during tool execution **THEN** all pending tool state **SHALL** be released

#### 3.3 Stream Handler Resource Cleanup
**User Story:** As a system administrator, I need stream handlers to release resources (timers, fetch streams) properly on errors and aborts.

**Acceptance Criteria:**
- **WHEN** a stream handler throws an error **THEN** all flush timers **SHALL** be cleared
- **WHEN** a job is aborted **THEN** the upstream fetch AbortController **SHALL** be triggered
- **WHEN** the stream reader completes **THEN** reader.releaseLock() **SHALL** be called

### 4. Performance Optimizations

#### 4.1 SSE Broadcast Throttling
**User Story:** As a system administrator, I need the server to efficiently handle multiple viewers without excessive CPU usage.

**Acceptance Criteria:**
- **WHEN** multiple viewers are attached to a job **THEN** SSE deltas **SHALL** be broadcast in batches (e.g., every 100ms)
- **WHEN** a single text chunk arrives **THEN** it **SHALL NOT** immediately trigger SSE writes to all listeners
- **WHEN** the batch interval elapses **OR** 10 chunks accumulate **THEN** a single SSE event **SHALL** be sent to all listeners
- **WHEN** a job completes **THEN** any pending batched deltas **SHALL** be flushed immediately

#### 4.2 Convex Write Batching
**User Story:** As a developer, I need Convex provider updates to be batched to reduce database write contention.

**Acceptance Criteria:**
- **WHEN** background streaming updates content **THEN** Convex writes **SHALL** occur at most every 500ms (configurable)
- **WHEN** pending content exceeds 1KB **THEN** a flush **SHALL** be triggered regardless of time
- **WHEN** the job completes **THEN** a final flush **SHALL** persist all remaining content
- **WHEN** a flush is already in-flight **THEN** subsequent flushes **SHALL** be queued, not concurrent

#### 4.3 Job Storage Indexing
**User Story:** As a developer, I need fast job lookups by `threadId` and `messageId` for reconnection scenarios.

**Acceptance Criteria:**
- **WHEN** a job is created in Convex **THEN** indexes **SHALL** exist on `thread_id`, `message_id`, and `user_id`
- **WHEN** a client reconnects **THEN** job lookup by `messageId` **SHALL** complete in <50ms (p95)
- **WHEN** cleanup runs **THEN** it **SHALL** use indexed queries to find expired jobs efficiently

### 5. Tool Execution Security & Limits

#### 5.1 Tool Execution Timeout
**User Story:** As a system administrator, I need tools to have execution timeouts to prevent runaway processes.

**Acceptance Criteria:**
- **WHEN** a tool executes in background **THEN** it **SHALL** have a configurable timeout (default 10s)
- **WHEN** a tool exceeds its timeout **THEN** it **SHALL** be aborted and return a timeout error
- **WHEN** a tool is aborted **THEN** any in-flight operations (HTTP requests, etc.) **SHALL** be cancelled

#### 5.2 Tool Execution Limits
**User Story:** As a system administrator, I need limits on tool execution to prevent abuse.

**Acceptance Criteria:**
- **WHEN** a single job attempts more than 10 tool rounds **THEN** it **SHALL** fail with "Tool execution limit exceeded"
- **WHEN** a single tool round has more than 20 tool calls **THEN** the job **SHALL** fail with "Too many concurrent tool calls"
- **WHEN** tool results exceed 50KB combined **THEN** they **SHALL** be truncated with a warning in the context

#### 5.3 Server-Side Tool Registry
**User Story:** As a developer, I need a server-side tool registry that mirrors client tools but executes in a Node.js environment.

**Acceptance Criteria:**
- **WHEN** server-side tools are registered **THEN** they **SHALL** have the same signature as client tools
- **WHEN** a tool requires browser-specific APIs **THEN** it **SHALL** be marked as `client-only: true` and fail gracefully in background
- **WHEN** background mode encounters a client-only tool **THEN** it **SHALL** return "Tool not available in background mode" error

### 6. Job Status Observability

#### 6.1 Tool Call Progress Tracking
**User Story:** As a user, when I return to a chat after navigating away, I want to see which tools were executed and their results.

**Acceptance Criteria:**
- **WHEN** a tool call starts **THEN** the job metadata **SHALL** include `active_tool_calls` array with `{id, name, status: 'running'}`
- **WHEN** a tool call completes **THEN** its status **SHALL** update to `'completed'` with result summary
- **WHEN** a tool call fails **THEN** its status **SHALL** update to `'error'` with error message
- **WHEN** a client reconnects **THEN** historical tool calls **SHALL** be displayed in the UI

#### 6.2 Workflow Progress Tracking
**User Story:** As a user, when I return to a workflow execution, I want to see which nodes executed and their outputs.

**Acceptance Criteria:**
- **WHEN** a workflow job is fetched **THEN** it **SHALL** include `workflow_state` with `nodeStates` and `executionOrder`
- **WHEN** a workflow node starts **THEN** its state **SHALL** be persisted with `status: 'active'` and timestamp
- **WHEN** a workflow node completes **THEN** its output **SHALL** be persisted to `nodeStates[nodeId].output`
- **WHEN** a client reconnects during workflow execution **THEN** the UI **SHALL** display real-time node progress

#### 6.3 Job Metrics
**User Story:** As a system administrator, I need visibility into background job performance and health.

**Acceptance Criteria:**
- **WHEN** a job completes **THEN** metrics **SHALL** include `tool_call_count`, `tool_execution_time_ms`, and `total_rounds`
- **WHEN** job cleanup runs **THEN** it **SHALL** log the number of jobs cleaned, timed out, and retained
- **WHEN** a job fails **THEN** the error **SHALL** include context (e.g., `failed_during: 'tool_execution'`, `tool_name: 'web_search'`)

### 7. Non-Functional Requirements

#### 7.1 Reliability
- The system **SHALL** handle network failures during tool execution gracefully (retry once, then fail)
- Tool execution errors **SHALL NOT** crash the streaming process
- Job state **SHALL** remain consistent even if the server restarts mid-execution (Convex provider)

#### 7.2 Performance
- Tool execution latency **SHALL NOT** block SSE broadcasts to active viewers
- Background jobs **SHALL** complete within 5 minutes or timeout
- The system **SHALL** support at least 20 concurrent background jobs (configurable)

#### 7.3 Compatibility
- Existing background streaming behavior (text-only) **SHALL** remain unchanged
- Tool execution in foreground (client-side) **SHALL** continue to work as-is
- The feature **SHALL** be backwards compatible with jobs created before this update

#### 7.4 Testability
- All tool execution paths **SHALL** be unit testable with mocked tool registry
- Integration tests **SHALL** cover multi-turn tool conversations
- End-to-end tests **SHALL** verify background workflow execution with tools
