# Requirements

## Introduction

Let users ask the existing OR3 chat to find and work with their workspace's conversations, documents, projects, and saved files. Add a familiar Files view so material has a permanent, browsable home and can be reused without repeated uploads. Prioritize a small, polished interaction loop: ask, see the relevant sources, review an existing-document change, and continue working.

This is an implementation plan, not an implementation. Creating these planning documents does not authorize source changes, test execution, dependency installation, or deployment.

## Context

The inspected working tree is `or3-chat`, branch `or3-marketplace`, base commit `e347530d`, with unrelated work in progress. OR3 uses Bun, Nuxt/Vue, Nuxt UI and theme tokens, Dexie per workspace, Orama search, TipTap documents, and provider-backed optional sync/storage. Its command palette already searches document and chat contents; the chat registry supports context-bound client tools; Document AI already validates edit operations, presents changes, and records revisions. Binary files already live in hash-addressed `file_meta`/`file_blobs` storage with a transfer queue. Chat's upload validator still accepts only images/PDFs, project entries currently support only chats/documents, and file deletion affects shared bytes. Extend these owners rather than introduce another agent engine, database, file store, or search service.

## Assumptions

- Keep normal chat, history, manual editing, and model selection. Workspace assistance enhances the current product; it does not replace it with a new mode.
- The existing workspace is the access boundary. Use its current role/membership rules; this feature does not invent private files or per-item permissions inside shared workspaces.
- A new Files pane lists native documents and saved uploads together. Existing document views remain usable; the first release does not redesign the entire sidebar.
- Projects are the only grouping mechanism. An item can be associated with existing projects; the UI says **Add to project** and **Remove from project**, not **Move**, because these are associations rather than exclusive folders.
- Workspace search/read tools are available in normal chats when workspace tools and the selected model's tool support are enabled. Existing disablement must be respected. No automatic model switch or additional model call is needed for indexing.
- Creating a requested document and making requested project changes can save directly with a receipt. Editing an existing document presents one reviewable proposal with **Apply changes**; it does not prompt for each operation.
- First-release uploaded-text support is UTF-8 `.txt`, `.md`, and `.csv`, subject to existing upload policy. PDF/image previews and explicit attachment to a compatible model reuse current functionality. Other allowed formats can be stored and downloaded; they are not represented as content-searchable or editable.
- Saved uploads have one catalog entry per content hash in a workspace. Re-uploading identical bytes reuses that entry without silently renaming it. Different bytes with the same filename remain separate entries.
- New regular chat uploads are saved in Files. Existing attachments remain intact; an explicit **Add existing uploads** action can add them through the same catalog operation. No silent bulk conversion is required.
- All tools in the first release execute in the browser against a captured workspace database. Cloud background turns use the existing client-tool bridge and require an available browser; offline AI inference and unattended server-side document editing are not promised.
- Cloud retains OR3's existing per-record last-write-wins synchronization. Revision checks protect changes already observed by the local database; this feature does not add distributed transactions or promise conflict-free simultaneous offline editing across devices.
- Performance targets below are acceptance targets, not measurements already obtained. Record a baseline before implementation and compare on the same host.

## Out of Scope

- Desktop filesystem synchronization, nested folders, public sharing links, external Drive/Dropbox connectors, and new item-level ACLs.
- Vector databases, embeddings, automatic memory summaries, knowledge graphs, semantic routing services, or a separate RAG deployment.
- OCR, Office/PDF text conversion, spreadsheet computation, audio/video transcription, and editing arbitrary uploaded binary formats.
- Agent swarms, workflow builders, a new approval framework, or a second document editor.
- Automatic file replacement/version chains, automatic trash purging, and AI tools for permanent deletion or external sharing.
- A new telemetry service, new runtime dependency by default, or release/deployment work as part of this planning task.

## Requirements

### R1: Ordinary chat remains the entry point

**User Story:** As a user, I want to ask for work in the chat I already use, so that I do not have to learn another interface.

**Acceptance Criteria:**
- R1.AC1: WHEN a user asks about workspace material THEN chat SHALL be able to use enabled workspace tools without requiring a new agent, project, preset, or conversation.
- R1.AC2: WHEN a tool runs THEN chat SHALL show a concise activity label and a final source/action receipt without moving focus or opening another pane automatically.
- R1.AC3: IF workspace tools are disabled or the model cannot call tools THEN the UI SHALL explain the limitation and retain manual search, mentions, and document editing without switching models automatically.
- R1.AC4: WHEN the user refers ambiguously to multiple items as an edit target THEN the assistant SHALL ask which item they mean before preparing a change; a filename alone SHALL NOT authorize a write to a guessed item.

