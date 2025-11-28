# tasks.md

1. Slash Command & Palette
- [ ] Implement `/workflow` TipTap suggestion provider reusing mention popover renderer; ensure trigger removal on close to keep editor clean. (Req §1.1–§1.3)
- [ ] Populate palette items from workflow store (saved flows, last edited) plus "Create new"; wire selection to open builder or run flow. (Req §1.2)
- [ ] Add keyboard navigation + focus retention in chat editor to mirror mention UX. (Req §1.1, §8.1)

2. Builder Shell & Theming
- [ ] Create builder pane component usable as modal or sidebar panel; set `data-context` to drive theme resolution. (Req §2.2, §8.1)
- [ ] Apply `v-theme` to toolbar buttons, menus, and inspector controls; verify light/dark switching. (Req §2.4, §8.3)
- [ ] Add minimal palette (Start, LLM, Merge) with context menu actions (duplicate, delete) and edge cycle prevention. (Req §2.1–§2.3)

3. VueFlow Canvas & Inspector
- [ ] Render Start node as read-only input holder (chat text + attachments). (Req §2.1)
- [ ] Build LLM node inspector sections: title/description, model selector with favorites + manual entry, tool allowlist sourced from registry, prompt template, parallel group key. (Req §2.2–§4.3)
- [ ] Build Merge node inspector: inbound edge list, merge strategy preview, target model selection. (Req §5.2)
- [ ] Show validation warnings for missing model, empty tool allowlist, disabled/unregistered tools. (Req §3.3, §6.1)

4. Tool Allowlist Integration
- [ ] Fetch tools via `useToolRegistry` and display enabled/disabled state; allow multi-select to persist tool IDs per node. (Req §3.1–§3.2)
- [ ] On execution, filter `getEnabledDefinitions()` by node allowlist; warn when filtered set is empty. (Req §3.2–§3.3)
- [ ] Handle missing tools gracefully by persisting IDs but skipping disabled/unregistered ones with inline alerts. (Req §3.3)

5. Model Selection per Node
- [ ] Create model selector component that searches available models and allows manual entry with validation. (Req §4.1)
- [ ] Persist model choice per node; default to a safe model when unset and block run if still missing. (Req §4.2, §6.1)
- [ ] Surface favorite models as quick chips (read from existing preferences store). (Req §4.3)

6. Graph Persistence & Storage
- [ ] Define Dexie stores for `workflows` and `workflow_runs` keyed by workspace/user; include schema versioning for future server sync. (Req §7.1)
- [ ] Implement save/load/export/import functions for flows; guard against corrupt JSON imports. (Req §7.2)
- [ ] Keep storage provider behind an interface so a server-backed store can be swapped in later. (Req §7.3)

7. Execution Planner & Runner
- [ ] Build graph validator (single Start, acyclic, connected merges) and planner that groups parallel siblings by `parallelKey`. (Req §6.1–§6.2)
- [ ] Implement runner that dispatches OpenRouter calls per node with filtered tools and selected model; construct messages from Start + upstream outputs. (Req §6.3)
- [ ] Add concurrency cap + basic retry/backoff for 429/5xx; wait for all members of a parallel group before proceeding. (Req §5.1–§5.3, §6.2)
- [ ] Emit hook actions for node/run lifecycle for telemetry/plugins. (Req §6.4, §9.2)

8. UI Feedback & Error Handling
- [ ] Show per-node status badges (pending/running/success/error) with durations; stream updates during execution. (Req §10.1)
- [ ] Block downstream execution when a node fails; enable rerun from failed node/subtree. (Req §10.2)
- [ ] Record `workflow_runs` with per-node metadata (duration, tools, model, errors) for later inspection. (Req §10.3)

9. Plugin/Builder Registry
- [ ] Create registry mapping builder IDs to `{ render, execute }`; default `vueflow` entry used by slash command. (Req §9.1)
- [ ] Expose registration API for plugins to add alternative builders (e.g., n8n) and choose default; persist preference locally. (Req §9.1)
- [ ] Ensure hook bus disposers are used for all subscriptions to remain HMR-safe. (Req §9.2)

10. Testing & QA
- [ ] Unit tests for graph validation, planner grouping, tool allowlist filtering, model selector validation, and execution adapter configuration. (Req §3._, §4._, §5._, §6._)
- [ ] Integration tests simulating `/workflow` command launch, builder save/load, and a sample parallel flow run with mocked OpenRouter responses. (Req §1._, §5._, §6._)
- [ ] Visual regression/UX checks for theming contexts (chat vs sidebar) and keyboard navigation in slash palette + builder. (Req §8._)

