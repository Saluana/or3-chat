# Projects

Project metadata stays in the `projects` Dexie table. Persistent workspace policy reuses versioned internal `posts`; see [Work in a project](/documentation/start/projects).

Client navigation uses `useProjectSidebar()` from `~/composables/sidebar/useProjectSidebar`. Call it during setup and use `openProjectSidebar(id, from)` to select the project and activate `sidebar-projects-home`. `from` defaults to `'home'`; use `'projects'` for a selection from the list. `openProjectsSidebar()` clears the selection and opens the full list, including when the page is already active. The returned `projectId` and `returnTo` are UI navigation state and never set a chat's owning project. The project selection resets on workspace changes. Project navigation does not register a pane application or open workspace tabs.

Project activity reuses `SidebarTimeGroupedList` with `type="all"`, `projectId`, and an explicit `query` string. Omitting `query` retains the normal inherited sidebar search. Its optional `header` slot places the project summary in the same virtual scroll container as the activity rows; loading and empty messages stay below that header. Project document filtering includes both document associations and live document sources from Knowledge. Standard selection, rename, delete, and add-to-project events retain their existing sidebar handlers.

Kept-alive activity views unsubscribe when hidden and refresh when activated.
Home's project query loads six live rows (five shortcuts and a Show more sentinel);
the complete catalog loads only for search or the project picker. Project activity
uses indexed owning chats and direct legacy/document membership lookups instead
of scanning unrelated workspace rows, including expanded conversation families.

Project family headers use an original chat's title and actions only when that original belongs to the selected project. The activity list forwards the family row's rename/delete target unchanged to the sidebar handlers. When only a branch belongs to the project, its header keeps the branch title and rename/delete target and does not offer navigation to the foreign original. Search and pinned filters do not change the title of a permitted family original.

---

## What does it do?

-   Validates incoming project objects with `ProjectSchema`.
-   Wraps persistence in `dbTry` for consistent error handling.
-   Emits hook actions/filters for create, upsert, delete, and read flows.

---

## Data shape

| Field                       | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `id`                        | Project ID (string).                               |
| `name`                      | Display name.                                      |
| `description`               | Optional string (nullable).                        |
| `data`                      | Arbitrary JSON payload scoped to project features. |
| `clock`                     | Revision counter.                                  |
| `deleted`                   | Soft delete flag updated via `softDeleteProject`.  |
| `created_at` / `updated_at` | Unix seconds timestamps.                           |

---

## API surface

| Function                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `createProject(input)`  | Filters + validates + writes a new project.       |
| `upsertProject(value)`  | Filters + validates + replaces the row.           |
| `softDeleteProject(id)` | Marks project deleted within a Dexie transaction. |
| `hardDeleteProject(id)` | Removes the project entirely.                     |
| `getProject(id)`        | Reads a project by id and applies output filters. |

---

## Hooks

-   `db.projects.create:filter:input` / `:action:(before|after)`
-   `db.projects.upsert:filter:input`
-   `db.projects.delete:action:(soft|hard):(before|after)`
-   `db.projects.get:filter:output`

---

## Usage tips

-   Store structured per-project state inside `data`; use hooks to enforce schema or migrate old versions.
-   Project deletion removes policy/bindings and detaches chats atomically while retaining the underlying work. Hard deletion also purges internal project records.

## Persistent workspace records

`or3:project-settings`, `or3:project-memory`, and `or3:project-source` are hidden from ordinary document/search surfaces. Their title is the project ID; `[postType+title]` selects the project records. The singleton settings ID is `project-settings-<id>`. Content is strict version-1 JSON, with a 128 KiB record bound. The existing `or3.workspace-item` metadata capability marker protects these records from older sync clients.

Response diagnostics are separate from that internal-post bound. Receipt text
previews share at most 32 KiB and also fit the 128 KiB diagnostic target after
accounting for JSON escaping, identity metadata and iteration history. Evidence
IDs/revisions are retained even when their identity-only manifest exceeds this
target; diagnostic size never rejects otherwise admissible inference.
`instructions_included` and `brief_included` retain inclusion when text previews
are omitted. Each iteration has `request_id` and `request_state` (prepared,
dispatched, accepted, failed). Acceptance means the transport returned a successful
response body; later stream failures change it to failed. Old iterations without
these fields have unknown dispatch state. Updates fence the current request and
message, so a replaced execution cannot overwrite its successor's diagnostics.