### R2: Useful, bounded workspace search

**User Story:** As a user, I want to find previous work by describing it, so that I do not have to remember a chat title.

**Acceptance Criteria:**
- R2.AC1: WHEN search runs THEN it SHALL search permitted, visible chats, native documents, projects, and saved-file names/indexed text using the existing full-text engine and substring fallback.
- R2.AC2: WHEN returning matches THEN the tool SHALL return at most 20 items, with type, ID, title, excerpt, and a host-resolvable source reference; it SHALL NOT return whole transcripts as search results.
- R2.AC3: IF the request specifies a project THEN filtering SHALL occur before the result limit; missing matches SHALL NOT silently cause expansion to another project or workspace.
- R2.AC4: IF a source is unavailable, indexing is incomplete, or a file has only partial text indexed THEN the result and UI SHALL disclose that coverage instead of claiming an exhaustive search.
- R2.AC5: WHEN an item changes or enters Trash THEN subsequent searches SHALL reconcile through existing local/sync lifecycle events and SHALL revalidate matched records before exposing them to the model.

### R3: Read only identified, accessible material

**User Story:** As a user, I want answers grounded in my actual material, so that I can inspect what the assistant used.

**Acceptance Criteria:**
- R3.AC1: WHEN a read runs THEN it SHALL resolve an explicit item ID in the captured workspace, check access and visibility, and return a bounded excerpt with revision information and a continuation position when needed.
- R3.AC2: WHEN chat history is read THEN visible messages SHALL use existing branch context and ordering rules; tool payloads, internal reasoning, superseded retries, and internal/plugin-private records SHALL NOT become ordinary searchable conversation text.
- R3.AC3: WHEN sources are displayed THEN links SHALL be built from validated tool receipts and open the existing chat, editor, project, or file preview. A missing source SHALL show an unavailable state rather than open a guessed item.
- R3.AC4: IF a workspace, subject, permission, cancellation state, or target revision changes during a request THEN the request SHALL stop or return a scoped error; it SHALL NOT redirect itself to the newly active workspace.
- R3.AC5: WHEN source content is returned to a model THEN it SHALL be treated as evidence, not as authority to run more privileged actions; only normal tool permissions and the user's request SHALL authorize changes.

### R4: Create a useful native document

**User Story:** As a user, I want to save requested output as a document, so that it remains editable and easy to find.

**Acceptance Criteria:**
- R4.AC1: WHEN document creation succeeds THEN a validated native TipTap document SHALL be durably saved and returned as an **Open document** receipt, with the requested project association if supplied.
- R4.AC2: IF content validation, storage, or authorization fails THEN chat SHALL report failure and SHALL NOT claim that an empty or partial document is the completed result.
- R4.AC3: IF the same tool execution is retried THEN it SHALL resolve to the same document rather than create duplicates; a deliberate new user request SHALL remain a distinct operation.

### R5: Review and apply existing-document edits

**User Story:** As a user, I want to inspect a proposed change and recover from mistakes, so that AI editing feels predictable.

**Acceptance Criteria:**
- R5.AC1: WHEN chat proposes an edit THEN it SHALL use the existing document operation validation and diff/hunk presentation, identify one document and base revision, and show **Review**, **Apply changes**, and **Discard** without saving the proposed content first.
- R5.AC2: WHEN Apply changes succeeds THEN the existing document history SHALL contain a pre-change checkpoint, the document SHALL be durably saved, and the receipt SHALL change from proposed to applied only after success.
- R5.AC3: IF live editor content or stored content changed after the proposal's read THEN Apply SHALL refuse to overwrite it and offer **Update proposal** from the latest content.
- R5.AC4: WHEN Undo is used THEN it SHALL restore the exact preceding revision only if the applied result is still current; otherwise it SHALL open history instead of overwriting later work.
- R5.AC5: IF a proposal is reloaded, clicked twice, interrupted, or replayed against the same local workspace database THEN its status SHALL remain accurate and its write SHALL occur at most once for that execution; cross-device outcomes SHALL retain the existing sync conflict semantics.

### R6: Simple project organization

**User Story:** As a user, I want related material together, so that both browsing and chat can use the same organization.

