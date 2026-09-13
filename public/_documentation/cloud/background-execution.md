# Background Execution (Streaming + Workflows)

OR3 supports SSR background jobs for chat streaming, tool execution, and workflows so work can continue when the user detaches or navigates away.

This document covers the implementation currently wired in:

- Chat background streaming (`/api/openrouter/stream` with `_background: true`)
- Background job status/reattach APIs (`/api/jobs/:id/status`, `/api/jobs/:id/stream`, `/api/jobs/:id/abort`)
- Workflow background execution (`/api/workflows/background`)
- Workflow HITL responses (`/api/workflows/hitl`)

## Enablement and Boundaries

Background chat execution is available only when SSR auth, canonical sync, and
server routes are active.

- Runtime gate: `runtimeConfig.public.backgroundStreaming.enabled === true`
- Server gate: `runtimeConfig.backgroundJobs.enabled === true`
- Main envs:
  - `OR3_BACKGROUND_STREAMING_ENABLED=true`
  - `OR3_BACKGROUND_STREAMING_PROVIDER=memory|sqlite|convex|...`
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
- `runtimeConfig.public.sync.enabled` is true
- Model modality is text-only (`modalities === ['text']`)
- An authenticated SSR session with an active workspace exists

Eligible chat turns start as server-side background jobs whenever background
streaming is enabled. There is no separate start-mode setting.

Tools do not block background mode; when tools are present, the server executes
them in the background tool loop described below.

## Chat Background Streaming Flow

1. Client starts with `startBackgroundStream(...)` in `app/utils/chat/openrouterStream.ts`.
2. Request body includes:
   - `_background: true`
   - `_threadId`
   - `_messageId`
   - `_backgroundAdmissionId` (stable per user-initiated send; transport retries reuse it)
   - `_history` (version 1 immutable thread/message admission envelope)
   - optional `_toolRuntime` map (`toolName -> runtime`)
3. `POST /api/openrouter/stream` validates auth/session and background params.
4. The selected sync gateway atomically writes the admission rows, contiguous
   change-log versions, and an idempotent generation receipt. Only then can the
   server claim the job and contact OpenRouter.
5. `server/utils/background-jobs/stream-handler.ts` runs the stream loop and writes:
   - content deltas
   - reasoning deltas (reasoning-only progress counts and streams independently)
   - `chunksReceived`
   - optional `tool_calls` metadata
   - a single terminal snapshot (`content`, `reasoning`, `tool_calls`, `error`) that
     moves the job's durable `history_phase` to `finalization_pending`
6. Viewers receive live updates through SSE (`/api/jobs/:id/stream`) and/or polling (`/api/jobs/:id/status?offset=N`).
7. On terminal state (`complete|error|aborted`), status is persisted and notifications are emitted when no viewers are attached.

Admission is one provider transaction: an existing job with the same
user/admission id is returned, otherwise both the global and per-user concurrency
limits are checked before the row is inserted. Concurrent requests therefore
cannot oversubscribe the configured caps or launch the same paid generation twice.
Transport retries reuse the admission id even after a terminal result; an
explicit user retry creates a fresh id.

A request that asked for background execution never silently falls through to a
client-bound foreground stream. If the server has background execution disabled
it returns `503 { code: 'background_streaming_disabled' }` before contacting
OpenRouter, and the client caches that capability rejection for the session.
The server response also carries `historyVersion: 1`. A missing/mismatched
version or a gateway without `backgroundGenerationHistory: 'v1'` fails closed
with `background_history_unsupported` before model execution.

### Cancelling before the job ID exists

`POST /api/jobs/admission-abort` accepts `{ admissionId }`. Providers implement
the durable `cancelAdmission` contract: a committed streaming job is aborted
immediately; otherwise a cancellation marker is recorded in the job store
(memory, SQLite `background_admission_cancels`, Convex
`background_admission_cancels`) and `createJob` observes the same record inside
its admission transaction, rejecting creation with `AdmissionCancelledError`.
A Stop therefore cannot be lost to a crash or a second worker, and a late
admission can never launch work. Providers that predate the contract fall back
to the in-process marker, which is best-effort and logged.

