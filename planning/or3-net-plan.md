# OR3 Net Plan for `or3-chat`

> This file describes the work that belongs **inside the `or3-chat` repo** as part of the broader OR3 Network initiative.
> For the full network plan see `or3-net/plan.md` and `or3-net/planning/`.

---

## Context — What is OR3 Network?

OR3 Network (`or3-net`) is a Bun/TypeScript service that sits between `or3-chat` and the OR3 execution infrastructure (`or3-intern` + `or3-sandbox`). It owns:

- Workspace-scoped node registry, lease scheduling, and job routing.
- A public Host API (`/v1/...`) for job submission, streaming, node management, and auth exchange.
- TypeScript SDKs for `or3-intern` and `or3-sandbox`.

`or3-chat` remains the **identity/session authority**. It never talks directly to nodes, `or3-intern`, or `or3-sandbox`. Instead it:

1. Exchanges the user's active chat session for a short-lived `or3-net` workspace token.
2. Uses that token to call `or3-net` Host API endpoints from a plugin UI.

`or3-chat` should treat its own thread or client conversation identifier as `client_session_id`. `or3-net` now resolves that value plus `client_kind: 'or3-chat'` into a durable `network_session_id`, while still binding the underlying execution to `or3-intern`'s `session_key`.

---

## What changes in `or3-chat`

### 1. New plugin: OR3 Network

A new sidebar/plugin surface (similar to existing plugins like `webhooks-dashboard.client.ts` or `workflow-slash-commands.client.ts`) that gives users:

- **Agent definitions** — create, edit, and save agent configs (name, instructions, tool policy, preferred node requirements).
- **Job submission** — pick an agent, provide input, optionally set timeout, and submit to `or3-net`.
- **Recent jobs list** — shows job status with live indicators for running, completed, aborted, failed.
- **Live job output** — streams text deltas, tool call events, and completion via SSE from `or3-net`.
- **Nodes and services** — show approved node-backed apps/services, starting with OpenClaw, and offer service-oriented actions like `Open Dashboard`.
- **Embedded previews** — show static websites and generated web artifacts inside a pane app when the preview is safe to embed.
- **Saved network presets** — reusable config objects for host URLs, agents, and node preferences, stored using the same patterns the repo already uses for content/docs/custom post types.

Current baseline implemented:

- `app/plugins/or3-network.client.ts` registers a dashboard entry only when SSR auth and OR3 Net host config are enabled.
- `app/plugins/or3-network.client.ts` also registers an `or3-net-preview` pane app for embedded preview launches.
- `app/components/dashboard/or3-net/Or3NetworkPage.vue` provides the initial status shell for the active workspace.
- `app/components/dashboard/or3-net/Or3NetworkPage.vue` now includes a thread-aware submit form plus recent jobs list/detail panel.
- `app/components/dashboard/or3-net/Or3NetworkPage.vue` now attaches a live job stream, shows streamed text/event payloads, and exposes abort handling for running jobs.
- `app/components/dashboard/or3-net/Or3NetworkPage.vue` now lists approved nodes, loads advertised services per node, and launches service dashboards through host-issued `launch_url` values.
- `app/components/dashboard/or3-net/Or3NetworkPage.vue` now lists workspace previews and opens iframe-safe launches in the preview pane with a clean new-tab fallback.

### 2. Token exchange composable

A new composable (likely under `app/composables/or3-net/`) that:

- Reads the current user/workspace identity from the existing `useSessionContext()` flow (in `app/composables/auth/useSessionContext.ts`).
- Calls `POST /v1/auth/exchange` on the configured `or3-net` host, passing a session proof the chat auth provider can produce.
- Caches the returned short-lived `or3-net` bearer token in memory (not localStorage).
- Automatically re-exchanges when the token expires or when the workspace switches.

Current baseline implemented:

- `app/composables/or3-net/useOr3NetAuth.ts` exchanges through local `POST /api/or3-net/exchange`.
- The exchanged token stays in memory only and is invalidated on workspace change.
- `app/composables/or3-net/useOr3NetClient.ts` performs bounded 401 refresh/retry for host API calls.
- `app/composables/or3-net/useOr3NetSession.ts` recovers the current chat thread's `network_session_id` by matching host session records.

This composable is **provider-agnostic**: it uses the same `useSessionContext` + `useAuthTokenBroker` patterns that already power Convex sync auth and background streaming auth. It does not import Clerk or any specific provider SDK.

The companion API client should preserve and reuse `network_session_id` returned by the first successful job/session lookup for a given chat thread so subsequent submits and inspection views can bind to the same durable coordination session.