**Acceptance Criteria:**
- R6.AC1: WHEN a user requests project creation, renaming, description editing, or adding/removing identified items THEN the tool SHALL perform the requested operation through the existing project persistence path and return a concrete receipt.
- R6.AC2: WHEN files are added to a project THEN the same project list SHALL support chats, documents, and file entries without a second folder structure or copied content.
- R6.AC3: IF a target is absent, trashed, inaccessible, or its revision in the captured database differs from the read revision THEN the operation SHALL return a recoverable error rather than overwrite observed project changes.
- R6.AC4: WHEN an item is removed from a project THEN the underlying chat, document, or file SHALL remain available elsewhere in the workspace.

### R7: A permanent file catalog

**User Story:** As a user, I want to upload once and reuse a file, so that useful material survives an individual conversation.

**Acceptance Criteria:**
- R7.AC1: WHEN an upload is accepted THEN its catalog entry and existing blob metadata SHALL be durably saved before the UI reports local success; cloud transfer status SHALL be shown separately.
- R7.AC2: WHEN a saved file's originating conversation is deleted THEN the file SHALL remain browsable and downloadable through Files.
- R7.AC3: WHEN identical content is uploaded again THEN the system SHALL reuse stored bytes and the existing catalog entry, retain its current name, and report that the file already exists; re-uploading a trashed entry SHALL explicitly report its restoration.
- R7.AC4: WHEN a batch contains failures THEN successful items SHALL remain usable and each failed item SHALL expose its own Retry action without repeating the successful uploads.
- R7.AC5: WHEN Add existing uploads is requested THEN catalog creation SHALL be bounded and idempotent, reuse existing hashes, preserve existing catalog names/Trash state, and report partial progress without downloading or duplicating blobs.

### R8: Honest file capabilities

**User Story:** As a user, I want to know what OR3 can use from a file, so that storage support is not confused with AI understanding.

**Acceptance Criteria:**
- R8.AC1: WHEN a new supported UTF-8 text file is uploaded or a user enables text search for an existing upload THEN up to 64 KiB of plain text SHALL be stored as its searchable excerpt; the entry SHALL distinguish complete text, a prefix, and unavailable text. Metadata-only imports SHALL remain filename-searchable until that explicit action succeeds.
- R8.AC2: WHEN more supported text is needed THEN a bounded read SHALL use the existing blob retrieval path and explicit continuation; search SHALL NOT claim to index the unindexed remainder.
- R8.AC3: WHEN an allowed unsupported or undecodable format is uploaded THEN it SHALL remain downloadable with an explicit content-search limitation; parsing failure SHALL NOT turn a successful file save into a missing file.
- R8.AC4: WHEN a user chooses Ask in chat for a supported image/PDF THEN OR3 SHALL reuse the existing compatible-model attachment path; it SHALL NOT invent searchable text or silently switch to a paid parsing service.
- R8.AC5: WHEN upload, preview, or download runs THEN current size/MIME policy SHALL remain enforced and active content SHALL remain inert; Files SHALL NOT embed uploaded HTML/SVG/scripts as trusted application content.

### R9: Trash and shared-file safety

**User Story:** As a user, I want to remove clutter and recover mistakes without breaking other work.

**Acceptance Criteria:**
- R9.AC1: WHEN a document or saved file enters Trash THEN normal Files, project, mention, and assistant search/read surfaces SHALL exclude it, and Restore SHALL recover the same item identity and associations.
- R9.AC2: WHILE a file entry or document is in Trash its references SHALL remain retained; moving a catalog entry to Trash SHALL NOT mark shared blob metadata unavailable or break existing attachments.
- R9.AC3: WHEN permanently removing an item from Files THEN the UI SHALL identify the item and explain that copies/references in other material remain; removing catalog ownership SHALL NOT directly delete shared bytes.
- R9.AC4: IF any retained message, document, revision, or file catalog entry references a blob THEN existing gallery/storage deletion paths SHALL refuse physical deletion. Unreferenced cleanup SHALL use the existing storage lifecycle and retention policy.
- R9.AC5: WHILE this feature is enabled it SHALL perform no automatic trash purge and expose no permanent-delete tool to the model.

### R10: Polished browsing and interaction

**User Story:** As a user, I want consistent, accessible controls, so that simple tasks stay simple on desktop and mobile.