`readProjectWorkspace(db, id)` validates settings, memories, and bindings. Persisted rows are read with `readPersistedProjectRecord` (unknown keys from newer clients are dropped; other versions or damage read as null), so an unreadable memory or binding is skipped rather than failing the project; unreadable settings refuse with an "update OR3" message. Writes stay strict. `saveProjectSettings`, `saveProjectMemory`, and `saveProjectSource` accept a captured `WorkspaceOperationScope` and the record the editor read (`{ clock, content }`; a bare clock still works for immediate writes), so a same-clock revision replaced by sync is refused rather than overwritten. A save keeps stored top-level fields that this version does not know, so an older client never drops a newer client's fields; nested unknown fields are not kept. A save also refuses to overwrite a record in a format it cannot read. New persisted fields must be optional and safe to ignore; a change of meaning bumps `version`. Stale writes, revoked access, invalid source identity, and foreign memory provenance refuse. Source `file_hashes` retains every original/extraction revision using existing reference accounting.

`readProjectPolicy(db, id)` reads only the live project and singleton settings row.
Tool admission, approval rechecks and execution/delivery guards use it without
hydrating memories or unrelated members. Targeted reads still validate live
membership, knowledge mode and file availability.

Automatic relevant-file search decodes at most 8 MiB of extraction per turn,
prioritizing title matches. Sources beyond that budget remain unselected; required
Always include sources keep their complete-input admission contract. Retrieval
validates at most twelve candidate summaries for the normal three-result request,
with a separate 1,000-operation provenance budget including inherited scopes.
An incomplete validation rejects the candidate rather than accepting partial evidence.

`saveProjectNote(scope, projectId, { title, text })` prepares the normal document
hooks and commits the document, knowledge binding, membership and references
together. A refused binding leaves the note draft intact and saves no orphan.
Document/source notifications run after commit and cannot fail a durable save.

Processing revisions may carry `processing_started_at`. Each extraction retry
refreshes this timestamp and advances the source clock before starting its
worker; a superseded worker cannot commit over that attempt. After
`PROJECT_INTAKE_TIMEOUT_SECONDS` (45 seconds), workspace reads expose an
interrupted, retryable failure without changing the stored row. Read-only callers
see the same state; reads never write through a revoked scope. This prevents an indefinite
Processing label. The visible sidebar schedules one refresh at the nearest
deadline and cancels it when hidden.

Knowledge upload and revision controls are disabled while the page completes an
intake operation, including its catalog update. A Ready revision can be visible
before that update finishes; wait for the controls to become available before
starting another upload. Empty saved-memory drafts cannot be submitted.

Source saves and project deletion update reference counts with hook-free row
operations inside their atomic write. File-reference notifications run after
the outer commit, so asynchronous extension hooks cannot split ownership from
its source record. Rollbacks emit no reference notifications; notification
failure after a successful commit is reported without failing the save.

Model requests and workspace chat reads share the canonical thread projection.
Every reference ancestor and compacted-summary provenance thread must retain the
same nullable project owner as the requested chat. Project exclusions also apply
to inherited provenance. Inherited summary chains are checked recursively and
cyclic/missing provenance refuses. Display reads pass
`resolveThreadProjection(id, db, undefined, { projectProvenance: false })`, so a
chat's own transcript always renders even when sends refuse its provenance.
User moves keep a branch family together, so this refusal is reserved for data
moved outside those paths.
`resolveChatProject(db, id, { includeDeleted: true })` is reserved for retained
summary provenance: deleted thread tombstones still prove ownership. Default
calls continue to reject deleted chats; this option grants no mutation authority.

`resolveChatProject(db, threadId)` prefers `threads.project_id`, otherwise resolves a single legacy membership. A missing or deleted explicit owner resolves to no project (deletion releases chats, including a pointer that raced the delete). Ambiguous legacy ownership refuses sends and forks until the user chooses. The composer then shows a banner listing each project that lists the chat (`ambiguousChatProjects`, `useAmbiguousChatProjects`); keeping it in one calls `moveChatToProject`. `moveChatToProject(scope, threadId, projectId | null, { family = true })` updates the pointer and memberships atomically for the chat's whole branch family (`chatFamilyIds`: the root and every `parent_thread_id` descendant), retaining extension entries; legacy-membership migration passes `{ family: false }`. Joining a project takes the whole family. Leaving releases only the branches that project owned, so branches owned elsewhere or ambiguous keep their membership. The call resolves to how many other chats moved, which the UI reports as related chats. `createThreadInDb` accepts an optional `assertCurrent` guard for captured callers.