### 3. Workspace switch handling

When the user changes workspaces (via `WorkspaceManager.vue` → `useWorkspaceManagerSession`), the plugin must:

- Invalidate the cached `or3-net` token.
- Re-exchange for a token scoped to the new workspace.
- Rebind the job list, agent definitions, and any active SSE subscription to the new workspace context.

This mirrors how existing plugins like `convex-sync.client.ts` and `notification-listeners.client.ts` already watch session/workspace changes.

### 4. SSE streaming and abort UX

- The plugin subscribes to `GET /v1/jobs/:jobId/stream` on `or3-net` using EventSource or a fetch-based SSE reader.
- Events include `text.delta`, `tool.call`, `tool.result`, `job.completed`, `job.aborted`, `job.failed`.
- On disconnect, the plugin should reconnect and resume from the last received event (if the `or3-net` API supports cursor-based reconnect) or re-fetch current job status.
- Abort sends `POST /v1/jobs/:jobId/abort` and updates local state to reflect the terminal status.

Current baseline implemented:

- `app/composables/or3-net/useOr3NetJobStream.ts` uses a fetch-based SSE reader so bearer-authenticated job streams work without leaking tokens into query params.
- The stream view reconnects after dropped connections and falls back to `getJob` state refresh for terminal status reconciliation.
- The jobs page refreshes selected job detail and list state after terminal stream events and abort requests.

The plugin should also consume the non-streaming session inspection routes:

- `GET /v1/workspaces/:workspaceId/sessions`
- `GET /v1/workspaces/:workspaceId/sessions/:sessionId`
- `GET /v1/workspaces/:workspaceId/sessions/:sessionId/events`

This lets `or3-chat` reload durable recent history for a thread after refresh or reconnect without depending on a live SSE stream replay.

### 5. Service launch UX for sandbox-backed dashboards

For services like OpenClaw, the plugin should not ask the user to manage raw tunnels. Instead it should:

- List known services/apps exposed by the selected node.
- Call an `or3-net` launch endpoint when the user clicks `Open Dashboard`.
- Receive an opaque, short-lived `launch_url` from `or3-net`.
- Open that URL in a new tab or pane.

For sandbox-backed nodes in v1, `or3-net` will likely back this flow with `or3-sandbox`'s existing signed browser tunnel URL capability. That means the browser gets a narrow, expiring service-launch path rather than sandbox bearer credentials.

OpenClaw is the reference case because `or3-sandbox` already supports a browser-ready dashboard URL that combines:

- the tunnel browser bootstrap URL
- the narrow tunnel cookie bootstrap flow
- the OpenClaw gateway token fragment used by the app itself

The plugin should treat this as a service launch action, not as generic tunnel management.

Current baseline implemented:

- `app/composables/or3-net/useOr3NetClient.ts` now exposes typed node/service list, launch, restart, and revoke helpers.
- The dashboard page lists approved nodes plus adapter-reported services for the active workspace.
- `Open Dashboard` only renders for launchable services and opens validated `http(s)` `launch_url` values returned by `or3-net`.

### 6. Embedded pane previews for static sites

When the agent creates a static site or similar file-backed preview, the best UX is often to keep the user inside `or3-chat`.

The expected flow is:

- `or3-net` exposes a preview descriptor that marks the preview as iframe-safe.
- The plugin opens a pane app containing an iframe pointed at the preview URL.
- The pane header shows `Open in New Tab`, `Refresh`, and `Revoke`.

This should only be used for workspace-owned preview URLs issued by `or3-net`, not arbitrary external sites.

If the preview is not safe to embed, the pane should show a clear fallback state with `Open in New Tab`.

Current baseline implemented:

- `app/composables/or3-net/useOr3NetClient.ts` now exposes typed preview list, launch, and revoke helpers.
- `app/components/dashboard/or3-net/Or3NetPreviewPane.vue` renders the iframe-safe preview shell with `Open in New Tab`, `Refresh`, and `Revoke` actions.
- Preview launches request a fresh host-issued URL on open and refresh instead of reusing stale launch state.

---

## What does NOT change

- **Core chat runtime** — no workflow executor refactor, no new streaming architecture in the chat engine itself.
- **Auth providers** — no new Clerk/Supabase/basic-auth code. The token exchange composable consumes the existing session proof without coupling to a specific provider.
- **Sidebar structure** — the new plugin uses the existing sidebar navigation and plugin registration patterns; no new navigation system.
- **Local DB** — the plugin may use the Dexie KV table for small prefs (like the selected `or3-net` host URL), but job/agent authority stays in `or3-net`.

