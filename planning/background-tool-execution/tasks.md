# Background Tool & Workflow Execution - Implementation Tasks

This document provides a comprehensive, ordered checklist for implementing background tool and workflow execution in the OR3 Chat system.

## Task Overview

- [ ] **Phase 1: Foundation - Server Tool Registry** (Requirements: 1.3, 5.3)
- [ ] **Phase 2: Database Schema Extensions** (Requirements: 6.1, 6.2, 6.3)
- [ ] **Phase 3: Tool Execution Engine** (Requirements: 1.1, 1.2, 5.1, 5.2)
- [ ] **Phase 4: Stream Handler Integration** (Requirements: 1.1, 1.2)
- [ ] **Phase 5: Memory Leak Fixes** (Requirements: 3.1, 3.2, 3.3)
- [ ] **Phase 6: Performance Optimizations** (Requirements: 4.1, 4.2, 4.3)
- [ ] **Phase 7: Workflow Background Execution** (Requirements: 2.1, 2.2, 2.3)
- [ ] **Phase 8: UI Integration & SSE Updates** (Requirements: 6.1, 6.2)
- [ ] **Phase 9: Testing & Validation** (Requirements: 7.4)
- [ ] **Phase 10: Monitoring & Documentation** (Requirements: 6.3, 7.1, 7.2)

---

## Phase 1: Foundation - Server Tool Registry

**Requirements:** 1.3, 5.3

### 1.1 Create Server Tool Registry Core
- [ ] Create `server/utils/tools/tool-registry.ts`
  - [ ] Define `ServerToolHandler` type signature
  - [ ] Define `ToolExecutionContext` interface
  - [ ] Define `ServerToolDefinition` interface
  - [ ] Define `ServerToolRegistry` interface
  - [ ] Define `ToolExecutionResult` interface
  - [ ] Implement singleton registry storage (Map-based, not Vue reactive)
  - [ ] Implement `registerTool(definition: ServerToolDefinition): void`
  - [ ] Implement `unregisterTool(name: string): void`
  - [ ] Implement `getTool(name: string): ServerToolDefinition | undefined`
  - [ ] Implement `listTools(): ServerToolDefinition[]`
  - [ ] Implement `getEnabledDefinitions(): ToolDefinition[]` (for OpenRouter API format)

### 1.2 Implement Tool Execution Logic
- [ ] In `server/utils/tools/tool-registry.ts`:
  - [ ] Implement `executeTool(name: string, args: string, context: ToolExecutionContext): Promise<ToolExecutionResult>`
  - [ ] Add JSON argument parsing with schema validation
  - [ ] Add timeout enforcement using `Promise.race()` with default 10s timeout
  - [ ] Add `AbortSignal` propagation to tool handlers
  - [ ] Add execution time tracking (start/end timestamps)
  - [ ] Add error handling for tool not found, validation errors, timeouts
  - [ ] Add `clientOnly` tool blocking (return error if tool is client-only)

### 1.3 Create Tool Plugin System
- [ ] Create `server/plugins/tools/` directory
- [ ] Create `server/plugins/tools/index.ts` (tool plugin loader)
  - [ ] Auto-register tools from `server/plugins/tools/*.ts` files
  - [ ] Export `getServerToolRegistry()` helper

### 1.4 Implement Built-in Server Tools
- [ ] Create `server/plugins/tools/time.ts`
  - [ ] Implement `get_current_time` tool with timezone support
  - [ ] Register with server tool registry
- [ ] Create `server/plugins/tools/calculate.ts`
  - [ ] Implement `calculate` tool with math expression evaluation
  - [ ] Use `mathjs` or similar library for safe evaluation
  - [ ] Register with server tool registry
- [ ] Create `server/plugins/tools/web-search.ts` (optional, if API key available)
  - [ ] Implement `web_search` tool with external API integration
  - [ ] Add rate limiting
  - [ ] Register with server tool registry

