# Workflow editor

The workflow editor is a node canvas for building and testing saved workflows.

## Toolbar

The toolbar follows the document editor's sizing and responsive contract: shared theme tokens, 40px desktop controls, a 900px compact breakpoint, a scrollable primary rail, and pinned workflow actions. The workflow name and save state appear when the pane is wide enough; narrow panes keep controls contained so they never overlap an adjacent pane.

- **Pan / Select** switches between dragging the canvas and marquee-selecting nodes. In Pan mode, hold Shift while dragging to marquee-select. In Select mode, switch back to Pan or hold Space while dragging to move the canvas.
- **Delete** removes selected nodes or connections and is disabled when nothing deletable is selected. The Start trigger cannot be deleted.
- **Validation** updates automatically. Select its status to open the issue list; **Open node** selects the affected node and opens its inspector.
- **Run** saves the workflow, opens a new chat, and prefills the workflow slash command without sending it. Add the workflow input in the composer and send when ready. Validation errors disable Run; warnings do not.
- **More** contains export and whole-canvas clearing actions.

## Running in chat

The workflow card in chat updates as nodes start, call tools, and produce
visible output. Long-reasoning models show **Thinking…** until they begin
streaming their response; OR3 does not expose private model reasoning. Expand
the active node to follow its live draft, or its tool activity when it uses
tools.

When background streaming is enabled, leaving the chat or refreshing the page
does not stop a workflow. The chat reconnects to its background job and restores
the latest persisted workflow state. The timeout is an inactivity safeguard:
model output, thinking progress, node changes, and tool updates keep the job
alive; a workflow is only stopped after it has been silent for the configured
timeout.

If a run stops or fails, its card changes to a terminal state instead of
continuing to spin. Use **Resume from last checkpoint** on the card to retry
the failed or pending node while retaining outputs from completed nodes. This
also preserves a pending parallel wave, so a resumed join continues with the
same inputs rather than starting the workflow over. Completed checkpoint
history remains on the card, and the resumed node appears as soon as it starts,
even before it produces text. If the saved checkpoint no
longer matches an edited workflow, OR3 discards removed node IDs, keeps outputs
for matching completed nodes, and resumes from the first unfinished node in the
current graph. When no checkpoint nodes still exist, it restarts after Start.
Provider failures preserve OpenRouter's upstream error details when available,
so a rejected retry identifies the provider reason instead of reporting only a
generic failure.

## Workflow browser

The Workflows sidebar groups saved workflows by update date using the same row, timestamp, selection, and overflow-action patterns as Home. Each row shows the workflow name and a short description so its purpose is visible before opening it.

Use **New workflow** to provide a name and optional description. Open a workflow's overflow menu and select **Edit details** to change either value. Descriptions are stored in the workflow's existing `meta.description` field, included in imports and exports, and require no data migration.

## Canvas interaction

Nodes are selected with a click and moved by dragging. In Pan mode, drag empty canvas space to pan or Shift-drag to marquee-select. In Select mode, drag empty space to marquee-select. Scroll or pinch to zoom.

Connection handles expose their purpose with accessible labels. Drag an output handle onto empty canvas to choose and automatically connect a compatible common node. Double-click empty canvas to open the same quick-add menu without creating a connection. Edges use arrowheads to show execution direction.

Validation issues appear directly on affected nodes. Activating the issue indicator opens that node in the inspector.

## Agent context and prompt caching

Agent nodes receive only the data connected to their inbound edges. Outputs
from earlier or unrelated agents are not replayed as one long assistant chat;
connect every outline, draft, research dossier, or review that a later node
needs. This keeps branches isolated and avoids duplicating the same output in
both system and assistant messages. A workflow run also does not automatically
inherit the surrounding chat thread: pass required context through the graph
instead.

Keep reusable role and policy instructions in the agent's system prompt. Put a
node-specific action in its task field, which is appended after inbound data so
the stable prefix remains cacheable. Each workflow run and retry reuse one
OpenRouter `session_id` and `prompt_cache_key` for sticky provider and cache
routing. Long workflow session IDs are deterministically reduced to OpenAI's
64-character `prompt_cache_key` limit while the full OpenRouter session ID is
preserved.
Provider-reported cache reads and writes are exposed as `cachedTokens` and
`cacheWriteTokens` in model-call usage.

OR3 sends no agent output-token cap by default. If a particular step needs a
budget, set **Maximum output tokens** in that agent's **Advanced** inspector
section; leaving it blank uses the provider's model limit.

## Local package development

When a sibling `or3-workflows` checkout exists, `nuxt.config.ts` aliases `or3-workflow-core`, `or3-workflow-vue`, and the workflow stylesheet to package source. Nuxt therefore hot-reloads workflow component and style changes without publishing or rebuilding the registry package. Installed package versions remain the fallback for generated projects and deployments without the sibling checkout.
