# Built-in chat tools

OR3 Chat registers built-in tools for finding and reading workspace chats and
documents. These are host features; installable plugins use the permissioned
tool methods in the [Plugin SDK](/documentation/plugins/plugin-sdk), not these
private `~/utils/**` modules.

The tools are client-side. Their handlers capture the originating workspace
and thread, then reject calls if that context no longer matches the active
workspace. A workspace switch cannot redirect an in-flight search or write to
the newly focused database. Saved Chat settings can disable any tool.

## Conversation tools

| Tool | Behavior |
| --- | --- |
| `search_threads` | Searches the existing workspace chat index by title or message text. Returns up to 10 matches and excludes the current chat. |
| `read_thread` | Reads up to 40 recent, non-deleted user/assistant messages from canonical branch history, including inherited reference messages and excluding superseded retries. Each message is capped at 4,000 characters and the transcript at 18,000; system, tool, and deleted messages are omitted. The result is read-only. |
| `send_message_to_thread` | Appends a message to another existing thread in the active workspace. It records a user turn by default, or an assistant note when `role: "assistant"` is supplied. It does not start a model reply and cannot target the current chat. |
| `delegate_chat` | Creates another chat or continues a specified chat, sends a task to the chosen model, and waits for its reply. The originating chat receives the completed response and can summarize it. |

The write rechecks the originating database immediately before saving and
refuses a missing or deleted target thread.

Ask for a model by its catalog name or ID and, optionally, a supported reasoning
effort. Without a model, the originating request's model and reasoning are
inherited. Unavailable, ambiguous, or unsupported choices are reported rather
than silently changed. A routing variant (`off`, `online`, `nitro`, or `floor`)
can be supplied explicitly, or as a suffix on the model ID. The explicit variant
overrides the suffix. Up to four independent new chats can be submitted together
in `tasks`; they run concurrently and return results in task order. For work
that depends on an earlier answer, wait for that answer before delegating the
next task. Each task in a batch can choose its own model, variant, and reasoning
effort. A new child chat belongs to the originating project;
project chats can continue only chats in the same project. A busy target is
refused. The delegated request uses normal chat permissions and tools, except
that it cannot delegate again.

The chat icon and elapsed time show the model's activity. Select the line to
open the child in another pane, where its conversation remains available after
completion. Stopping the parent stops the delegated request. Keep the
originating browser open while it waits; if execution is interrupted, inspect
the saved child before explicitly retrying. A result longer than 18,000
characters is labeled as truncated in the tool response.

## Document and open-tab tools

Chat also registers three workspace tools: `search_documents`,
`get_open_pane_context`, and `duplicate_document`. New documents come from
the single `workspace_create_document` tool, so one "Create documents" switch
controls document creation.

- `search_documents` uses the existing document index and returns document
  IDs plus matching open tab IDs.
- `get_open_pane_context` lists open tabs when called without a real `tabId`.
  Pass an ID from that list to read a tab. An unknown ID returns the list again.
  New chats without a thread are still open tabs; app tabs expose metadata.
- A visible document editor returns live editor context, including block
  references. An inactive document or chat returns bounded saved content and
  is read-only. Other chat messages are limited to the latest 30 non-deleted
  rows before per-message truncation.
- `duplicate_document` saves the active source editor
  first when necessary, then copies content and formatting under a new ID. A
  deleted/missing source is refused; use `tabId` when the same document is open
  in multiple panes.

The six document editor tools are shared with Document AI:
`get_document_outline`, `list_document_chunks`, `read_blocks`,
`search_document`, `propose_edits`, and `get_proposal_status`. The editor tools
and `duplicate_document` need a `documentId`; use `tabId` to identify an editor
when multiple panes show the same document. `read_blocks` and `propose_edits`
also require the `snapshotId` returned by an outline, search, or open-pane
context call.

