# requirements.md

## Purpose

Define the MVP requirements for a VueFlow-based AI workflow builder that can be launched from chat `/commands`. The builder must let users chain multiple OpenRouter calls with per-node model selection, per-node tool allowlists, and lightweight parallel fan-out/merge while reusing existing OR3 systems (tool registry, theme runtime, hook bus, TipTap suggestion UX). The scope is client-side only for v1; server persistence is out of scope but should remain pluggable.

## Functional Requirements

### 1. Slash Command Entry & Launch

User Story: As a chat user, I want to trigger workflows via `/workflow` so I can stay keyboard-first and avoid navigating away from chat.

Acceptance Criteria:
1.1 `/workflow` slash command opens a command palette/suggestion list in the chat composer, mirroring the @mention popover UX (same focus retention behavior).【F:app/plugins/ChatMentions/suggestions.ts†L12-L116】
1.2 Command list must include: run saved flow, create new flow, and “open last edited” options.
1.3 Trigger text (`/workflow ...`) is removed from the editor once the palette closes or after a selection is made to avoid stray characters, matching mention behavior.【F:app/plugins/ChatMentions/suggestions.ts†L30-L115】

### 2. Workflow Composition Surface

User Story: As a builder, I want a simple canvas to connect LLM calls so I can prototype flows quickly.

Acceptance Criteria:
2.1 VueFlow canvas supports only three node types in v1: Start, LLM, Merge/Refine.
2.2 Node inspector allows editing title, description, model, tool allowlist, prompt template, and optional parallel group key.
2.3 Edge creation must prevent cycles; attempting to connect downstream → upstream is blocked with inline messaging.
2.4 Builder UI uses theme system (`v-theme` or `useThemeResolver`) so colors, spacing, and typography match the active theme/context (chat or sidebar).【F:app/theme/README.md†L18-L166】

### 3. Per-Node Tool Allowlist

User Story: As a user configuring a node, I want to pick which tools it can call so I can avoid unintended actions.

Acceptance Criteria:
3.1 Node inspector lists tools from the tool registry (`useToolRegistry`) with enabled/disabled state, grouped by category where available.【F:app/utils/chat/tool-registry.ts†L16-L120】
3.2 Selected tool IDs are persisted per node; execution filters the registry’s enabled definitions against this allowlist before sending to OpenRouter.
3.3 If a previously selected tool is no longer registered or disabled, the node shows a warning and excludes it at run time.

### 4. Per-Node Model Selection

User Story: As a multi-model user, I want each node to pick its own model so I can combine GPT-5, Perplexity, etc. in one flow.

Acceptance Criteria:
4.1 Model selector supports search + manual entry; values validate against the user’s accessible model list before execution.
4.2 Each node persists its chosen model; execution passes the model identifier directly to the OpenRouter call.
4.3 Favorites (existing model preference list) appear as quick chips for faster setup.

### 5. Parallel Fan-out and Merge

User Story: As a user exploring options, I want to run multiple nodes in parallel and merge the results for refinement.

Acceptance Criteria:
5.1 Nodes sharing a parallel group key under the same parent execute concurrently (fan-out).
5.2 Merge/Refine node accepts multiple inbound edges and receives ordered payloads `{ nodeId, model, output }` for synthesis.
5.3 Execution waits for all members of a parallel group; partial failures surface per-node errors and do not silently skip merges.

### 6. Execution Orchestrator

User Story: As a runner, I want the workflow to execute deterministically and surface status so I can trust results.

Acceptance Criteria:
6.1 Graph validation (acyclic, connected Start) runs before execution; errors block run with actionable messages.
6.2 Execution topologically orders nodes; siblings in the same parallel group are dispatched concurrently with a configurable concurrency cap.
6.3 Each LLM node constructs messages from Start input + upstream outputs; Merge nodes concatenate/structure outputs before calling their model.
6.4 Hook actions emit lifecycle events (`workflow:node:start/completed/error`, `workflow:run:completed`) on the global hook bus for telemetry and plugins.【F:docs/hooks.md†L1-L158】

### 7. Persistence & Storage

User Story: As a returning user, I want my flows to persist locally so I can reuse them without rebuilding.

Acceptance Criteria:
7.1 Flows save to local Dexie/IndexedDB per workspace; schema stores `workflows`, `workflow_runs` (inputs, outputs, timings), and lightweight settings.
7.2 Export/import to JSON is supported for sharing in v1; no server sync is required.
7.3 Storage layer is abstracted so a future server-backed provider can be added without rewriting the builder UI.

### 8. Theme & UX Consistency

User Story: As a user, I want the builder to feel native to the app so it doesn’t clash with chat styling.

Acceptance Criteria:
8.1 All buttons, inputs, toggles, and canvas chrome apply `v-theme` with correct context (`chat` when opened from chat, `sidebar` when docked).【F:app/theme/README.md†L18-L166】
8.2 Slash command palette reuses mention popover styling/components to keep consistent visuals and keyboard behavior.【F:app/plugins/ChatMentions/suggestions.ts†L20-L115】
8.3 Builder supports light/dark theme switching automatically via the theme resolver.

### 9. Extensibility & Plugin Hooks

User Story: As a plugin developer, I want to replace the builder or execution engine without forking chat surfaces.

Acceptance Criteria:
9.1 Provide a registry that maps builder IDs to renderers/executors; default entry is VueFlow. Plugins can register alternatives (e.g., n8n) that the slash command can route to.
9.2 Hooks allow plugins to observe/augment lifecycle: `workflow:command:invoked`, `workflow:builder:opened`, `workflow:run:completed`, and node-level events. HMR-safe disposers are required to avoid duplicate handlers.【F:docs/hooks.md†L12-L149】
9.3 Execution adapter interface hides OpenRouter specifics so a plugin can swap in a remote orchestrator while keeping node schema.

### 10. Error Handling & Telemetry

User Story: As a developer and user, I want clear errors and timing data so I can debug failed runs.

Acceptance Criteria:
10.1 Node-level status badges show pending/running/success/error with timestamps and error messages.
10.2 Failed nodes block downstream execution; users can retry from a failed node.
10.3 `workflow_runs` store per-node duration, error, and tool usage metadata for later inspection.

## Non-functional Requirements

- **Simplicity**: Keep the node palette minimal; no conditional branches or loops in v1.
- **Performance**: Concurrency cap defaults to a safe value to avoid overwhelming OpenRouter; UI remains responsive during streaming.
- **Accessibility**: Slash palette and builder controls are keyboard-navigable; focus is retained in the chat editor when opening/closing palettes.【F:app/plugins/ChatMentions/suggestions.ts†L30-L115】
- **Theming**: No custom wrappers that bypass the theme resolver; rely on `v-theme`/`useThemeResolver` for overrides.【F:app/theme/README.md†L18-L166】
- **Testability**: Execution engine is modular (graph validation, planner, runner) to allow unit tests without VueFlow.
