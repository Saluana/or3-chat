---
artifact_id: af1d2883-dea3-4207-be16-4e76e28d045e
---

# Design: Background execution for workflows and tools

## Overview
Extend the existing background job pipeline to support two additional execution types: (1) tool-aware background LLM streams and (2) workflow execution that can continue while the user is detached. The solution preserves current foreground behavior and the plugin registry model while introducing server-side execution surfaces that are SSR-safe and `can()`-gated.

## Architecture

```mermaid
graph TD
    Client[Client Chat UI] -->|background request| ServerStream[/api/openrouter/stream]
    ServerStream -->|start job| JobStore[BackgroundJobProvider]
    ServerStream -->|stream+tools| BgLoop[Background Stream Loop]
    BgLoop --> ToolExec[Tool Execution Service]
    BgLoop --> WorkflowExec[Workflow Execution Service]
    BgLoop --> JobStore
    JobStore --> JobSSE[/api/jobs/:id/stream]
    JobStore --> JobPoll[/api/jobs/:id/status]
    JobSSE --> Client
    JobPoll --> Client
    WorkflowExec --> Hooks[Hook Engine]
    ToolExec --> Hooks
    BgLoop --> Notify[Notification Hooks]
```

## Key changes

### 1) Background job payload expansion
Extend background job records to carry structured metadata for tool calls and workflow state, without breaking existing consumers.

```ts
export type BackgroundJobKind = 'chat' | 'workflow';

export interface BackgroundJobToolState {
    id: string;
    name: string;
    status: 'loading' | 'complete' | 'error' | 'skipped';
    args: string;
    output?: string;
    error?: string;
}

export interface BackgroundJobWorkflowState {
    workflowId: string;
    workflowName: string;
    executionState: 'running' | 'pending' | 'completed' | 'error' | 'stopped' | 'interrupted';
    nodeStates: Record<string, unknown>;
    finalOutput?: string;
    hitlRequests?: unknown[];
}

export interface BackgroundJobV2 {
    kind: BackgroundJobKind;
    toolCalls?: BackgroundJobToolState[];
    workflowState?: BackgroundJobWorkflowState;
}
```

- **Compatibility:** keep existing fields (`content`, `status`) unchanged, add optional metadata fields.
- **Transport:** enrich `/api/jobs/:id/status` and SSE payloads with `tool_calls` and `workflow_state` fields.

### 2) Hybrid tool registry
Introduce a server-capable tool registry that mirrors the existing client registry but enforces SSR boundaries.

```ts
export type ToolRuntime = 'hybrid' | 'client' | 'server';

export interface ToolDefinitionV2 extends ToolDefinition {
    runtime?: ToolRuntime; // default: 'hybrid'
}

export interface ToolHandlerMap {
    client?: ToolHandler;
    server?: ToolHandler;
}

export interface ToolRegistrationOptions {
    runtime?: ToolRuntime;
    handlers?: ToolHandlerMap;
    timeout?: number;
}
```

- **Default behavior:** registration without a runtime flag is treated as `hybrid`.
- **Client-only tools:** server execution returns a structured error (`skipped`) and emits tool-call failure to the assistant response.
- **Server-only tools:** only registered in server plugins under `server/**` (SSR-safe).
- **No breaking changes:** existing `useToolRegistry` API remains; new overload supports extended options.

### 3) Background tool execution pipeline
When background streaming detects tool calls, it uses the server tool registry to execute them and appends tool messages before continuing the model loop.

- **Flow:**
  1. Parse tool_call SSE events.
  2. Record tool call state in job metadata and stream deltas to viewers.
  3. Execute tool via server registry.
  4. Append tool output as tool messages and continue to next model iteration.
- **Timeouts:** tool execution uses the same timeout defaults as the registry (10s default) with override per tool.

### 4) Workflow execution in background
Introduce a server workflow execution adapter that reuses or3-workflow-core in server runtime.

```ts
export interface WorkflowExecutionRequest {
    workflowId: string;
    threadId: string;
    messageId: string;
    input: string;
    attachments?: Array<{ hash: string; mime: string }>;
}

export interface WorkflowExecutionAdapter {
    execute(request: WorkflowExecutionRequest): Promise<void>;
    respondHitl(requestId: string, action: string, response?: unknown): Promise<void>;
}
```

- **Data access:** resolve workflow definitions from the canonical sync backend (not client Dexie) using SSR session scope.
- **State streaming:** workflow engine events update `workflowState` in the job record and are streamed to SSE viewers.
- **HITL:** pending HITL requests are stored in `workflowState` and surfaced to clients for action.

### 5) Authorization and security
- **SSR gating:** background job APIs and workflow execution endpoints require SSR auth and `can()` checks.
- **Workspace scoping:** all tool/workflow reads and writes must be scoped to the session’s workspace.
- **Sensitive data:** redact secrets in job metadata; never store raw API keys or auth headers.

### 6) Client integration
- **Background job tracker:** extend existing tracker to handle `tool_calls` and `workflow_state` updates.
- **UI state:** reuse existing `workflowState` rendering (e.g., `WorkflowExecutionStatus`) by mapping background state to existing UI types.
- **Fallbacks:** if background execution is not available, keep current foreground behavior.

## Error handling
Use a `ServiceResult` pattern for background execution actions to standardize error surfaces.

```ts
type ServiceResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string; retryable?: boolean };
```

- **Tool errors:** recorded as `toolCalls[].status = 'error'` and summarized in assistant output.
- **Workflow errors:** mark job `status = 'error'` and capture `workflowState.executionState = 'error'`.
- **Authorization errors:** return 401/403 with no job creation.

## Testing strategy

- **Unit tests**
  - Tool runtime resolution (hybrid/client/server)
  - Background job metadata updates and SSE serialization
  - Workflow event-to-state mapping
- **Integration tests**
  - Background job with tool execution loop
  - Background workflow execution with HITL pause/resume
  - Authorization checks for job status/stream endpoints
- **E2E tests**
  - Run workflow in background, switch threads, reattach, verify final output
  - Execute tool in background, ensure tool results are persisted and follow-up LLM response completes
- **Performance tests**
  - Concurrency limits and timeouts under load
  - SSE/polling fallback with large content updates