`propose_edits` stages a proposal in a visible editor. Only the user's accept
action applies it. The editor refuses stale snapshots, a changed document, a
missing editor, or a workspace change. Reading another tab does not grant
permission to edit it; accepting or discarding a proposal retires that chat
turn's edit authority.

## Workspace assistant tools

Normal chat also offers these workspace tools:

| Tool | Behavior |
| --- | --- |
| `workspace_search` | Finds visible chats, native documents, projects, and saved-file names/indexed text. Returns source IDs, excerpts, and index coverage; an optional project filter limits results to its current visible members. File results distinguish complete text, a prefix, and filename-only coverage. |
| `workspace_read` | Reads an identified source in bounded pages. Continuations belong to that source and revision. Document reads provide a `readId` and block references for proposing changes. |
| `workspace_create_document` | Saves requested output as a native document from validated TipTap JSON. Its receipt appears after storage commits; repeating the same execution returns the same document. An optional project association is committed with the document. |
| `workspace_update_project` | Creates a project or changes its name, description, or chat/document/file associations. Updates require the project's current read revision. Removing an association preserves the underlying item and unknown extension memberships. Repeating a create execution returns its saved receipt. |
| `workspace_propose_document_edit` | Stages edits using block references from the same execution's document read. The chat review card offers Apply or Discard. Apply saves content, a checkpoint, and its receipt atomically; Undo refuses to overwrite a later edit. |

Source content is reference material and does not authorize actions. Reads and
writes check the originating workspace and current permissions. Changed sources
must be read again, and conflicting editor drafts prevent a proposal from silently
overwriting them. Saved files use catalog identities, never model-supplied URLs.
In project chats, file pages read the binding's current ready/partial extraction
blob and bind continuations to that extraction revision. Replacing extraction
invalidates old cursors. Pages use extracted-text lengths, never PDF/DOCX upload
offsets. Partial extraction remains labeled partial even at its last readable
page. Outside that binding, binary files expose only their indexed text prefix;
plain-text files can page their original UTF-8 bytes. Missing extraction bytes
require reconnecting instead of silently falling back to the binary upload.
When a pending proposal becomes stale, **Update proposal** adds the current
document reference and a fresh-read request to the originating chat draft.
It preserves your draft and waits for you to send it. If a later edit makes
Undo unavailable, **View history** opens the retained history without applying
a revision over the later content.
Supported UTF-8 files have bounded text pages and explicit continuations;
filename-only formats return their content limitation. See
[saved Files](/documentation/utils/file-handling#saved-files).

The Files navigation and catalog upload UI currently run in local mode. Cloud
exposure remains gated until provider preservation and lifecycle qualification
is complete. The new provider contracts require matching backend updates;
installing the host alone does not qualify cloud support.

## Availability and execution

All built-ins start enabled, while a saved user choice to disable one takes
precedence. Document AI has its own independent tool toggles. Models known not
to support tool calls do not receive these definitions. If other background
eligibility checks pass, background execution can use the browser-tool bridge
for client tools; when the bridge is unavailable, that turn stays in foreground
streaming. See the [background execution guide](/documentation/cloud/background-execution)
for the full eligibility rules.

Definitions and handlers live in `app/utils/chat/thread-chat-tools.ts` and
`app/utils/documents/document-chat-tools.ts`. The editor's proposal contract
and snapshot behavior are described in [Documents](/documentation/database/documents).

## Large completed results

Accepted tool results retain their full output up to the existing 256 KiB raw
result limit. Results above 16 KiB of JSON-escaped text are stored in immutable
workspace KV chunks, with a bounded reference in the tool transcript. Expanding
the tool activity exposes **Download full result**. The download checks the
originating workspace/account and verifies all chunks against SHA-256; missing
sync pages or corrupt bytes produce a visible error rather than a partial file.
Reloaded model history resolves the same reference before the normal model
projection and context-budget check. The model projection may still omit output
above its own limit; that does not remove the retained full result.