### 1.5 Unit Tests for Tool Registry
- [ ] Create `server/utils/tools/__tests__/tool-registry.test.ts`
  - [ ] Test tool registration and retrieval
  - [ ] Test tool execution with valid arguments
  - [ ] Test tool execution with invalid arguments (validation errors)
  - [ ] Test tool timeout enforcement
  - [ ] Test `clientOnly` tool blocking
  - [ ] Test error handling (tool not found, handler throws)
  - [ ] Test AbortSignal cancellation

---

## Phase 2: Database Schema Extensions

**Requirements:** 6.1, 6.2, 6.3

### 2.1 Extend BackgroundJob Type
- [ ] Modify `server/utils/background-jobs/types.ts`:
  - [ ] Add `type?: 'chat' | 'workflow'` field to `BackgroundJob` interface
  - [ ] Add `activeToolCalls?: ToolCallState[]` field
  - [ ] Define `ToolCallState` interface with `id`, `name`, `status`, `startedAt`, `finishedAt`, `error`
  - [ ] Add `toolRounds?: ToolRoundMetadata[]` field
  - [ ] Define `ToolRoundMetadata` interface with `round`, `toolCalls` array
  - [ ] Add `workflowState?: WorkflowJobState` field
  - [ ] Define `WorkflowJobState` interface with `workflowId`, `workflowName`, `nodeStates`, `executionOrder`, `currentNodeId`, `failedNodeId`

### 2.2 Extend BackgroundJobProvider Interface
- [ ] In `server/utils/background-jobs/types.ts`:
  - [ ] Add `updateJobMetadata(jobId: string, metadata: Partial<BackgroundJob>): Promise<void>` method
  - [ ] Add `appendToolCall(jobId: string, toolCall: ToolCallState): Promise<void>` method
  - [ ] Add `updateWorkflowState(jobId: string, state: Partial<WorkflowJobState>): Promise<void>` method (optional, can use `updateJobMetadata`)

### 2.3 Update Memory Provider
- [ ] Modify `server/utils/background-jobs/providers/memory.ts`:
  - [ ] Add fields to `MemoryJob` type: `type`, `activeToolCalls`, `toolRounds`, `workflowState`
  - [ ] Implement `updateJobMetadata()` method
  - [ ] Implement `appendToolCall()` method
  - [ ] Ensure cleanup handles new fields

### 2.4 Update Convex Provider Schema
- [ ] Modify `convex/schema.ts`:
  - [ ] Add `type: v.optional(v.union(v.literal('chat'), v.literal('workflow')))` to `background_jobs` table
  - [ ] Add `active_tool_calls: v.optional(v.array(v.object({...})))` field
  - [ ] Add `tool_rounds: v.optional(v.array(v.object({...})))` field
  - [ ] Add `workflow_state: v.optional(v.object({...}))` field
  - [ ] Add indexes: `by_thread_message` on `['thread_id', 'message_id']`
  - [ ] Add index: `by_user_status` on `['user_id', 'status']`

### 2.5 Implement Convex Mutations
- [ ] Create/modify `convex/backgroundJobs.ts`:
  - [ ] Implement `updateMetadata(jobId, metadata)` mutation
  - [ ] Implement `appendToolCall(jobId, toolCall)` mutation
  - [ ] Implement `updateWorkflowState(jobId, state)` mutation
  - [ ] Update `get(jobId, userId)` query to return new fields

### 2.6 Update Convex Provider Implementation
- [ ] Modify `server/utils/background-jobs/providers/convex.ts`:
  - [ ] Implement `updateJobMetadata()` method (calls Convex mutation)
  - [ ] Implement `appendToolCall()` method (calls Convex mutation)
  - [ ] Update `getJob()` to map new Convex fields to `BackgroundJob` type

### 2.7 Database Migration Guide
- [ ] Document Convex schema migration steps
- [ ] Add rollback plan if schema changes cause issues

---

## Phase 3: Tool Execution Engine

**Requirements:** 1.1, 1.2, 5.1, 5.2