`moveChatProjectRows(scope, threadId, projectId, { family? })` is the hook-free write used by
atomic membership editors (forks move only the new chat). It requires a read/write transaction on the captured
database with projects/threads included, and returns changed `{ projects, threads }` rows.
Call `notifyChatProjectMove(changes)` only after the outer transaction commits.
Preparation hooks and notifications must not be awaited inside that transaction.
The ordinary `moveChatToProject` wrapper owns its transaction and notification.

`useProjectsCrud` captures write access for create, rename, new chat/document,
membership edits and entry-title synchronization. Rename applies a narrow name
change to a fresh row and rejects concurrent name edits while preserving unrelated
membership. New project documents and their association commit together; project
changes during association preparation refuse without saving an orphan. Member
edits prepare hooks before opening the transaction and emit notifications after
the entire batch commits. Entry-title synchronization reads and writes fresh rows
in the same transaction and advances their clocks.

Source writes reject a second active binding to the same item within one project,
including replacement collisions. An existing unavailable source can still be
switched to **Do not use** without changing its identity or history. Existing
explicit memories retain historical provenance when edited; new or changed
provenance must be available within the owning project. Saving a project brief
updates only the brief, independently of pending Settings edits.

The shared Project Context Builder captures ownership and project state before native admission. Normal sends select sources after outgoing prompt filters and final model readiness, using the captured state via the optional final `buildProjectContext` argument. Image inclusion uses the final model’s input modalities. Normal sends, initial recovery, and continuation carry the captured nullable owner through foreground and background dispatch; a change requires a fresh turn. Persisted receipts list selected source evidence and an `available_source_count` aggregate rather than duplicating unused knowledge inventory. Tool execution and result delivery recheck scope; context receipts reside in assistant message metadata. `validateCompactionSummary` accepts an optional validated project receipt, which the fork writer preserves alongside the handoff.

Initial native recovery checkpoints retain `project_query`, the effective outgoing
prompt and detached paste used for admitted retrieval. Recovery rebuilds context
with that query without rerunning outgoing filters; owner, policy and evidence
fingerprints must still match. A project checkpoint without its admitted query
requires a fresh request rather than guessing from the original draft. Auxiliary
compaction inference also passes its source chat and captured nullable owner to
the shared dispatch fence, including for ordinary chats.

Core membership entries support `chat`, `doc`, and `file`; legacy string entries
remain chat references. Known-entry edits preserve unrelated extension entries
and fields. Workspace assistant operations require an identified project and
its observed revision, validate current item visibility, and recheck inside the
write transaction. File members also require live original metadata. Logical
Trash hides memberships without removing the association, so Restore returns
the same grouping. Removing an association never deletes the underlying item.

Ordinary reference/copy forks resolve legacy ownership and persist a same-project
membership in their atomic write. Membership edits apply only chat additions and
removals, retaining unchanged deleted associations, and roll back together on
failure. Project activity includes unambiguous legacy members before pointer
backfill and hides ambiguous legacy ownership.

`provideChatProjectOwner(threadIdGetter)` gives a chat container one reactive
ownership subscription. Descendants use `useChatProjectOwner(threadIdGetter)`;
standalone consumers create their own subscription. Both refresh on ownership
and workspace changes. This is display state only: request and mutation
boundaries still authorize against the captured database.

Continuation derives source relevance from the preceding normalized user prompt
and passes the project snapshot through the same request admission as dispatch.
Model readiness snapshots include `architecture.input_modalities` alongside
capacity so continuation uses capabilities from the resolved selected route.

The kept-alive Projects sidebar unsubscribes while hidden. A selected project
reads its own workspace records; document/file pickers and chat management
load their catalogs only while open. Async review and save actions retain their
starting project and draft, and completion does not overwrite another project
or a newer draft.

Model selection inherits the project default even for populated chats. An
explicit chat model and routing variant are saved as a `chat-model:<threadId>`
preference through the existing workspace KV helpers, surviving navigation and
reload without changing the project default. A new chat's first send saves the
composer's explicit choice to the chat that send creates (the composer arms this
right before sending); a chat opened later loads only its own preference or the
default, never a stale choice.
Inherited selections follow saved project-default changes and chat moves. The
model controls expose **Use project default** (or **Use default model** outside
a project) to clear an explicit chat override and resume inheritance. Changing
the routing variant is also an explicit chat choice. Restoring a tab draft
restores its text and attachments without changing an existing chat's durable
model selection. Only unsent, pre-chat drafts restore a cached model/variant.

`useChatModelSelection` exposes `modelInherited`, `useInheritedModel()` and
`restoreDraftModel(model, variant)`. The reset uses the guarded workspace KV
writer; restoration is programmatic and ignores model data for existing chats.
Inherited policy observation reads the owning project's singleton settings
record, without loading its memories or source histories.

