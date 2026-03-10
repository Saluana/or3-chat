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

---

## What changes in `or3-chat`

### 1. New plugin: OR3 Network

A new sidebar/plugin surface (similar to existing plugins like `webhooks-dashboard.client.ts` or `workflow-slash-commands.client.ts`) that gives users:

- **Agent definitions** — create, edit, and save agent configs (name, instructions, tool policy, preferred node requirements).
- **Job submission** — pick an agent, provide input, optionally set timeout, and submit to `or3-net`.
- **Recent jobs list** — shows job status with live indicators for running, completed, aborted, failed.
- **Live job output** — streams text deltas, tool call events, and completion via SSE from `or3-net`.
- **Saved network presets** — reusable config objects for host URLs, agents, and node preferences, stored using the same patterns the repo already uses for content/docs/custom post types.

### 2. Token exchange composable

A new composable (likely under `app/composables/or3-net/`) that:

- Reads the current user/workspace identity from the existing `useSessionContext()` flow (in `app/composables/auth/useSessionContext.ts`).
- Calls `POST /v1/auth/exchange` on the configured `or3-net` host, passing a session proof the chat auth provider can produce.
- Caches the returned short-lived `or3-net` bearer token in memory (not localStorage).
- Automatically re-exchanges when the token expires or when the workspace switches.

This composable is **provider-agnostic**: it uses the same `useSessionContext` + `useAuthTokenBroker` patterns that already power Convex sync auth and background streaming auth. It does not import Clerk or any specific provider SDK.

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

---

## Affected files and areas

| Area | Likely files | Notes |
|---|---|---|
| Plugin entry | `app/plugins/or3-network.client.ts` | Registers sidebar page, route, and plugin lifecycle |
| Sidebar page | `app/components/or3-network/Or3NetworkPage.vue` | Main plugin view shell |
| Agent UI | `app/components/or3-network/AgentEditor.vue`, `AgentList.vue` | CRUD for agent definitions |
| Job UI | `app/components/or3-network/JobSubmit.vue`, `JobList.vue`, `JobStream.vue` | Submit, list, and live output |
| Token exchange | `app/composables/or3-net/useOr3NetAuth.ts` | Session exchange, refresh, workspace rebind |
| API client | `app/composables/or3-net/useOr3NetClient.ts` | Typed fetch wrapper for host API calls |
| Sidebar nav | `app/components/sidebar/SideNavContent.vue` | Add OR3 Network entry (gated on config) |
| Config | `app.config.ts` or KV pref | `or3NetHostUrl` setting |

---

## Tasks

- [ ] **Plugin shell** — Add `app/plugins/or3-network.client.ts` that registers the sidebar entry, route, and lazy-loaded page component. Gate activation on a configured `or3-net` host URL.
- [ ] **Token exchange composable** — Add `useOr3NetAuth` that reads `useSessionContext`, calls `POST /v1/auth/exchange`, caches the token in a reactive ref, and re-exchanges on expiry or workspace switch.
- [ ] **API client composable** — Add `useOr3NetClient` that wraps `$fetch` with the token from `useOr3NetAuth`, handles 401 retry, and provides typed methods for agent CRUD, job submit, job get, job abort.
- [ ] **Agent management UI** — Add agent list and editor components. Agents are CRUD'd against `or3-net` and displayed in the sidebar page.
- [ ] **Job submission UI** — Add a job submission form (select agent, provide input, set timeout) and a recent jobs list with status badges.
- [ ] **Live job output view** — Add SSE-based streaming view that displays text deltas and tool call events in real time, with abort button and terminal state handling.
- [ ] **Workspace switch handling** — Wire token invalidation and state rebind into the workspace change watcher, following the pattern in `convex-sync.client.ts`.
- [ ] **Saved presets** — Add network/agent preset storage using the repo's content/doc patterns, so users can save and reuse host + agent configurations.
- [ ] **Tests** — Add unit tests for token exchange (mock session, mock exchange endpoint), workspace switch rebind, SSE reconnect behavior, and abort state transitions.
- [ ] **Docs** — Add a brief plugin usage section to the repo docs or inline help explaining how to configure the `or3-net` host URL and use the plugin.