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
  - `OR3_BACKGROUND_MAX_JOBS=<n>` (default 20)
  - `OR3_BACKGROUND_MAX_JOBS_PER_USER=<n>` (default 5)
  - `OR3_BACKGROUND_JOB_TIMEOUT=<seconds>`
  - `OR3_BACKGROUND_ENCRYPTION_KEY=<random secret of at least 32 characters>`

`OR3_BACKGROUND_ENCRYPTION_KEY` is required when background streaming is
enabled. It is read at runtime by prebuilt containers and is intentionally not
derived from authentication secrets, so disposable build-time values can never
decrypt persisted user credentials.
Keep this key stable across restarts and replicas; rotating it makes jobs
admitted under the previous key unrecoverable.

If the server route is unavailable (static build, stale route cache, or wrong dev process), background start fails and client helpers cache unavailability.

Eligibility on the client requires all of the following:

- `runtimeConfig.public.backgroundStreaming.enabled` is true (config flag)
- Start mode is `background` (not `foreground`)
- Model modality is text-only (`modalities === ['text']`)
- An authenticated SSR session with an active workspace exists

Tools do not block background mode; when tools are present, the server executes
them in the background tool loop described below.

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

Admission is one provider transaction: an existing job with the same
user/admission id is returned, otherwise both the global and per-user concurrency
limits are checked before the row is inserted. Concurrent requests therefore
cannot oversubscribe the configured caps or launch the same paid generation twice.
Transport retries reuse the admission id even after a terminal result; an
explicit user retry creates a fresh id.

## Process Restart Recovery

Chat jobs stored by a durable provider include the request body and an
authenticated-encrypted OpenRouter credential. A process-local worker claims each
job with a 30-second renewable lease. On startup and every five seconds, each
server claims unowned or expired jobs and resumes them. Provider writes carry the
lease owner, so a stalled process cannot append or complete after another process
has taken over.

OpenRouter streams cannot resume from a byte offset. A recovered model iteration
therefore restarts from its last durable checkpoint. Partial text after that
checkpoint is reset before the retry, and clients reconcile from the shorter
durable offset. Tool results are checkpointed into the next request before another
model call begins. If a process dies while a tool may be executing, the job fails
with an explicit retry message instead of risking a repeated side effect.

The credential envelope uses the dedicated runtime-only
`OR3_BACKGROUND_ENCRYPTION_KEY`; plaintext API keys are never passed to the job
provider. Durable restart recovery requires a durable provider such as Convex.
The `memory` provider remains intended for development and loses its rows on a
process restart.

When using Convex, deploy the provider version and its bundled Convex
schema/functions together; background admission fails closed if the selected
adapter does not provide the durable claim contract.

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
- Durable providers enforce atomic idempotent admission, per-user/global caps,
  renewable worker leases, and fenced progress/terminal writes.
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
