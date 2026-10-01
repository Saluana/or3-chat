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
| `read_thread` | Reads up to 40 recent, non-deleted user/assistant messages. Each message is capped at 4,000 characters and the transcript at 18,000; system, tool, and deleted messages are omitted. The result is read-only. |
| `send_message_to_thread` | Appends a message to another existing thread in the active workspace. It records a user turn by default, or an assistant note when `role: "assistant"` is supplied. It does not start a model reply and cannot target the current chat. |

The write rechecks the originating database immediately before saving and
refuses a missing or deleted target thread.

## Document and open-tab tools

Chat also registers four workspace tools: `search_documents`,
`get_open_pane_context`, `create_document`, and `duplicate_document`.

- `search_documents` uses the existing document index and returns document
  IDs plus matching open tab IDs.
- `get_open_pane_context` lists open tabs when called without a real `tabId`.
  Pass an ID from that list to read a tab. An unknown ID returns the list again.
  New chats without a thread are still open tabs; app tabs expose metadata.
- A visible document editor returns live editor context, including block
  references. An inactive document or chat returns bounded saved content and
  is read-only. Other chat messages are limited to the latest 30 non-deleted
  rows before per-message truncation.
- `create_document` saves a new document from an optional title and optional
  Markdown text without opening it; the host supplies a default title when
  omitted. `duplicate_document` saves the active source editor
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