Normal-turn continuity uses captured project state, indexed project threads and
legacy members. It checks summary relevance before validating source evidence,
ranks candidates by distinct matched query terms with recency as a tie-breaker,
then validates evidence until it has at most three valid matches. Each selected
summary contributes its strongest bounded 4,000-character passage, including
matches beyond the prefix; the receipt records that actual excerpt. Empty queries
skip history retrieval. Explicit suggestion review still validates every
displayed suggestion and retains its newest-first order.

Relevant file discovery searches completed extracted text with the existing
lexical chunker, including passages beyond the catalog preview. It reads one
source at a time and retains bounded passages, without embeddings. Retrying a
historical revision repairs its extraction without promoting it over a newer
current version; successful current or latest replacement processing can still
advance the current source.

The registry supplies `ToolExecutionContext.assertToolAuthorized()` for host
mutations. Native and legacy document creation/duplication, read/proposal receipt
writes, project updates and send-to-thread invoke it inside their captured write
transactions after preparation. Every registry call with an originating chat
captures its resolved owner, including `null` when older plugin callers omit
`projectId`; handlers receive that owner and result delivery rechecks it. A chat
moving into a project requires a fresh execution. The execution
gate's final `approved` argument is for trusted reauthorization after the
registry's approval gate: it preserves normalized arguments and never requests
approval inside a transaction. Model-supplied fields cannot set it.

## Qualification profiles

`bun scripts/test/run-workspace-cloud-e2e.ts` defaults to the exact installed
SQLite and filesystem provider pins. The profile copies those provider bytes,
disables development aliases, rejects source-linked or mismatched packages and
records their versions in a separate installed receipt. Other installed runtime
dependencies are shared; this smoke is not the clean production release gate.
Use `--development-providers` explicitly for sibling source qualification.
Development results never count as installed-artifact acceptance.

The Convex sandbox launcher uses the installed provider template by default too.
Pass the same development flag to both launchers when using source templates;
the application refuses a sandbox with a different qualification mode.
Published SQLite 0.0.14 and Convex 0.0.11 lack the new canonical ownership
marker. Ordinary browser chat remains usable; server execution refuses until a
qualified provider release supplies that contract. Source checks alone do not
close this dependency gap.

## Internal memory classification

User-facing saves and edits use `saveClassifiedProjectMemory` in `app/utils/projects/memory.ts`.
It persists through `saveProjectMemory` first, with the existing reference (fact) default.
The form does not await inference. Existing records retain their kinds until explicitly edited;
there is no migration, backfill or additional memory store. Automatic capture uses the same records as described below.

One OpenRouter Decisions choice question classifies a saved reference. The pinned model is
`perplexity/pplx-decider-v1.1-27b`, with a 0.9 decision threshold. The live comparison
with Jev on 40 labeled examples is recorded below and in the evaluation receipt.
The fixtures, text-free results and comparison command are under
`planning/project-memory-classification/`. On October 8, 2026, Jev matched 40/40
labels and Decider matched 39/40: Decider labeled the current-database/unapproved-migration
case uncertain instead of fact. Both produced the expected stored kind on 40/40 cases,
accepted all twelve adopted decisions and promoted no unapproved choices. Four live
Decider automatic-capture smoke cases also passed, including supported extraction and
skipping a question and an unapproved brainstorm. This finite synthetic evaluation does
not guarantee classification accuracy on every memory.
Canonical model IDs and their dated provider snapshots are accepted; other models are rejected.
State contains only the saved text and at most six preceding messages from the source's
owning chat, with a 240 KiB UTF-8 bound. Oversized evidence skips classification rather than losing caveats through clipping. Attachments and other chats are never sent.
The shared `MEMORY_CONTEXT_MAX_BYTES` limit is 245,760 bytes (240 KiB) of serialized
UTF-8 JSON, roughly 60K tokens for ordinary English; it is not an exact token limit.
Source messages can use the full aggregate budget rather than a 4,000-character cap.
Saved memory entries and existing references retain their 4,000-character limit. The
shared schemas validate the aggregate bound before dispatch and again at the SSR boundary.
The fixed rubric adds a small amount of request overhead outside the state budget. Mixed-media messages contribute
only text parts; image-only messages supply no visual evidence, even though Decider supports images.