**Acceptance Criteria:**
- R10.AC1: WHEN Files opens THEN it SHALL present one list, one search field, Upload, New document, and compact project/type filters; advanced actions SHALL live in the existing menu pattern.
- R10.AC2: WHEN a user opens, renames, downloads, adds to a project, trashes, or restores an item THEN the action SHALL be available without dragging, hovering, or remembering a shortcut.
- R10.AC3: WHEN using a keyboard THEN controls SHALL have visible focus, Enter SHALL activate the focused item, Escape SHALL close overlays and restore focus, and the existing global search shortcut SHALL remain usable.
- R10.AC4: WHEN rendered at 390 px and 320 px widths or 200% browser zoom THEN primary controls SHALL remain usable without horizontal page scrolling; mobile actions SHALL have at least 44 px hit targets.
- R10.AC5: WHEN content is empty, loading, unavailable offline, failed, read-only, or filtered to no matches THEN a specific message and relevant recovery action SHALL appear; a loading state SHALL NOT look like an empty library.
- R10.AC6: WHEN applying themes or reduced-motion preferences THEN Files, source receipts, and change review SHALL use existing tokens/components and honor those preferences.

### R11: Lightweight implementation and extensions

**User Story:** As an OR3 maintainer, I want a small implementation that extensions can build on without another framework.

**Acceptance Criteria:**
- R11.AC1: WHEN implementing this feature THEN it SHALL reuse existing tools, pane/sidebar, search-source, hooks, document, and storage mechanisms; it SHALL introduce no new service, database, agent loop, or runtime dependency by default.
- R11.AC2: WHEN opening ordinary chat THEN file previews, document schema/editing code, and file-content indexing SHALL remain lazy; no workspace-wide blob download or new startup model request SHALL occur.
- R11.AC3: WHEN measuring a warm search over 1,000 mixed metadata/text items with 10 MiB total indexed text THEN p95 completion SHALL be at most 300 ms on the recorded reference host; Files SHALL initially render at most 50 rows and use the existing pagination pattern.
- R11.AC4: WHEN a new extension needs a separate tool or search source THEN it SHALL use the existing registries. Private plugin records SHALL NOT automatically become assistant-readable through palette registration alone.
- R11.AC5: WHEN implementation is reviewed THEN each new persisted record, interface, dependency, hook, and index SHALL have a concrete first-release caller or requirement; speculative mechanisms SHALL be removed.

### R12: Workspace lifecycle and cloud correctness

**User Story:** As a user, I want local work and cloud work to obey the same boundaries and survive ordinary interruptions.

**Acceptance Criteria:**
- R12.AC1: WHEN workspace tools run THEN database, subject, workspace generation, permissions, and cancellation SHALL be captured by the host and checked after asynchronous boundaries; model arguments SHALL NOT select another workspace.
- R12.AC2: WHEN cloud sync is unavailable THEN local results SHALL remain visible with pending-sync status; another device SHALL only be represented as current once synchronization succeeds.
- R12.AC3: IF no browser can claim a client tool in a background turn THEN the existing bridge SHALL return its recoverable unavailable/expired state; the UI SHALL not imply that the workspace change occurred.
- R12.AC4: WHEN new catalog records, trash metadata, or file project entries cross sync boundaries THEN supported providers SHALL preserve them; incompatible clients SHALL be rejected through the existing capability-admission pattern before they can rewrite or discard them.
- R12.AC5: WHEN the user changes workspace or loses membership THEN pending results, proposals, previews, and object URLs SHALL be invalidated; operations already committed SHALL remain recorded in their original workspace only.

### R13: Evidence and documentation

**User Story:** As a maintainer, I want implementation evidence and current documentation, so that this feature can be shipped and extended confidently.

**Acceptance Criteria:**
- R13.AC1: BEFORE implementation of risky behavior THEN its failure cases and primary verification owner SHALL be recorded; tests SHALL follow the repository's E2E-first and test-audit authoring policies.
- R13.AC2: WHEN implementation is qualified THEN repeatable E2E artifacts SHALL demonstrate search/read, document create/review/apply/undo, project association, file retention/trash, mobile/keyboard use, and workspace-switch cancellation through production components.
- R13.AC3: WHEN implementation introduces public behavior or contracts THEN `public/_documentation/`, `docmap.json`, and affected provider READMEs SHALL describe capabilities, limitations, extension usage, and runtime behavior.
- R13.AC4: WHEN this planning task finishes THEN only these planning documents SHALL have been created; no application source or tests SHALL be changed and no tests SHALL have been run.