---

## Design decisions

| Decision | Rationale |
|---|---|
| Plugin, not core feature | Keeps `or3-chat` buildable and usable without `or3-net`. The plugin is lazy-loaded and only active when a host URL is configured. |
| Token in memory only | Short-lived tokens should not survive page refresh in localStorage. Re-exchange is cheap and the session proof is already available. |
| Reuse `useSessionContext` | Avoids duplicating auth state. The workspace/session watcher is already battle-tested across multiple plugins. |
| SSE for job output | Matches the pattern `or3-net` uses internally (relay from `or3-intern` SSE). No need for a custom WebSocket protocol for v1. |
| Saved presets as content objects | Aligns with how the repo already handles docs, projects, and custom post types in Dexie + optional sync. |
| Service launch, not raw tunnel UI | End users think in terms of apps like OpenClaw, not ports and proxy tokens. This is simpler and more secure. |
| Embedded preview for static output | Keeps users inside chat for the common case of generated sites, while still allowing external launch when needed. |

---

## Repo-aligned implementation notes

These notes capture the concrete `or3-chat` patterns the OR3 Network work should reuse when implementation starts.

### Plugin registration model

- Client plugins belong in `app/plugins/*.client.ts` and should register their surfaces during app startup.
- Dashboard-style entry points should follow the existing dashboard registry model documented in `public/_documentation/composables/useDashboardPlugins.md`.
- Sidebar chrome additions should follow the sidebar registry model documented in `public/_documentation/composables/useSidebarSections.md`.
- Keep the feature lazy-loaded: register the OR3 Network entry eagerly, but defer importing the main page and heavy UI trees until the user opens it.

### Session and auth model

- Use `app/composables/auth/useSessionContext.ts` as the source of truth for active user/workspace identity.
- Keep the `or3-net` token exchange provider-agnostic and behind existing abstractions; do not import Clerk or other provider SDKs into the plugin.
- Cache exchanged `or3-net` tokens in memory only.
- Preserve the durable `network_session_id` returned by the first successful binding for a chat thread and reuse it for subsequent submits, inspection, and reload recovery.

### Workspace switch and lifecycle model

- Mirror the workspace-sensitive watcher/teardown behavior already used by `app/plugins/convex-sync.client.ts`.
- Mirror the client-only listener and cleanup discipline used by `app/plugins/notification-listeners.client.ts`.
- Treat job streams, preview embeds, and service launch state as workspace-scoped resources that must be torn down on workspace switch.
- Force a fresh token exchange before issuing new `or3-net` calls after workspace rebinding.

### UI and persistence expectations

- Reuse existing repo storage/content patterns for saved network presets and agent presets rather than introducing a parallel persistence model.
- Use small KV-backed prefs only for lightweight plugin settings such as the selected host URL or default filters.
- Prefer service-oriented actions (`Open Dashboard`, `Restart Service`, `Revoke`) over any raw tunnel-management UX.
- Use the `or3-net` session inspection routes to repopulate durable history after refresh instead of assuming live SSE replay is always available.

---

## Affected files and areas

| Area | Likely files | Notes |
|---|---|---|
| Plugin entry | `app/plugins/or3-network.client.ts` | Registers sidebar page, route, and plugin lifecycle |
| Sidebar page | `app/components/or3-network/Or3NetworkPage.vue` | Main plugin view shell |
| Agent UI | `app/components/or3-network/AgentEditor.vue`, `AgentList.vue` | CRUD for agent definitions |
| Job UI | `app/components/or3-network/JobSubmit.vue`, `JobList.vue`, `JobStream.vue` | Submit, list, and live output |
| Node/service UI | `app/components/or3-network/NodeList.vue`, `ServiceLaunchCard.vue` | Node status and service actions like `Open Dashboard` |
| Preview pane UI | `app/components/or3-network/PreviewPane.vue`, `PreviewHeader.vue` | Embedded iframe previews and fallback actions |
| Token exchange | `app/composables/or3-net/useOr3NetAuth.ts` | Session exchange, refresh, workspace rebind |
| API client | `app/composables/or3-net/useOr3NetClient.ts` | Typed fetch wrapper for host API calls |
| Sidebar nav | `app/components/sidebar/SideNavContent.vue` | Add OR3 Network entry (gated on config) |
| Config | `app.config.ts` or KV pref | `or3NetHostUrl` setting |

---

## Tasks

