# Background Execution (Streaming + Workflows)

OR3 supports SSR background jobs for chat streaming, tool execution, and workflows so work can continue when the user detaches or navigates away.

This document covers the implementation currently wired in:

- Chat background streaming (`/api/openrouter/stream` with `_background: true`)
- Background job status/reattach APIs (`/api/jobs/:id/status`, `/api/jobs/:id/stream`, `/api/jobs/:id/abort`)
- Workflow background execution (`/api/workflows/background`)
- Workflow HITL responses (`/api/workflows/hitl`)

## Enablement and Boundaries

Background execution is available only when SSR auth/server routes are active.

- Runtime gate: `runtimeConfig.public.backgroundStreaming.enabled === true`
- Server gate: `runtimeConfig.backgroundJobs.enabled === true`
- Main envs:
  - `OR3_BACKGROUND_STREAMING_ENABLED=true`
  - `OR3_BACKGROUND_STREAMING_PROVIDER=memory|convex|...`
  - `OR3_BACKGROUND_MAX_JOBS=<n>`
  - `OR3_BACKGROUND_JOB_TIMEOUT=<seconds>`

If the server route is unavailable (static build, stale route cache, or wrong dev process), background start fails and client helpers cache unavailability.

## Chat Background Streaming Flow

1. Client starts with `startBackgroundStream(...)` in `app/utils/chat/openrouterStream.ts`.
2. Request body includes:
   - `_background: true`
   - `_threadId`
   - `_messageId`
   - optional `_toolRuntime` map (`toolName -> runtime`)
3. `POST /api/openrouter/stream` validates auth/session and background params.
4. Server creates a job (`kind: 'chat'`) via the configured `BackgroundJobProvider`.
5. `server/utils/background-jobs/stream-handler.ts` runs the stream loop and writes:
   - content deltas
   - `chunksReceived`
   - optional `tool_calls` metadata
6. Viewers receive live updates through SSE (`/api/jobs/:id/stream`) and/or polling (`/api/jobs/:id/status?offset=N`).
7. On terminal state (`complete|error|aborted`), status is persisted and notifications are emitted when no viewers are attached.

## Background Tool Execution

When tools are included in the background request, the server switches to `consumeBackgroundStreamWithTools(...)`.

- Tool calls are captured from streamed `tool_call` events.
- Server executes each call through `executeServerTool(...)`.
- Tool state is persisted on the job in `tool_calls` with statuses:
  - `loading`
  - `complete`
  - `error`
  - `skipped`
  - `pending`
- Client-only tools are skipped with a clear error message.
- Tool outputs are appended as tool messages for follow-on turns.
- Safety cap: max 10 tool loop iterations per job.

## Background Workflow Execution

Workflows start with `POST /api/workflows/background`.

Server-side behavior:

1. SSR auth required (`isSsrAuthEnabled`).
2. `requireCan(session, 'workspace.write', ...)` enforces authorization.
3. Rate limit `workflow:background` is checked.
4. Canonical workflow definition is resolved from server catalog (`resolveCanonicalWorkflow`).
5. Job starts with `kind: 'workflow'`.
6. `server/utils/workflows/background-execution.ts` runs execution via `OpenRouterExecutionAdapter` and streams:
   - node state transitions
   - workflow tokens (`finalOutput`)
   - `workflow_state` snapshots

`workflow_state` is persisted on the background job and includes execution state, per-node states, HITL requests, output, and version counter.

## HITL Pause/Resume

Workflow HITL requests are persisted in `workflow_state.hitlRequests`.

- Pause occurs when engine emits `onHITLRequest`.
- Client responds via `POST /api/workflows/hitl`.
- Endpoint is SSR-gated, `can()`-gated, and rate-limited (`workflow:hitl`).
- `resolveHitlRequest(...)` updates persisted `workflow_state` and unblocks waiting execution.

## Reattach and Recovery

Client tracking is handled by `app/utils/chat/useAi-internal/backgroundJobs.ts`:

- Prefers SSE (`/api/jobs/:id/stream?offset=N`)
- Falls back to polling (`/api/jobs/:id/status?offset=N`)
- Persists incremental updates into Dexie assistant message records
- Restores `tool_calls` and `workflow_state` into message `data`
- Emits workflow hooks:
  - `workflow.execution:action:state_update`
  - `workflow.execution:action:complete`

This is what keeps background output visible and restorable after navigation/reload.

## Job Payload Contract

Background job APIs include these metadata fields:

- `tool_calls?: Array<{ id?, name, status, args?, result?, error? }>`
- `workflow_state?: WorkflowMessageData`

Polling/SSE support delta mode:

- `content_delta`
- `content_length`
- `offset` query parameter for incremental fetch

## Security and Limits

- SSR-only auth checks for all background job endpoints.
- Workflow endpoints enforce `can('workspace.write')`.
- Background provider enforces concurrency/timeouts/retention.
- Workflow state size is bounded (`MAX_WORKFLOW_STATE_BYTES = 64KB`).
- Responses use `Cache-Control: no-store` where applicable.

## Related

- `public/_documentation/utils/tool-runtime.md`
- `public/_documentation/utils/server-tool-registry.md`
- `public/_documentation/utils/openrouterStream.md`