### Terminal retention and transport errors

Terminal jobs are retained for 24 hours (`completedJobRetentionMs`) as the
durable buffer the browser uses to persist completed output after navigation or
disconnect. Deleting them earlier risks losing a completed answer when no client
was attached at completion time.

Transport, protocol, and auth failures while polling or watching a job never
rewrite the assistant message as a failed generation. The server closes an SSE
viewer instead of emitting a synthetic terminal `error`, and the client
classifies retryable failures (network, timeout, 429, 5xx), pauses on auth, and
stops reconnection on malformed protocol responses. A job confirmed missing via
bounded 404s is projected as `stream_interrupted` so Continue is offered.

### Output limits

Canonical sync history has a per-operation ceiling (`MAX_SYNC_PAYLOAD_BYTES`,
256 KiB). When canonical sync is enabled, generated output is bounded
*before it is accepted* by `MAX_CANONICAL_MESSAGE_OUTPUT_BYTES` (224 KiB),
counting text, reasoning, tool arguments/results, and terminal fields. Exceeding
the budget stops the stream with an explicit `OutputLimitExceededError`; the
accepted prefix is preserved and the message is finalized as failed, never
silently truncated. Local-only workspaces do not have canonical history and keep
the larger in-memory stream cap (4 MiB).

### Generation history phases

Jobs carry a durable `history_phase` (`ready`, `admission_pending`,
`finalization_pending`, `committed`, `superseded`, `blocked`). Reasoning and the
terminal snapshot persist independently of the client, and recovery resets both
text and reasoning to their checkpoints together. Retention cleanup only deletes
terminal jobs whose history phase is settled (`ready`/`committed`/`superseded`),
so a completed generation whose canonical write is still pending is never lost
to retention. The recovery scan delivers both pending phases without rerunning
model work. Admission and finalization each use a
`(workspace, generation, stage)` receipt, so a process crash can replay either
transaction safely. Finalization commits only while the assistant row still has
the admitted generation and clock; deletion, editing, or a newer generation
records `superseded` instead of overwriting newer history.

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
provider. Durable restart recovery requires a durable provider such as SQLite
or Convex.
The `memory` provider remains intended for development and loses its rows on a
process restart.

SQLite stores job rows, workflow snapshots, inactivity timestamps,
cancellation, and worker leases in the same database used by OR3 sync. A Nitro
HMR/module reload therefore cannot make a live job disappear from the status or
abort routes. Selecting an unregistered non-memory provider fails startup rather
than silently degrading to process memory.

When using Convex, deploy the provider version and its bundled Convex
schema/functions together; background admission fails closed if the selected
adapter does not provide the durable claim contract.

Continue uses this same path for eligible text models. The job starts with the
existing answer and reasoning as its durable base, and the shared continuation
normalizer removes the `>>` marker and replay overlap on the server. Switching
threads during admission or generation detaches the UI while the job continues.

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

Cancellation is authoritative at the provider. External providers are polled
through a run-local abort signal so Stop interrupts the active model request and
prevents later nodes from starting. The abort response also emits a terminal
workflow snapshot immediately; the card, node spinners, and composer Stop button
do not wait for a refresh or a later poll.

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
- Persists incremental updates into Dexie assistant message records as local
  projections; version-1 canonical jobs suppress client outbox capture because
  the sync gateway owns admission and terminal history
- Restores `tool_calls` and `workflow_state` into message `data`
- Emits workflow hooks:
  - `workflow.execution:action:state_update`
  - `workflow.execution:action:complete`

Each job has one process-local tracker and one adaptive reconciliation transport,
regardless of viewer count. Healthy SSE delivery suppresses hot polling. Polling
uses typed retryable transport/rate-limit/server errors with bounded jitter,
limited not-found reconciliation, and one bounded auth refresh. A transient poll
or Dexie failure does not fabricate model completion, cancel a valid server job,
or advance the durable offset. Terminal provider state is projected into both
Dexie and the live card from the same normalized snapshot, including lost-job
reconciliation where the server has no final workflow payload.

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
- Synchronized message payloads are bounded at 256KB and compact oversized
  workflow projections before sync.
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