- [x] **Plugin shell** — Add `app/plugins/or3-network.client.ts` that registers the sidebar entry, route, and lazy-loaded page component. Gate activation on a configured `or3-net` host URL.
- [x] **Token exchange composable** — Add `useOr3NetAuth` that reads `useSessionContext`, calls the local exchange adapter, caches the token in a reactive ref, and re-exchanges on expiry or workspace switch.
- [x] **API client composable** — Add `useOr3NetClient` that wraps host requests with the token from `useOr3NetAuth`, handles 401 retry, and provides typed methods for jobs and session inspection.
- [ ] **Agent management UI** — Add agent list and editor components. Agents are CRUD'd against `or3-net` and displayed in the sidebar page.
- [x] **Job submission UI** — Add a minimal job submission form for the current chat thread plus a recent jobs list with status badges.
- [x] **Live job output view** — Add SSE-based streaming view that displays text deltas and tool call events in real time, with abort button and terminal state handling.
- [x] **Node/service view** — Add node cards and service actions. For OpenClaw-like services, show `Open Dashboard` and let the plugin open the returned `launch_url`.
- [x] **Embedded preview pane** — Add a pane app for static previews that loads iframe-safe preview URLs and shows `Open in New Tab` fallback in the header.
- [x] **Workspace switch handling** — Wire token invalidation and state rebind into the workspace change watcher, following the pattern in `convex-sync.client.ts`.
- [ ] **Saved presets** — Add network/agent preset storage using the repo's content/doc patterns, so users can save and reuse host + agent configurations.
- [x] **Tests** — Add unit tests for token exchange, session binding recovery, workspace switch rebind, jobs page behavior, node/service launch behavior, preview pane behavior, exchange route error paths, and plugin host gating for the current slice.
- [x] **Docs** — Add baseline planning notes explaining the local exchange adapter and minimum OR3 Net host configuration required to enable the plugin.

---

## Deferred contract and conformance follow-up

These are the `or3-chat`-owned carry-over items from the cross-repo platform-standardization work. Keeping them here makes this file the place to resume later.

### Session proof exchange freeze

- [ ] Freeze the exchange request shape used by `or3-chat`: `{ provider, session_proof, workspace_hint? }`.
- [ ] Document what `or3-chat` sends as `session_proof` for each supported auth provider.
- [ ] Keep provider-specific auth details hidden behind existing abstractions such as session context and token broker helpers.

### Workspace switch invalidation contract

- [x] Freeze the workspace-switch invalidation behavior for cached `or3-net` tokens.
- [x] Ensure active workspace-scoped views are torn down on workspace switch, especially job streams and preview embeds.
- [ ] Document the invalidation contract so `or3-net` can rely on chat-side cleanup when rebinding coordination sessions.

### Error envelope consumption

- [ ] Parse canonical `ErrorEnvelope` responses from `or3-net` instead of assuming ad-hoc `{ error }` payloads.
- [ ] Use `retry_after_ms` from `ErrorEnvelope` for `429` retry scheduling instead of fixed backoff.
- [ ] Surface canonical error codes in user-facing states where they improve recovery guidance.

### Contract fixtures and CI

- [ ] Add `or3-chat` fixtures for `or3-net` exchange request/response shapes.
- [x] Add `or3-chat` fixtures for normalized `or3-net` job stream events.
- [ ] Add fixture-backed contract tests for the frozen `or3-net` API shapes consumed by the plugin.
- [ ] Add `or3-chat` CI coverage for those `or3-net` API contract fixtures.

### Config alignment

- [ ] Align any future `or3-chat` wizard/env emission with the canonical cross-repo naming convention.
- [x] Keep `or3-net` host configuration documented alongside the plugin usage flow for the current baseline.

## Minimum configuration

Enable the current baseline with these env values in `or3-chat`:

- `SSR_AUTH_ENABLED=true`
- `OR3_NET_HOST_URL=https://your-or3-net-host`
- `OR3_NET_EXCHANGE_SECRET=...`

Optional overrides:

- `OR3_NET_EXCHANGE_ISSUER`
- `OR3_NET_EXCHANGE_AUDIENCE`
- `OR3_NET_EXCHANGE_TTL_MS`

Static builds remain unaffected because the client plugin stays inactive unless SSR auth is enabled and the public OR3 Net config is present.

---

## Cross-repo references

- Upstream chat-plugin scope is summarized in `or3-net/planning/06-chat-plugin.md`.
- Deferred `or3-chat` standardization tasks are tracked in `or3-net/planning/platform-standardization/tasks.md`.
- Non-chat contract and config alignment details live under `or3-net/planning/platform-standardization/`.