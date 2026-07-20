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

Each job has one process-local tracker and one adaptive reconciliation transport,
regardless of viewer count. Healthy SSE delivery suppresses hot polling. Polling
uses typed retryable transport/rate-limit/server errors with bounded jitter,
limited not-found reconciliation, and one bounded auth refresh. A transient poll
or Dexie failure does not fabricate model completion or advance the durable offset.

Foreground and background provider consumption use the same pure normalized
stream reducer. It owns iteration boundaries, cumulative text/reasoning limits,
tool-call state, and terminal-state validation, with parity fixtures covering the
durable records produced by both execution paths.

The tracker captures the originating workspace database. Navigation can detach UI
subscribers, but completion persistence always targets that original database.

This is what keeps background output visible and restorable after navigation/reload.

## Job Payload Contract

Background job APIs include these metadata fields:

- `tool_calls?: Array<{ id?, name, status, args?, result?, error? }>`
- `workflow_state?: WorkflowMessageData`

Polling/SSE support delta mode:

- `content_delta`
- `content_length`
- `offset` query parameter for incremental fetch

Viewer queues have a byte high-water mark. Slow consumers are disconnected through
the same idempotent cleanup path used for request close/cancel, and reconnect from
their last durable offset. Provider and Dexie writes are coalesced by time/size and
terminal state always flushes pending text, reasoning, image, tool, and workflow
metadata.

Every upstream operation composes caller cancellation with a response-header
deadline. Streaming bodies also have a per-read idle watchdog. Caller aborts,
response timeouts, and idle timeouts remain distinct typed outcomes so retry and
terminal persistence cannot mistake a timeout for successful completion.

## Canonical transcript

Foreground and background writers persist the same versioned transcript model:
turn ID, parent assistant, request/generation ID, tool call ID, reasoning/files,
and terminal state. Provider projection reconstructs an assistant `tool_calls`
entry followed by matching tool-result messages. Tool completion is durable before
the next model request, so reload cannot repeat an already completed side effect.

## Security and Limits

- SSR-only auth checks for all background job endpoints.
- Chat background start requires `workspace.write`; viewers cannot launch paid
  background work even when they supply a caller-owned OpenRouter key.
- Managed OpenRouter credentials require an authenticated workspace writer.
  Guest foreground traffic must use caller-supplied credentials.
- Workflow endpoints enforce `can('workspace.write')`.
- Background provider enforces concurrency/timeouts/retention.
- With the Convex provider, every job persistence function is an internal
  Convex function reached by an admin-authenticated SSR adapter. Direct Convex
  callers cannot create, inspect, mutate, abort, count, or clean jobs, and the
  stored-owner checks do not accept a wildcard user ID.
- Workflow state size is bounded (`MAX_WORKFLOW_STATE_BYTES = 64KB`).
- Responses use `Cache-Control: no-store` where applicable.

## Structured Logging

Background tool/workflow execution emits structured JSON events from server runtime paths, including:

- job lifecycle (`started`, `completed`, `failed`, `aborted`)
- tool call lifecycle (`received`, `completed`, `failed`)
- workflow node lifecycle and HITL request points
- notification emission failure events

Log payloads are redacted before emission for secret-like keys (`token`, `secret`, `password`, `apiKey`, etc.) and token-like strings (Bearer/JWT/key patterns).

## E2E Coverage

Deterministic browser harness + Playwright specs cover:

- reattachment behavior while streaming is still active
- detached completion notification emission behavior

## Related

- `public/_documentation/utils/tool-runtime.md`
- `public/_documentation/utils/server-tool-registry.md`
- `public/_documentation/utils/openrouterStream.md`