### 3.1 Create Tool Execution Loop
- [ ] Create `server/utils/background-jobs/tool-executor.ts`
  - [ ] Define `ToolRoundResult` interface
  - [ ] Define `ToolExecutionLoopParams` interface
  - [ ] Define `ToolExecutionLoopResult` interface
  - [ ] Implement `executeToolLoop(params): Promise<ToolExecutionLoopResult>` function

### 3.2 Implement Tool Loop Core Logic
- [ ] In `executeToolLoop()`:
  - [ ] Initialize conversation messages from `params.initialMessages`
  - [ ] Initialize loop counter (maxRounds = 10 by default)
  - [ ] Initialize tool call counter (totalToolCalls = 0)
  - [ ] Initialize tool rounds array for metadata

### 3.3 Implement Single Round Execution
- [ ] Create `executeSingleRound()` helper in `tool-executor.ts`:
  - [ ] Construct OpenRouter API request with tools enabled
  - [ ] Call `fetch(OR_URL)` with streaming
  - [ ] Parse response using `parseOpenRouterSSE()`
  - [ ] Accumulate text and tool_call events
  - [ ] Return `{ content, toolCalls, finishReason }`

### 3.4 Implement Tool Call Execution
- [ ] In `executeToolLoop()`:
  - [ ] For each tool call in round:
    - [ ] Get tool from `ServerToolRegistry`
    - [ ] Execute tool with `executeTool(name, args, context)`
    - [ ] Track execution time
    - [ ] Handle errors (validation, timeout, execution)
    - [ ] Store result in `toolResults` array
  - [ ] Enforce max tools per round limit (20)

### 3.5 Implement Conversation Update
- [ ] In `executeToolLoop()` after tool execution:
  - [ ] Append assistant message with tool_calls to conversation
  - [ ] For each tool result, append tool message with `role: 'tool'`, `tool_call_id`, `name`, `content`
  - [ ] Continue loop to next round

### 3.6 Implement Loop Termination
- [ ] In `executeToolLoop()`:
  - [ ] If `finishReason === 'stop'` or `'length'`, return final result
  - [ ] If `finishReason === 'tool_calls'` and `round < maxRounds`, continue
  - [ ] If `round >= maxRounds`, throw error "Tool execution limit exceeded"
  - [ ] If error occurs, throw with context (round number, tool name)

### 3.7 Implement Job Progress Updates
- [ ] In `executeToolLoop()`:
  - [ ] For each tool call, call `provider.appendToolCall(jobId, { id, name, status: 'running' })`
  - [ ] On tool completion, call `provider.appendToolCall(jobId, { id, status: 'completed', finishedAt })`
  - [ ] On tool error, call `provider.appendToolCall(jobId, { id, status: 'error', error })`
  - [ ] After each round, call `provider.updateJobMetadata(jobId, { toolRounds })`

