# OR3 Network Integration — Architecture & Usage Guide

> **Audience:** Developers working on or extending or3-chat, or trying to understand how the OR3 Network plugin connects or3-chat to the broader OR3 execution infrastructure.

---

## Table of Contents

1. [What Is OR3 Network?](#1-what-is-or3-network)
2. [Why Does It Exist?](#2-why-does-it-exist)
3. [System-Level Architecture](#3-system-level-architecture)
4. [Authentication & Token Exchange](#4-authentication--token-exchange)
5. [Client-Side Composables](#5-client-side-composables)
6. [Server-Side Bridge](#6-server-side-bridge)
7. [Dashboard UI](#7-dashboard-ui)
8. [Feature Walkthroughs](#8-feature-walkthroughs)
9. [Configuration Reference](#9-configuration-reference)
10. [Design Decisions](#10-design-decisions)
11. [What Does NOT Change](#11-what-does-not-change)
12. [Integration with Existing or3-chat Patterns](#12-integration-with-existing-or3-chat-patterns)
13. [Remaining & Deferred Work](#13-remaining--deferred-work)

---

## 1. What Is OR3 Network?

**OR3 Network** (`or3-net`) is a standalone Bun/TypeScript control-plane service that sits between or3-chat and the OR3 execution infrastructure. It manages:

- **Workspace-scoped node registry** — tracks which compute nodes are registered and approved to run work for a given workspace.
- **Lease scheduling and job routing** — assigns and tracks jobs across approved nodes.
- **A public Host API** (`/v1/…`) — the REST+SSE interface that or3-chat (and other OR3 clients) call to submit jobs, stream results, manage agents, inspect sessions, list nodes, and work with previews.
- **Auth exchange endpoint** (`/v1/auth/exchange`) — accepts a short-lived signed proof from a trusted host (like or3-chat), and issues a workspace-scoped bearer token in return.

`or3-net` is a **separate repository and deployed service**, not part of the or3-chat codebase. The `or3-chat` integration described in this document is or3-chat's *consumer-side* plugin that speaks to a running `or3-net` instance.

### OR3 Execution Stack Overview

```
┌──────────────────┐
│    or3-chat      │  ← Identity/session authority; user-facing UI
│  (this repo)     │
└────────┬─────────┘
         │  short-lived bearer token (workspace-scoped)
         ▼
┌──────────────────┐
│    or3-net       │  ← Control plane: job routing, node registry, sessions
│  (separate svc)  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   or3-intern     │  ← Execution orchestrator
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    or3-node      │  ← Approved compute nodes (e.g. OpenClaw)
└──────────────────┘
```

**or3-chat never talks directly to nodes, `or3-intern`, or `or3-node`.** Its only external interface is `or3-net`.

---

## 2. Why Does It Exist?

### Separation of concerns

or3-chat's job is to be a great chat UI. `or3-net`'s job is to route AI agent workloads to compute nodes. Keeping them separate means:

- or3-chat can evolve its auth model, UI, and workspace system without breaking execution contracts.
- `or3-net` can add node types, scheduling strategies, and provider integrations without affecting the chat UI.

### Security boundary

or3-chat *owns the user's identity and workspace membership*. `or3-net` trusts or3-chat to assert "this authenticated user has permission to work in workspace X." The exchange proof mechanism enforces this without coupling to Clerk, Supabase, or any specific auth provider.

### Feature surface

The or3-net plugin exposes agentic features (multi-step tool-calling jobs, compute node services, generated web previews) in or3-chat without wiring them into the core chat engine. The plugin is **entirely optional** — the rest of or3-chat works without it.

---

## 3. System-Level Architecture

### Chat-side file map

```
app/
├── plugins/
│   └── or3-network.client.ts        # Plugin registration (gated)
│
├── composables/
│   └── or3-net/
│       ├── types.ts                 # All TypeScript types & error class
│       ├── useOr3NetAuth.ts         # Token exchange & cache
│       ├── useOr3NetClient.ts       # Typed REST API client
│       ├── useOr3NetSession.ts      # Chat thread → network session binding
│       ├── useOr3NetJobStream.ts    # SSE job stream reader
│       ├── useOr3NetPresets.ts      # Local preset persistence (Dexie KV)
│       └── useOr3NetPreviewPaneState.ts  # In-memory preview pane registry
│
├── components/
│   └── dashboard/or3-net/
│       ├── Or3NetworkPage.vue       # Main dashboard page (~1600 lines)
│       └── Or3NetPreviewPane.vue    # Pane app for embedded previews
│
server/
├── api/
│   └── or3-net/
│       └── exchange.post.ts         # /api/or3-net/exchange (server bridge)
│
└── utils/
    └── or3-net/
        ├── config.ts                # Config reader (env → Or3NetServerConfig)
        └── assertion.ts             # Session proof issuer (HMAC-SHA256)
```

### Data flow overview

```
Browser                  Nuxt SSR Server             or3-net upstream
   │                          │                              │
   │  POST /api/or3-net/      │                              │
   │  exchange                │                              │
   │ ─────────────────────>  │                              │
   │                          │  resolveSessionContext()     │
   │                          │  can(session, 'workspace.   │
   │                          │       read', workspaceId)   │
   │                          │  issueOr3NetHostAssertion()  │
   │                          │                              │
   │                          │  POST /v1/auth/exchange      │
   │                          │ ──────────────────────────> │
   │                          │  { token, expires_at, ... } │
   │                          │ <────────────────────────── │
   │  { token, workspace_id,  │                              │
   │    expires_at, scopes }  │                              │
   │ <─────────────────────── │                              │
   │                          │                              │
   │  GET/POST /v1/... (with Bearer token)                   │
   │ ─────────────────────────────────────────────────────> │
```

---

## 4. Authentication & Token Exchange

### Overview

The integration uses a **two-step exchange pattern**:

1. The browser calls the local Nuxt server endpoint `POST /api/or3-net/exchange`.
2. The Nuxt server validates the session, issues a signed `session_proof`, and relays it to `or3-net`'s exchange endpoint.
3. `or3-net` verifies the proof and returns a short-lived workspace-scoped bearer token.
4. The browser holds this token **in memory only** (never in `localStorage`).

### Session Proof Format

The proof is a custom format named `or3-chat-assertion-v1`:

```
{
  format: "or3-chat-assertion-v1",
  assertion: "<base64url-encoded-claims>.<hmac-sha256-hex>"
}
```

**Claims payload (JSON → base64url):**
```json
{
  "iss": "or3-chat",
  "aud": "or3-net",
  "sub": "<internal-user-id>",
  "subject": "<internal-user-id>",
  "workspace_id": "<workspace-id>",
  "scopes": ["jobs:read", "jobs:write", ...],
  "iat": <unix-seconds>,
  "exp": <unix-seconds>,
  "kind": "or3-chat-assertion-v1"
}
```

The assertion is signed with HMAC-SHA256 using `OR3_NET_EXCHANGE_SECRET`. This shared-secret approach means `or3-net` must be configured with the same secret to verify proofs.

### Scope Resolution

Scopes are derived from the authenticated session's permissions in `server/utils/or3-net/assertion.ts`:

| or3-chat permission | or3-net scopes granted |
|---|---|
| `workspace.read` | `jobs:read`, `sessions:read`, `agents:read`, `nodes:read`, `services:read`, `previews:read`, `files:read` |
| `workspace.write` | `jobs:write`, `agents:write`, `services:write`, `previews:write` |

### Token Caching (`useOr3NetAuth`)

The `useOr3NetAuth` composable manages the token lifecycle in module-level reactive state (shared across all component instances):

```
Call useOr3NetAuth()
        │
        ▼
hasFreshPayload(workspaceId)?
  YES ─► return cached token
  NO  ─► check in-flight Map for same workspaceId
            in-flight? ─► await existing promise
            none       ─► POST /api/or3-net/exchange
                           store result → payload.value
```

- Tokens are considered stale when they expire within the next **15 seconds**.
- On workspace switch (detected via `watch(activeWorkspaceId, ...)`), the cached payload is immediately invalidated.
- The workspace watcher is installed once at module level (guarded by `workspaceWatcherInstalled` flag).

### Exchange endpoint security

`server/api/or3-net/exchange.post.ts` enforces several layers:

1. **SSR auth gate** — returns `404` if `isSsrAuthEnabled` is false.
2. **Feature gate** — returns `404` if `or3NetConfig.enabled` is false (missing host URL or secret).
3. **Same-origin enforcement** — validates `origin`/`referer` header against the request host (passes through if headers are absent, which is a known limitation; see Issues doc).
4. **Rate limiting** — shares the sync rate limiter at key `auth:or3-net-exchange` per client IP.
5. **Session authentication** — requires an authenticated session with an active workspace.
6. **Authorization** — calls `requireCan(session, 'workspace.read', workspaceId)`.
7. **Workspace ID validation** — if the client sends a `workspace_id` body field, it must match the session's active workspace.
8. **Scope resolution** — empty scope list → `403 Forbidden`.

---

## 5. Client-Side Composables

### `useOr3NetAuth`

**Location:** `app/composables/or3-net/useOr3NetAuth.ts`

Token lifecycle manager. Returns:

| Property/Method | Type | Description |
|---|---|---|
| `token` | `Readonly<Ref<string \| null>>` | Current bearer token |
| `expiresAt` | `Readonly<Ref<string \| null>>` | ISO timestamp of token expiry |
| `scopes` | `Readonly<Ref<string[]>>` | Scopes granted by or3-net |
| `workspaceId` | `Readonly<Ref<string \| null>>` | Workspace the token is bound to |
| `pending` | `Readonly<Ref<boolean>>` | True while an exchange is in flight |
| `error` | `Readonly<Ref<Error \| null>>` | Last exchange error |
| `isConfigured` | `Readonly<ComputedRef<boolean>>` | True if SSR auth + or3Net enabled |
| `getAccessToken(opts?)` | `Promise<string \| null>` | Gets token, refreshing if needed |
| `refresh()` | `Promise<…>` | Forces a fresh exchange |
| `invalidate()` | `void` | Clears cached payload |

**Notes:**
- Module-level state: all callers share the same token and pending flag.
- Auto-triggers a background exchange on mount if configured and no token is cached.

---

### `useOr3NetClient`

**Location:** `app/composables/or3-net/useOr3NetClient.ts`

Typed REST API client for all or3-net Host API endpoints. All methods are async and throw `Or3NetRequestError` on non-2xx responses.

**Internal `request<T>` flow:**

```
attempt(forceRefresh=false)
  └─ getAccessToken()
  └─ fetch(baseUrl + path, { Authorization: Bearer <token>, ... })
  └─ if 401 && !forceRefresh
       ─► auth.invalidate() + attempt(forceRefresh=true)
  └─ if !response.ok
       ─► throw Or3NetRequestError({ status, code, retryAfterMs, ... })
  └─ return parsed JSON
```

**Available API methods:**

| Method | API Endpoint |
|---|---|
| `listAgents(workspaceId)` | `GET /v1/workspaces/:id/agents` |
| `createAgent(workspaceId, body)` | `POST /v1/workspaces/:id/agents` |
| `getAgent(workspaceId, agentId)` | `GET /v1/workspaces/:id/agents/:agentId` |
| `updateAgent(workspaceId, agentId, body)` | `PUT /v1/workspaces/:id/agents/:agentId` |
| `deleteAgent(workspaceId, agentId)` | `DELETE /v1/workspaces/:id/agents/:agentId` |
| `listJobs(workspaceId, query?)` | `GET /v1/workspaces/:id/jobs[?…]` |
| `createJob(workspaceId, body)` | `POST /v1/workspaces/:id/jobs` |
| `getJob(jobId)` | `GET /v1/jobs/:jobId` |
| `abortJob(jobId)` | `POST /v1/jobs/:jobId/abort` |
| `listSessions(workspaceId, query?)` | `GET /v1/workspaces/:id/sessions[?…]` |
| `getSession(workspaceId, sessionId)` | `GET /v1/workspaces/:id/sessions/:sessionId` |
| `listSessionEvents(workspaceId, sessionId, query?)` | `GET /v1/workspaces/:id/sessions/:sessionId/events` |
| `listNodes(workspaceId)` | `GET /v1/workspaces/:id/nodes` |
| `listNodeServices(workspaceId, nodeId)` | `GET /v1/workspaces/:id/nodes/:nodeId/services` |
| `launchNodeService(workspaceId, nodeId, serviceId)` | `POST /v1/workspaces/:id/nodes/:nodeId/services/:serviceId/launch` |
| `restartNodeService(workspaceId, nodeId, serviceId)` | `POST /v1/workspaces/:id/nodes/:nodeId/services/:serviceId/restart` |
| `revokeNodeService(workspaceId, nodeId, serviceId)` | `POST /v1/workspaces/:id/nodes/:nodeId/services/:serviceId/revoke` |
| `listPreviews(workspaceId)` | `GET /v1/workspaces/:id/previews` |
| `launchPreview(workspaceId, previewId, body?)` | `POST /v1/workspaces/:id/previews/:previewId/launch` |
| `revokePreview(workspaceId, previewId)` | `POST /v1/workspaces/:id/previews/:previewId/revoke` |

**`Or3NetRequestError`** (thrown on non-2xx responses) includes:
- `status: number` — HTTP status code
- `code?: string` — machine-readable error code from `or3-net`
- `retryAfterMs?: number` — parsed from `retry_after_ms` body field or `Retry-After` header (in milliseconds)
- `requestId?: string` — upstream request ID for correlation
- `data?: unknown` — full parsed response body

---

### `useOr3NetSession`

**Location:** `app/composables/or3-net/useOr3NetSession.ts`

Manages the mapping between a chat thread (identified by its route param `id` or active pane `threadId`) and a durable `network_session_id` in `or3-net`.

**What it does:**
- Derives `activeClientSessionId` from the current route or multi-pane state.
- Calls `listSessions(workspaceId, { client_kind: 'chat', client_session_id: threadId, limit: 1 })` to find any existing session bound to this thread.
- Caches the result keyed by `workspaceId:clientSessionId`.
- Invalidates on workspace or thread change (via a shared watcher).
- `remember(record)` lets the job submission flow store a newly-created session without a round-trip.

**Why this matters:** `or3-net` uses a `network_session_id` as the durable coordination handle for a job chain. The chat thread's UUID is used as `client_session_id` to bind the two together. After a page refresh, `useOr3NetSession` can recover the session by querying the host rather than assuming a live SSE stream is replaying.

---

### `useOr3NetJobStream`

**Location:** `app/composables/or3-net/useOr3NetJobStream.ts`

Manages a live SSE connection to `GET /v1/jobs/:jobId/stream`.

**Key design choices:**
- Uses `fetch` (not `EventSource`) so the `Authorization: Bearer <token>` header can be sent. `EventSource` does not support custom headers, which would require leaking the token into a query parameter.
- Maintains a `connectionRunId` counter to discard events from stale connections after a reconnect.
- Keeps an in-memory event log capped at **100 entries** (sliding window).
- On clean stream close (server `done`), falls back to `getJob` polling to confirm terminal status.
- On error or dropped connection, schedules a reconnect after **500 ms** (fixed, no backoff).

**Reactive state returned:**

| Property | Type | Description |
|---|---|---|
| `activeJobId` | `Readonly<Ref<string \| null>>` | Currently attached job |
| `pending` | `Readonly<Ref<boolean>>` | Waiting for stream to open |
| `connected` | `Readonly<Ref<boolean>>` | Stream is open and reading |
| `status` | `Readonly<Ref<Or3NetJobStatus \| null>>` | Latest known job status |
| `content` | `Readonly<Ref<string>>` | Accumulated text from `text.delta` events |
| `events` | `Readonly<Ref<Or3NetJobStreamEvent[]>>` | Last ≤100 stream events |
| `result` | `Readonly<Ref<unknown>>` | Payload from `job.completed` |
| `failure` | `Readonly<Ref<Record<string, unknown> \| null>>` | Payload from `job.failed` |
| `isTerminal` | `Readonly<Ref<boolean>>` | True once the job has ended |
| `error` | `Readonly<Ref<Error \| null>>` | Last stream/connection error |

**Methods:**
- `attach(jobId)` — open a stream connection to the given job.
- `detach()` — abort the stream and clear all state.

**SSE frame parsing:**
Frames are delimited by `\n\n`. Each frame is parsed for `event:` and `data:` lines. The `event` name maps directly to the `Or3NetJobStreamEvent` union type.

---

### `useOr3NetPresets`

**Location:** `app/composables/or3-net/useOr3NetPresets.ts`

Persists named configuration snapshots (agent draft + execution target + host URL) in Dexie's KV table under key `or3_net_presets`.

**Behavior:**
- Lazy-loaded on first `useOr3NetPresets()` call on the client.
- Detects workspace/DB changes by comparing `getDb().name` — reloads if the Dexie DB name has changed (workspace switch).
- Deduplicates by `name` during sanitization. On save, upserts by name (preserves original `created_at`).
- Sanitizes all incoming data through `sanitizePreset()` — validates types, coerces unknowns, rejects presets with empty names.
- Persists as JSON to `kv.set('or3_net_presets', JSON.stringify(presets))`.

---

### `useOr3NetPreviewPaneState`

**Location:** `app/composables/or3-net/useOr3NetPreviewPaneState.ts`

An in-memory registry for open preview pane records. Backed by a `Map` on `globalThis` (so it survives hot-module replacement in dev). Exposed as a reactive `ref` for Vue reactivity.

Each record (`Or3NetPreviewPaneRecord`) holds: preview metadata, the current `launch_url`, `embed_url`, delivery mode, expiry, and IDs needed to re-request the launch URL on refresh.

---

## 6. Server-Side Bridge

### `POST /api/or3-net/exchange`

**Location:** `server/api/or3-net/exchange.post.ts`

This is the **only** server-side or3-net endpoint in or3-chat. The browser never calls `or3-net` directly for authentication — it always goes through this local bridge.

**Request:**
```json
{ "workspace_id": "<optional, must match active workspace>" }
```

**Response** (proxied from or3-net):
```json
{
  "token": "<bearer-token>",
  "workspace_id": "<workspace-id>",
  "expires_at": "<ISO-8601>",
  "scopes": ["jobs:read", "jobs:write", ...]
}
```

**Step-by-step processing:**
1. Set `Cache-Control: no-store` response header.
2. Gate on `isSsrAuthEnabled` → `404` if off.
3. Gate on `or3NetConfig.enabled` (requires both `OR3_NET_HOST_URL` and `OR3_NET_EXCHANGE_SECRET`) → `404` if off.
4. Enforce same-origin via `Origin`/`Referer` header comparison.
5. Rate limit check on client IP (`auth:or3-net-exchange`).
6. Resolve session context → `401` if unauthenticated.
7. `requireCan(session, 'workspace.read', workspaceId)`.
8. Parse + validate request body; reject workspace ID mismatch → `403`.
9. Resolve scopes → `403` if empty.
10. `issueOr3NetHostAssertion(...)` → HMAC-signed proof.
11. `fetch(or3NetConfig.hostUrl + '/v1/auth/exchange', { session_proof, workspace_id, provider: 'or3-chat' })` with 10-second timeout.
12. Proxy the upstream response (status + body) back to the browser.
13. Record rate limit usage on success.

### `server/utils/or3-net/config.ts`

Reads and normalizes environment variables into `Or3NetServerConfig`:

```ts
interface Or3NetServerConfig {
  enabled: boolean;         // true iff hostUrl AND exchangeSecret are present
  hostUrl: string;          // normalized HTTP(S) URL, no trailing slash
  exchangeSecret: string;   // raw secret string
  exchangeIssuer: string;   // default: 'or3-chat'
  exchangeAudience: string; // default: 'or3-net'
  exchangeTtlMs: number;    // default: 60_000 (1 minute)
  exchangeTimeoutMs: number; // default: 10_000 (10 seconds)
}
```

### `server/utils/or3-net/assertion.ts`

Issues signed session proofs:

```ts
async function issueOr3NetHostAssertion(input: {
  secret: string;
  subject: string;
  workspaceId: string;
  scopes: readonly string[];
  issuer?: string;
  audience?: string;
  ttlMs?: number;
}): Promise<Or3NetSessionProof>
```

Uses Node.js `crypto.createHmac('sha256', secret)`. Server-only code.

---

## 7. Dashboard UI

### Plugin Registration (`or3-network.client.ts`)

The plugin is client-only (`.client.ts` suffix) and activates only when:
- `runtimeConfig.public.ssrAuthEnabled === true`
- `runtimeConfig.public.or3Net.enabled === true`

On activation it:
1. Registers the `or3-net-preview` pane app (lazy-imports `Or3NetPreviewPane.vue`).
2. Registers the dashboard plugin entry (lazy-imports `Or3NetworkPage.vue`).

### `Or3NetworkPage.vue` (Main Dashboard)

The primary user interface (~1600 lines). Organized into vertical sections:

#### Section 1: Connection Status Card
Shows: configured host URL, active chat thread ID, active workspace ID, bound network session ID, token status, expiry time. Provides a **Refresh Token** button.

#### Section 2: Saved Presets Card
- Lists all presets stored in Dexie KV.
- Each preset has **Apply** (loads agent draft + execution target into the editor) and **Delete** actions.
- A **Save Current Preset** form lets the user capture the current editor state.

#### Section 3: Agents Card
- Lists workspace agents from `or3-net`.
- Agent editor form: ID, name, instructions (textarea), tool policy mode, adapter kind, allowed/blocked tools, capabilities, preferred node IDs, isolation class.
- **Create Agent** or **Save Agent** (update) and **Delete Agent** actions.
- Agent data is stored in `or3-net`, not locally.

#### Section 4: Job Submission + Recent Jobs
- **Submit form**: text area for job message + execution target selector (local/remote) + optional agent profile selector.
- **Recent jobs list**: shows last 20 jobs for the current network session (or workspace if no session), with status badges.
- Selecting a job shows a **Job Detail** panel with:
  - Live stream output (`useOr3NetJobStream`)
  - Tool call/result events
  - Raw job JSON
  - **Abort** button for running jobs

#### Section 5: Nodes & Services
- Lists approved nodes for the workspace with status, capabilities, adapter kind, version, and resource limits.
- For each node, lists services with **Open Dashboard**, **Restart**, and **Revoke** actions.
- `Open Dashboard` calls `launchNodeService(…)` and opens the returned URL in a new tab (only for `launchable` services with valid HTTP(S) URLs).

#### Section 6: Previews
- Lists workspace previews with kind, source type, delivery mode, and status.
- **Open Pane** — launches the preview (calls `launchPreview`), then:
  - If the preview is iframe-safe + multi-pane is available → opens `Or3NetPreviewPane.vue` as an in-app pane.
  - Otherwise → falls back to `window.open(…, '_blank')`.
- **Open External** — always opens in a new tab.
- **Revoke** — calls `revokePreview` and refreshes the list.

### `Or3NetPreviewPane.vue` (Pane App)

A minimal pane component for embedded previews:
- Renders an `<iframe>` pointing at `embed_url` (if iframe-safe).
- Shows a fallback "Embedded preview unavailable" state with an **Open in New Tab** button if not iframe-safe.
- Header actions: **Open in New Tab**, **Refresh** (re-requests launch URL), **Revoke**.
- Cleans up its `Or3NetPreviewPaneRecord` from the registry on `onUnmounted`.

---

## 8. Feature Walkthroughs

### Submit a Job

```
User fills in job message → clicks "Submit Job"
  │
  ├─ useOr3NetSession.refresh()         ← ensure we have a network_session_id
  │
  ├─ client.createJob(workspaceId, {
  │    network_session_id,
  │    client_kind: 'chat',
  │    client_session_id: threadId,
  │    message,
  │    execution_target,
  │    profile_name (if agent selected),
  │    allowed_tools (from agent policy)
  │  })
  │
  ├─ store returned job_id
  ├─ session.refresh({ force: true })   ← bind session if first job
  ├─ refreshJobs()                      ← update list
  └─ selectedJobId = job_id            ← auto-select for stream view
```

### Stream a Job

```
selectedJobId changes
  │
  └─ watch(selectedJobId) triggers loadSelectedJob(jobId)
        │
        ├─ client.getJob(jobId)          ← load detail
        └─ jobStream.attach(jobId)       ← open SSE stream
              │
              └─ fetch /v1/jobs/:id/stream
                    (Authorization: Bearer <token>)
                    │
                    ├─ text.delta → content.value += text
                    ├─ tool.call / tool.result → recorded in events[]
                    ├─ job.completed → isTerminal = true; result captured
                    ├─ job.failed → isTerminal = true; failure captured
                    └─ connection drop → syncJobState() + scheduleReconnect(500ms)
```

### Open an Embedded Preview

```
User clicks "Open Pane" on a preview
  │
  ├─ client.launchPreview(workspaceId, previewId, { launch_mode_hint: 'pane' })
  │    → returns Or3NetLaunchMetadata { launch_url, embed_url, supports_iframe, ... }
  │
  ├─ Validate launch_url protocol is HTTP(S)
  │
  ├─ if supports_iframe AND multi-pane API is available:
  │    previewPaneState.remember({ preview, launch })  → returns Or3NetPreviewPaneRecord
  │    multiPane.openPane({ mode: 'custom', appId: 'or3-net-preview', recordId })
  │
  └─ else:
       window.open(launch_url, '_blank', 'noopener,noreferrer')
```

### Workspace Switch Invalidation

```
user switches workspace
  │
  └─ useWorkspaceManager().activeWorkspaceId changes
        │
        ├─ useOr3NetAuth: watch(activeWorkspaceId) → invalidateState()
        │    payload = null, boundWorkspaceId = null
        │
        ├─ useOr3NetSession: watch([workspaceId, clientSessionId]) → invalidateState()
        │    session = null, boundKey = null
        │
        └─ useOr3NetPresets: loadPresets() compares getDb().name
             → reloads if DB changed (new workspace DB)
```

---

## 9. Configuration Reference

### Required environment variables

| Variable | Description |
|---|---|
| `SSR_AUTH_ENABLED=true` | Enables server-side auth (prerequisite for or3-net). |
| `OR3_NET_HOST_URL` | Base URL of the or3-net service (e.g. `https://net.example.com`). |
| `OR3_NET_EXCHANGE_SECRET` | Shared HMAC secret used to sign session proofs. Must match or3-net's configured verification secret. |

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `OR3_NET_EXCHANGE_ISSUER` | `or3-chat` | JWT `iss` field in the session proof. |
| `OR3_NET_EXCHANGE_AUDIENCE` | `or3-net` | JWT `aud` field in the session proof. |
| `OR3_NET_EXCHANGE_TTL_MS` | `60000` | Token TTL in milliseconds (min 1000). |
| `OR3_NET_EXCHANGE_TIMEOUT_MS` | `10000` | Upstream timeout for `/v1/auth/exchange` in milliseconds (min 1000). |
| `NUXT_PUBLIC_OR3_NET_HOST_URL` | — | Alternative way to set host URL (public runtimeConfig). |

### What happens when variables are missing

- If `OR3_NET_HOST_URL` is set but `OR3_NET_EXCHANGE_SECRET` is absent: a startup warning is logged and the plugin is silently disabled.
- If both are absent: the plugin is disabled; all or3-net endpoints return `404`.
- Static builds (no SSR auth) are **never affected**: the plugin is fully gated by `ssrAuthEnabled`.

### How config flows into the runtime

```
.env → nuxt.config.ts → runtimeConfig
          │                │
          ▼                ▼
  private.or3Net.*    public.or3Net.*
  (server-only)       (browser-safe)
       │
       ▼
  getOr3NetServerConfig()   ← used by exchange.post.ts
```

Public config (`public.or3Net`):
```ts
{ enabled: boolean, hostUrl: string }
```

Private config (`or3Net`):
```ts
{ hostUrl, exchangeSecret, exchangeIssuer, exchangeAudience, exchangeTtlMs }
```

---

## 10. Design Decisions

| Decision | Rationale |
|---|---|
| Plugin, not core feature | Keeps or3-chat buildable and fully functional without or3-net configured. The plugin is lazy-loaded and entirely inactive without a host URL. |
| Token stored in memory only | Short-lived tokens must not survive page refresh. Re-exchange is cheap; the session proof is already available server-side. |
| Server bridge for exchange | The browser never holds the HMAC secret or calls or3-net's auth endpoint directly. The Nitro server acts as the secure mediator. |
| Provider-agnostic exchange | The proof mechanism uses `useSessionContext` + `can()` — it does not import Clerk, Supabase, or any specific auth SDK. |
| `fetch`-based SSE (not `EventSource`) | `EventSource` does not support custom headers; the Bearer token would have to go in a query param, which leaks it into server logs and browser history. |
| Saved presets in workspace KV | Local-first, workspace-scoped, zero server dependency. Consistent with or3-chat's other lightweight prefs storage. |
| Service launch, not raw tunnel UI | End users think in terms of apps (OpenClaw dashboard), not ports and proxy tokens. The launch URL returned by or3-net abstracts this safely. |
| Embedded preview via pane app | Keeps users inside or3-chat for iframe-safe previews while still allowing external launch as fallback. Revocation is available in-pane. |
| HMAC-SHA256 assertion format | Lightweight proof mechanism that doesn't require a PKI setup. The shared secret pattern is appropriate for a server-to-server trust relationship within a single operator's infrastructure. |

---

## 11. What Does NOT Change

- **Core chat runtime** — no workflow executor changes, no new streaming architecture in the chat engine.
- **Auth providers** — no new Clerk/Supabase/basic-auth code. The exchange composable is provider-agnostic.
- **Sidebar structure** — the plugin uses existing dashboard registry and sidebar navigation patterns.
- **Local DB schema** — the plugin only uses the existing `kv` Dexie table for presets. No new tables.
- **Static builds** — the plugin remains completely inactive when SSR auth is disabled. Static deployments are unaffected.

---

## 12. Integration with Existing or3-chat Patterns

| Pattern | How or3-net uses it |
|---|---|
| `useWorkspaceManager` | Source of `activeWorkspaceId` for token scoping and invalidation |
| `can()` + `requireCan()` | Authorization gate before issuing exchange proofs |
| `resolveSessionContext()` | Session resolution in the exchange endpoint |
| `isSsrAuthEnabled()` | Feature gate for all server-side or3-net code |
| `checkSyncRateLimit` / `recordSyncRequest` | Rate limiting on the exchange endpoint |
| Dexie KV (`getKvByName` / `setKvByName`) | Preset persistence |
| `registerDashboardPlugin` | Dashboard page registration |
| `usePaneApps` → `registerPaneApp` | Preview pane app registration |
| `getGlobalMultiPaneApi()` | Opening preview panes in the multi-pane UI |
| `setNoCacheHeaders` | Cache-control on the exchange endpoint |
| `normalizeHost`, `getProxyRequestHost` | Same-origin enforcement |

---

## 13. Follow-Up

The consumer-side contract hardening for the current OR3 Net baseline is now shipped:

- Exchange contract, workspace invalidation, canonical error-envelope parsing, fixture-backed contract tests, and CI coverage are implemented in `or3-chat`.
- The exact cross-repo backlog still lives in `planning/or3-net/tasks.md` and the upstream `or3-net/planning/platform-standardization/tasks.md`.

The main deferred item in `or3-chat` after this baseline is future config/wizard alignment if the install flow needs stricter `OR3_NET_*` emission guarantees.
