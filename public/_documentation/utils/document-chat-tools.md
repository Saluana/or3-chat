# Document tools in chat

Chat includes the document editor's six native tools: `get_document_outline`, `list_document_chunks`, `read_blocks`, `search_document`, `propose_edits`, and `get_proposal_status`. The chat registry advertises them as client tools. They use the same definitions, frozen TipTap block references, operation parser, scope checks, and proposal review UI as Document AI.

Two discovery tools are also available:

- `search_documents` searches the existing command palette document index in the active workspace. It returns document IDs and any open tab IDs without loading and converting every document for each query.
- `get_open_pane_context` lists open tabs when called without a `tabId`. With a `tabId`, it returns bounded context from that tab. A visible document editor supplies live content, cursor/selection context, and block refs. An inactive document or chat supplies saved, read-only content. An app tab supplies metadata.

All eight tools start enabled in Chat settings. A saved user choice to disable a tool still takes precedence. Document AI's own tool toggles remain independent. Models known not to support tool calls do not receive these tools. Enabled client tools make the chat use foreground streaming for that turn.

Every document tool call requires a `documentId`; use `tabId` when the same document is visible in multiple panes. `read_blocks` and `propose_edits` also require the `snapshotId` returned by document outline, search, or open-pane context. To stage an edit, the document must be open in a visible editor pane. Chat's `propose_edits` produces a reviewable proposal in that editor; only the user's accept action writes it. The editor rejects stale snapshot IDs, edits to a changed document, a missing editor, a different workspace, or a second proposal while one is awaiting review. A chat turn keeps one frozen document snapshot and block reference set across its tool calls. Read-only tools can refresh that snapshot after the document changes. Accepting or discarding a chat edit retires that chat turn's edit authority; a follow-up turn can start a new proposal.

Open-tab context is read-only evidence. Content from another tab never grants edit authority over that tab. Deleted chat messages are omitted before the most recent 30 messages are selected. Results are bounded, and app tabs expose metadata only.
