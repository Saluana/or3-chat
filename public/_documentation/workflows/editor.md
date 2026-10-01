# Build and run a workflow

Use this guide to create a workflow, run it from chat, and understand the
editor controls. The node canvas and chat integration are supplied by the
separately installed `or3-plugin-workflows` package. When that package is
disabled, its Workflows navigation and editor controls are absent. Existing
`workflow-entry` posts and execution messages stay in the workspace. Saved
execution messages show a read-only status and output summary until the package
is enabled again, when the full workflow card returns.

## Create your first workflow

For an AI-backed run, connect OpenRouter and make sure your account can use the
selected model. The workflow package must be enabled, with workflow editing and
execution allowed in the feature settings.

1. Open **Workflows** in the sidebar, select **New workflow**, enter a name,
   then select **Create**. The editor opens with a **Start** node.
2. Select **Node Palette**, then choose **AI Agent** to add it to the canvas.
   You can also drag the palette item onto the canvas.
3. Connect the **Start** output handle to the **AI Agent** input handle by
   dragging between them.
4. Select the agent and open **Node Inspector**. Enter stable role or policy
   instructions for the agent. For example: “You are a concise summarizer.
   Return exactly three bullets and preserve dates and action items.” Keep the
   default model or choose another available model in the **Model** tab. The
   instructions describe the agent's behavior; the request for each run comes
   from the chat message.
5. Check the validation status in the editor toolbar. Open it to review issues;
   choose **Open node** to go to the node that needs attention. Fix validation
   errors before running. Warnings do not block a run.
6. Select **Run**. OR3 opens a new chat and prefills the workflow command; it
   does not send it yet. Add a request after the command, such as “Summarize
   these release notes for a project manager: …”, then send the message. That
   request becomes the workflow input.

The workflow run appears as a card in chat. Expand the Agent node to follow its
live output; its result should be a concise summary of the text you supplied.
After the run, select the workflow from **Workflows** again to edit and reuse
it.

## Toolbar

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

The chat **Stop** control cancels its active run. If the page reloads during
a foreground run, the saved card becomes interrupted and can be resumed from
its last checkpoint. Workflow feature settings control whether the package,
slash commands, and execution are available.

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

### Generated images

Workflows that use a catalog model with image output stay on the foreground
execution path so the generated image is stored as a local file attachment on
the workflow message. The attachment appears when the result arrives and is
restored after a reload. Text-only workflows can still use background
execution when it is enabled; workflows with an unknown or missing model
reference stay in the foreground until their output capability is known.

## Workflow browser

The Workflows sidebar groups saved workflows by update date using the same row, timestamp, selection, and overflow-action patterns as Home. Each row shows the workflow name and a short description so its purpose is visible before opening it.

Use **New workflow** to provide a name and optional description. Open a workflow's overflow menu and select **Edit details** to change either value. Descriptions are stored in the workflow's existing `meta.description` field and included in imports and exports.

## Canvas interaction

Nodes are selected with a click and moved by dragging. In Pan mode, drag empty canvas space to pan or Shift-drag to marquee-select. In Select mode, drag empty space to marquee-select. Scroll or pinch to zoom.

Connection handles expose their purpose with accessible labels. Drag an output handle onto empty canvas to choose and automatically connect a compatible common node. Double-click empty canvas to open the same quick-add menu without creating a connection. Edges use arrowheads to show execution direction.

Validation issues appear directly on affected nodes. Activating the issue indicator opens that node in the inspector.

## Agent tool selection

An explicit empty tool selection disables tools for that agent. Selecting tools sends only those tools; older programmatic nodes that omit the `tools` field retain inherited global tools. Image-only models should have no tools selected and use the native backend. The optional Responses backend requires a host-provided adapter; selecting it does not install or configure that adapter.

## Agent context and prompt caching

Agent nodes receive only the data connected to their inbound edges. Outputs
from earlier or unrelated agents are not replayed as one long assistant chat;
connect every outline, draft, research dossier, or review that a later node
needs. This keeps branches isolated and avoids duplicating the same output in
both system and assistant messages. A workflow run also does not automatically
inherit the surrounding chat thread: pass required context through the graph
instead.

Keep reusable role and policy instructions in the agent's system prompt. Put a
run-specific request in the chat message after the workflow command. The Agent
inspector's **Instructions** field defines the system prompt; connected
upstream outputs provide graph context. Keeping reusable instructions stable
helps preserve the cacheable prompt prefix. Each workflow run and retry reuse one
OpenRouter `session_id` and `prompt_cache_key` for sticky provider and cache
routing. Long workflow session IDs are deterministically reduced to OpenAI's
64-character `prompt_cache_key` limit while the full OpenRouter session ID is
preserved.
Provider-reported cache reads and writes are exposed as `cachedTokens` and
`cacheWriteTokens` in model-call usage.

## Local package development

Work on the sibling `or3-plugin-workflows` checkout as a separate plugin.
Build and pack it with `or3-plugin`, then use the admin package flow to review,
canary, promote, and enable the exact archive. The workflow engine, Vue Flow
editor, and styles are dependencies of that package; the host app does not
alias or require them.