Static/BYOK uses the installed SDK directly. Authenticated SSR
uses `POST /api/openrouter/classify-memory`, requiring mutation intent, workspace write access,
matching active workspace and normal key precedence. Its per-minute and daily limits use
separate `memory:user:<id>` buckets (with the configured values), so auxiliary inference never
spends chat quota; 429 responses include `Retry-After`. The endpoint accepts only bounded
state, fixes the model/question, and cannot mutate memories or invoke tools. Memory inference
uses OpenRouter-only APIs, so it runs only when the configured OpenRouter base URL is on
`openrouter.ai`; with a gateway/proxy base URL, classification and capture are skipped rather
than sending that key to another host.

A ten-second total deadline and disabled retries bound classification. Missing credentials,
network failures, malformed probabilities and uncertainty leave the saved reference intact.
Only kind metadata can change, in an expected-clock transaction after fresh workspace,
project, thread and evidence checks. Sidebar navigation does not cancel the operation;
edits, deletion, moves, exclusion and revoked access invalidate it. Diagnostic metadata
includes model, probabilities, latency and cost, never memory text or credentials.

## Automatic memory capture

The workspace-projects client plugin subscribes to `ai.chat.stream:action:complete`. Browser foreground completion and successfully persisted canonical/tracker background completion supply captured `workspaceId` and `projectId`. The listener returns immediately and owns a bounded batching helper (at most sixteen active chats), disposed on workspace switch and plugin HMR. No inference runs in the send path. Capture processes three completed exchanges or an idle batch after ten seconds. It requires the browser to remain open.

`app/utils/projects/automatic-memory.ts` reads at most twelve recent message rows and sends up to eight complete user/assistant messages, with a 240 KiB aggregate bound including up to twenty existing references. The state is built per message, never clipped: fresh user messages come first, then existing references, then older context newest-first while the bound allows. A user message exceeding the 240 KiB budget is skipped whole and an oversized assistant reply becomes a fixed omission marker. Messages that fit individually can still be omitted when the combined JSON state fills the budget. Older context can explain an approval; only fresh user messages can establish new memory. Without a processable fresh user message the cursor advances without inference. One `perplexity/pplx-decider-v1.1-27b` Decisions choice must return save with probability at least 0.8 before a bounded non-streaming `~openai/gpt-luna-latest` request extracts zero to three memories, at most 280 characters each. Gate and extraction deadlines are ten and eight seconds, with no retries or tool loop. Static/BYOK calls OpenRouter directly. SSR sends `{ workspaceId, capture }` to the existing authenticated `POST /api/openrouter/classify-memory` endpoint under the same write, origin, key, base-URL and memory rate-limit policies as explicit classification; a 429/503 leaves the cursor for a later batch. Callers cannot choose models or prompts.

Automatic state also includes `project: { name, brief }` from the captured owning project, within the same 240 KiB budget. The project name is bounded by that budget and the brief retains its 8,000-character settings limit. Both the decision gate and extraction use the Broader recall rubric recorded in `planning/project-memory-classification/prompt-comparison-results.json`: directly stated recurring preferences and workflow constraints can be remembered without an explicit memory request, while one-time requests and inferred preferences are excluded. Project metadata explains relevance; only fresh user messages establish new information or adoption. Metadata is treated as untrusted data. The SSR capture schema requires this project context. Explicit fact/decision classification retains its separate 0.9 decision threshold.

The expected-clock transaction rechecks workspace authority, owning project, chat exclusion, evidence revisions, unchanged project name/brief and batch cursor. Every candidate must cite an exact quote from a fresh user message. Stable project/text-derived IDs, existing records and tombstones prevent exact duplicates and revival of deleted captures. Existing references include dismissed memories for semantic deduplication. An explicit correction may replace an unchanged automatic record; user edits remove its optional `origin: automatic` marker and cannot be overwritten. At most twenty live automatic memories are saved. Additional new captures are skipped at capacity, while explicit corrections and manual memory remain available.

The existing workspace KV table holds `project-memory-cursor:<threadId>` with the processed project/index, committed atomically with memories. Reloads and repeated completion events do not reprocess successful batches. Failures never roll back messages or manual memories and do not schedule retries; a later completed turn can try a new bounded batch. No historical backfill, durable inference queue, embeddings or new database table is introduced. Request context selects at most four matching automatic memories (or four recent entries for a handoff) plus explicit memories ranked by query match and recency within a 12 KiB budget. The receipt's `omitted_memory_count` counts explicit memories left out of the request, whether the budget or context admission removed them. Memories travel in their own context message, which context admission may drop after optional sources and chat summaries; instructions and the brief stay required. A project holds at most 500 live memories. Query terms ignore common stop words for memories, sources and chat continuity. All automatic memories remain editable/deletable in the normal Memory list and retain source-chat links.