### 3.8 Implement Error Handling
- [ ] Add try-catch around tool execution
  - [ ] Tool errors: Pass error message to model as tool result (don't fail job)
  - [ ] Network errors: Retry once with exponential backoff
  - [ ] Timeout errors: Abort round, pass timeout error to model
  - [ ] Unexpected errors: Fail job with context

### 3.9 Unit Tests for Tool Executor
- [ ] Create `server/utils/background-jobs/__tests__/tool-executor.test.ts`
  - [ ] Test single round tool execution
  - [ ] Test multi-turn tool conversation (2 rounds)
  - [ ] Test max rounds limit enforcement
  - [ ] Test max tools per round limit enforcement
  - [ ] Test tool execution error handling
  - [ ] Test network error retry logic
  - [ ] Test timeout handling
  - [ ] Mock OpenRouter API responses
  - [ ] Mock ServerToolRegistry

---

## Phase 4: Stream Handler Integration

**Requirements:** 1.1, 1.2

### 4.1 Modify consumeBackgroundStream
- [ ] Modify `server/utils/background-jobs/stream-handler.ts`:
  - [ ] Import `executeToolLoop` and `getServerToolRegistry`
  - [ ] Add `toolCalls` array to accumulate tool_call events
  - [ ] In the `for await (const evt of parseOpenRouterSSE())` loop:
    - [ ] Add `else if (evt.type === 'tool_call')` branch
    - [ ] Push tool call to `toolCalls` array
    - [ ] Emit tool call status via `emitJobToolCall()` (new function)

### 4.2 Implement Tool Loop Invocation
- [ ] After the SSE parsing loop in `consumeBackgroundStream()`:
  - [ ] Check `if (toolCalls.length > 0)`
  - [ ] Build `initialMessages` from job context (reconstruct conversation)
  - [ ] Call `executeToolLoop({ jobId, initialMessages, model, apiKey, ... })`
  - [ ] Capture `loopResult`
  - [ ] Set `fullContent = loopResult.finalContent`
  - [ ] Call `provider.updateJobMetadata(jobId, { toolRounds: loopResult.toolRounds })`

### 4.3 Create Message Reconstruction Helper
- [ ] Create `buildMessagesFromJobContext(context: BackgroundStreamParams): ORMessage[]` in `stream-handler.ts`
  - [ ] Extract messages from `context.body.messages` (initial conversation)
  - [ ] Return as OpenRouter-compatible message array

### 4.4 Implement SSE Tool Call Events
- [ ] Create `emitJobToolCall()` in `server/utils/background-jobs/viewers.ts`:
  - [ ] Add to `LiveJobEvent` union type: `{ type: 'tool_call', toolCall: ToolCallState }`
  - [ ] Emit event to all listeners via `state.listeners`
  - [ ] Update job live state with active tool call

### 4.5 Update Error Handling
- [ ] In `consumeBackgroundStream()`:
  - [ ] Wrap `executeToolLoop()` in try-catch
  - [ ] On tool execution error, emit error event and fail job
  - [ ] Ensure cleanup runs (flush timers, release locks)

### 4.6 Integration Tests
- [ ] Create `server/utils/background-jobs/__tests__/stream-handler-tools.test.ts`
  - [ ] Mock OpenRouter to return tool_call events
  - [ ] Mock ServerToolRegistry with test tool
  - [ ] Verify tool execution triggered
  - [ ] Verify tool results sent back to model
  - [ ] Verify final content persisted
  - [ ] Mock multi-turn tool conversation

---

## Phase 5: Memory Leak Fixes

**Requirements:** 3.1, 3.2, 3.3

### 5.1 Fix Job Viewer Cleanup
- [ ] Modify `server/utils/background-jobs/viewers.ts`:
  - [ ] In `registerJobStream()`, add immediate cleanup check after listener removal
  - [ ] If `state.listeners.size === 0` AND `state.status !== 'streaming'`, call `clearJobLiveState(jobId)`
  - [ ] Create `clearJobLiveState(jobId)` helper:
    - [ ] Clear cleanup timer if exists
    - [ ] Call `state.listeners.clear()`
    - [ ] Delete from `jobStreams` Map

### 5.2 Add Explicit Cleanup on Job Completion
- [ ] In `emitJobStatus()`:
  - [ ] After emitting terminal status (`complete`, `error`, `aborted`)
  - [ ] If `state.listeners.size === 0`, call `clearJobLiveState(jobId)` immediately
  - [ ] Otherwise, schedule cleanup timer (existing behavior)

### 5.3 Fix Stream Handler Resource Cleanup
- [ ] In `consumeBackgroundStream()`:
  - [ ] Wrap existing logic in try-finally block
  - [ ] In finally block:
    - [ ] Call `clearFlushTimer()`
    - [ ] Call `await flushInFlight` (ensure pending writes complete)
    - [ ] Call `reader.releaseLock()` if reader exists

### 5.4 Add Tool Call State Scoping
- [ ] Verify tool call state is per-job (in `toolCalls` array scoped to function)
  - [ ] Ensure no global tool call state leaks
  - [ ] Tool call results only stored in job metadata, not global maps

### 5.5 Memory Leak Tests
- [ ] Create `server/utils/background-jobs/__tests__/memory-leaks.test.ts`
  - [ ] Test viewer registration and disposal
  - [ ] Test live state cleanup on zero viewers
  - [ ] Test cleanup timer triggering
  - [ ] Test cleanup on terminal status
  - [ ] Run 100 jobs and verify `jobStreams.size === 0` after cleanup
  - [ ] Use `jest-leak-detector` or manual heap snapshot checks

---

## Phase 6: Performance Optimizations

**Requirements:** 4.1, 4.2, 4.3

### 6.1 Implement SSE Broadcast Batching
- [ ] Modify `server/utils/background-jobs/viewers.ts`:
  - [ ] Add to `LiveJobState`: `pendingDeltas: string[]`, `lastBroadcastAt: number`, `broadcastTimer: NodeJS.Timeout | null`
  - [ ] Modify `emitJobDelta()`:
    - [ ] Push delta to `state.pendingDeltas`
    - [ ] Check if flush should occur (batch size >= 10 OR interval >= 100ms)
    - [ ] If yes, call `flushPendingDeltas()`
    - [ ] Otherwise, schedule flush timer if not already scheduled

### 6.2 Implement Delta Flush Logic
- [ ] Create `flushPendingDeltas(jobId, state, meta)` in `viewers.ts`:
  - [ ] Concatenate `state.pendingDeltas` into single string
  - [ ] Clear `state.pendingDeltas`
  - [ ] Update `state.lastBroadcastAt`
  - [ ] Clear `state.broadcastTimer` if exists
  - [ ] Emit single SSE event with batched delta to all listeners

### 6.3 Add Flush on Job Completion
- [ ] In `emitJobStatus()`:
  - [ ] Before emitting terminal status, call `flushPendingDeltas()` to flush any pending deltas
  - [ ] Then emit status event

### 6.4 Add Size-Based Flush Trigger
- [ ] In `consumeBackgroundStream()`:
  - [ ] Add constant `FLUSH_SIZE_THRESHOLD = 1024` (1KB)
  - [ ] In update logic, check `if (pendingChunk.length >= FLUSH_SIZE_THRESHOLD)`
  - [ ] If true, trigger flush immediately regardless of time/chunk interval

### 6.5 Convex Provider Optimization
- [ ] Verify existing flush logic in `consumeBackgroundStream()`:
  - [ ] Confirm flush interval: 120ms (configurable via `flushIntervalMs`)
  - [ ] Confirm chunk-based flush: every 3 chunks (configurable via `flushChunkInterval`)
  - [ ] Add size-based flush as enhancement (already covered in 6.4)

### 6.6 Add Convex Indexes
- [ ] In `convex/schema.ts`:
  - [ ] Verify `by_thread_message` index exists on `['thread_id', 'message_id']`
  - [ ] Verify `by_user_status` index exists on `['user_id', 'status']`
  - [ ] Add `by_started_at` index on `['started_at']` for cleanup queries

### 6.7 Performance Tests
- [ ] Create `server/utils/background-jobs/__tests__/performance.test.ts`
  - [ ] Test SSE broadcast latency with 10 listeners
  - [ ] Test batch size accumulation and flush
  - [ ] Test flush on interval elapsed
  - [ ] Test flush on job completion
  - [ ] Measure Convex write throughput (mock Convex client)
  - [ ] Run 20 concurrent jobs and measure memory usage

---

## Phase 7: Workflow Background Execution

**Requirements:** 2.1, 2.2, 2.3

### 7.1 Create Workflow Executor
- [ ] Create `server/utils/background-jobs/workflow-executor.ts`
  - [ ] Define `WorkflowBackgroundParams` interface
  - [ ] Implement `executeWorkflowInBackground(params, provider): Promise<string>` function

### 7.2 Implement Workflow Job Creation
- [ ] In `executeWorkflowInBackground()`:
  - [ ] Call `provider.createJob({ userId, threadId, messageId, model: 'workflow', type: 'workflow' })`
  - [ ] Load workflow definition using `loadWorkflow(workflowId)`
  - [ ] Initialize workflow state with `currentNodeId: null`, `nodeStates: {}`

### 7.3 Implement Workflow Execution with Callbacks
- [ ] In `executeWorkflowInBackground()`:
  - [ ] Call `executeWorkflow({ workflow, prompt, attachments, conversationHistory, apiKey, ... })` from workflow engine
  - [ ] Pass `onToken` callback:
    - [ ] Call `provider.updateJob(jobId, { contentChunk: token })`
  - [ ] Pass `onNodeStart` callback:
    - [ ] Call `provider.updateWorkflowState(jobId, { currentNodeId, nodeStates: { [nodeId]: { status: 'active', startedAt } } })`
  - [ ] Pass `onNodeFinish` callback:
    - [ ] Call `provider.updateWorkflowState(jobId, { nodeStates: { [nodeId]: { status: 'completed', output, finishedAt } } })`
  - [ ] Pass `onToolCallEvent` callback:
    - [ ] Call `provider.appendToolCall(jobId, { nodeId, toolCallId, toolName, status })`
  - [ ] Pass `onError` callback:
    - [ ] Call `provider.failJob(jobId, error.message)`

### 7.4 Implement Workflow State Persistence
- [ ] Ensure `provider.updateWorkflowState()` persists:
  - [ ] `workflowId`, `workflowName`
  - [ ] `nodeStates` (JSON stringified for Convex)
  - [ ] `executionOrder` array
  - [ ] `currentNodeId`
  - [ ] `failedNodeId` (on error)

### 7.5 Implement Workflow Job Completion
- [ ] In `executeWorkflowInBackground()` after workflow execution:
  - [ ] Call `provider.completeJob(jobId, result.finalOutput)`
  - [ ] Return `jobId`

### 7.6 Add Workflow Job Status Endpoint
- [ ] Create/modify `server/api/jobs/[id]/status.ts`:
  - [ ] Return job with `workflowState` field if `type === 'workflow'`
  - [ ] Include `nodeStates`, `executionOrder`, `currentNodeId`

### 7.7 Workflow Integration Tests
- [ ] Create `server/utils/background-jobs/__tests__/workflow-executor.test.ts`
  - [ ] Mock workflow definition with agent node
  - [ ] Mock OpenRouter to return tool calls from agent node
  - [ ] Verify workflow executes in background
  - [ ] Verify node states persisted
  - [ ] Verify tool calls tracked per node
  - [ ] Verify final output stored

---

## Phase 8: UI Integration & SSE Updates

**Requirements:** 6.1, 6.2

### 8.1 Update SSE Endpoint to Emit Tool Events
- [ ] Modify `server/api/jobs/[id]/stream.ts`:
  - [ ] Ensure SSE endpoint emits `tool_call` events from `LiveJobEvent`
  - [ ] Format as `data: {"type":"tool_call","toolCall":{...}}\n\n`

### 8.2 Update Client SSE Subscriber
- [ ] Modify `app/utils/chat/openrouterStream.ts` (or SSE subscriber):
  - [ ] Handle `tool_call` SSE events
  - [ ] Update UI message state with tool call status

### 8.3 Extend UiChatMessage Type
- [ ] Verify `app/utils/chat/uiMessages.ts`:
  - [ ] `UiChatMessage` includes `toolCalls?: ToolCallInfo[]`
  - [ ] `ToolCallInfo` includes `id`, `name`, `status`, `args`, `result`, `error`

### 8.4 Update ChatMessage Component
- [ ] Modify `app/components/chat/ChatMessage.vue`:
  - [ ] Display tool call indicators when `message.toolCalls` is present
  - [ ] Show tool call status: loading, completed, error
  - [ ] Use `ToolCallIndicator.vue` component (if exists) or create new component

### 8.5 Add Tool Call Indicator Component
- [ ] Create `app/components/chat/ToolCallIndicator.vue` (if not exists):
  - [ ] Display tool name, status icon, execution time
  - [ ] Expandable to show tool arguments and result
  - [ ] Error state with error message

### 8.6 Update Workflow UI
- [ ] Modify `app/components/chat/WorkflowExecutionStatus.vue`:
  - [ ] Handle `workflowState` from background job
  - [ ] Display node states with tool call indicators per node
  - [ ] Use existing workflow UI components

### 8.7 UI Tests
- [ ] Create `app/components/chat/__tests__/ChatMessage-tool-calls.test.ts`
  - [ ] Test tool call indicator rendering
  - [ ] Test tool call status updates (loading -> completed)
  - [ ] Test tool call error state
  - [ ] Test expandable tool result display

---

## Phase 9: Testing & Validation

**Requirements:** 7.4

### 9.1 End-to-End Tests
- [ ] Create `tests/e2e/background-tool-execution.test.ts`
  - [ ] **Test 1: User sends message with tool call, navigates away**
    - [ ] Send message "What time is it?" with `get_current_time` tool enabled
    - [ ] Navigate to different thread
    - [ ] Wait for background job to complete
    - [ ] Return to original thread
    - [ ] Verify message shows tool call indicator and final response
  - [ ] **Test 2: Multi-turn tool conversation**
    - [ ] Send message that requires 2 tool calls in sequence
    - [ ] Verify both tool calls executed
    - [ ] Verify final response includes results from both tools
  - [ ] **Test 3: Tool execution error**
    - [ ] Mock tool to throw error
    - [ ] Verify error passed to model as tool result
    - [ ] Verify model responds appropriately to error
  - [ ] **Test 4: Workflow with tool calls**
    - [ ] Execute workflow via slash command
    - [ ] Navigate away
    - [ ] Wait for workflow to complete
    - [ ] Return and verify node states and tool calls

### 9.2 Load Tests
- [ ] Create `tests/load/background-jobs.test.ts`
  - [ ] **Test 1: 20 concurrent background jobs**
    - [ ] Start 20 background jobs with tool calls
    - [ ] Verify all complete within 5 minutes
    - [ ] Measure server CPU/memory usage
  - [ ] **Test 2: SSE broadcast performance**
    - [ ] Attach 10 SSE listeners to single job
    - [ ] Measure SSE event latency (p50, p95, p99)
    - [ ] Verify batching reduces event count
  - [ ] **Test 3: Memory leak validation**
    - [ ] Run 100 background jobs with tool calls
    - [ ] Verify `jobStreams` map is empty after cleanup
    - [ ] Take heap snapshots before/after, compare sizes

### 9.3 Integration Tests (Client + Server)
- [ ] Create `tests/integration/background-tool-flow.test.ts`
  - [ ] Mock Convex provider
  - [ ] Mock OpenRouter API
  - [ ] Test full flow: client sends message -> server executes tools -> client receives result
  - [ ] Verify database writes (job creation, updates, completion)

---

## Phase 10: Monitoring & Documentation

**Requirements:** 6.3, 7.1, 7.2

### 10.1 Add Logging
- [ ] In `tool-executor.ts`:
  - [ ] Log tool execution start: `console.log('[tool-executor] Executing tool', { jobId, toolName })`
  - [ ] Log tool execution complete: `console.log('[tool-executor] Tool completed', { jobId, toolName, durationMs })`
  - [ ] Log tool execution error: `console.error('[tool-executor] Tool failed', { jobId, toolName, error })`
- [ ] In `stream-handler.ts`:
  - [ ] Log tool loop start: `console.log('[stream-handler] Starting tool loop', { jobId, toolCallCount })`
  - [ ] Log tool loop complete: `console.log('[stream-handler] Tool loop complete', { jobId, totalRounds, totalToolCalls })`
- [ ] In `viewers.ts`:
  - [ ] Log SSE batch flush: `console.log('[viewers] Flushed SSE batch', { jobId, batchSize })`

### 10.2 Add Metrics (Optional)
- [ ] Create `server/utils/background-jobs/metrics.ts`:
  - [ ] Define metric types: `background_tool_execution_started`, `background_tool_execution_completed`, `background_tool_execution_failed`
  - [ ] Implement metric collection (in-memory counters or export to monitoring service)
  - [ ] Instrument tool executor with metric calls

### 10.3 Add Configuration
- [ ] Modify `nuxt.config.ts`:
  - [ ] Add `backgroundJobs.toolExecution` section:
    - [ ] `enabled: true` (feature flag)
    - [ ] `maxRounds: 10`
    - [ ] `maxToolsPerRound: 20`
    - [ ] `defaultTimeoutMs: 10000`
  - [ ] Add `backgroundJobs.sseBatching` section:
    - [ ] `enabled: true`
    - [ ] `intervalMs: 100`
    - [ ] `batchSize: 10`

### 10.4 Update Documentation
- [ ] Create `docs/background-tool-execution.md`:
  - [ ] Overview of feature
  - [ ] How it works (architecture diagram)
  - [ ] Configuration options
  - [ ] Creating custom server tools
  - [ ] Troubleshooting guide
  - [ ] Performance tuning
- [ ] Update `README.md`:
  - [ ] Add "Background Tool Execution" section with link to docs
- [ ] Update `AGENTS.md` (if exists):
  - [ ] Document server tool registry
  - [ ] Example server tool implementation

### 10.5 Migration Guide
- [ ] Create `docs/migrations/background-tool-execution.md`:
  - [ ] Convex schema migration steps
  - [ ] Rollback plan
  - [ ] Breaking changes (if any)
  - [ ] Compatibility matrix

### 10.6 Release Notes
- [ ] Draft release notes for feature:
  - [ ] **New:** Background tool execution (tools continue running when you navigate away)
  - [ ] **New:** Server-side tool registry for background execution
  - [ ] **Fixed:** Memory leaks in background job viewers
  - [ ] **Improved:** SSE broadcast performance with batching
  - [ ] **Improved:** Workflow execution in background mode

---

## Task Dependencies

**Phase 1** must complete before **Phase 3** (tool executor needs registry)
**Phase 2** must complete before **Phase 4** (stream handler needs extended schema)
**Phase 3** must complete before **Phase 4** (stream handler calls tool executor)
**Phase 4** must complete before **Phase 7** (workflow executor uses stream handler)
**Phase 5** can run in parallel with **Phase 3** and **Phase 4** (independent bug fixes)
**Phase 6** can run in parallel with **Phase 3** and **Phase 4** (independent optimizations)
**Phase 8** depends on **Phase 4** (UI needs SSE events from server)
**Phase 9** depends on **Phase 1-8** completing (testing validates all phases)
**Phase 10** can start after **Phase 4** (documentation can be written incrementally)

## Estimated Effort

- **Phase 1:** 8-12 hours (server tool registry + built-in tools)
- **Phase 2:** 4-6 hours (schema extensions + migrations)
- **Phase 3:** 12-16 hours (tool execution loop + complex logic)
- **Phase 4:** 6-8 hours (stream handler integration)
- **Phase 5:** 4-6 hours (memory leak fixes)
- **Phase 6:** 6-8 hours (performance optimizations)
- **Phase 7:** 8-10 hours (workflow integration)
- **Phase 8:** 4-6 hours (UI updates)
- **Phase 9:** 10-14 hours (comprehensive testing)
- **Phase 10:** 4-6 hours (docs + monitoring)

**Total Estimated Effort:** 66-92 hours (~2-3 weeks for a single developer)

## Success Criteria

- [ ] Background jobs with tool calls execute successfully (e.g., "What time is it?")
- [ ] Multi-turn tool conversations work (AI calls tool, uses result, calls another tool)
- [ ] Workflows with agent nodes calling tools work in background mode
- [ ] No memory leaks after 100 background jobs (verify with heap snapshots)
- [ ] SSE broadcast latency <100ms p95 with 10 listeners
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] Documentation complete and reviewed
- [ ] Feature deployed to beta environment and validated by users
