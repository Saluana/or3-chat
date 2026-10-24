# Chat lifecycle and persistence

This guide explains the boundaries to preserve when changing the host chat UI. The source controller is `useChat`, exported from `app/composables/chat/useAi.ts`. Its types live in `app/utils/chat/types.ts`; use those imports rather than copying interfaces.

## Admission, durability, and completion

A send moves through admission, durable user-message persistence, response streaming, and a terminal result. Admission is single-flight for the controller; a busy request can be rejected before a message exists. An admitted request retains its originating workspace database and cancellation identity.

The native composer clears submitted text and attachments after provider acceptance, with a comparison that preserves edits made while preparation was pending. A durable user-message ID alone does not prove provider acceptance: a final legacy filter or provider can refuse context after saving that turn. Preserve the draft on `context_full` and metadata-unavailable outcomes. Accepted, completed, failed, aborted and detached remain distinct outcomes. See [send-result types](/documentation/types/chat-types#sending-and-request-state).

Create `useChat()` during component setup and dispose it on unmount. Reuse the existing `ChatContainer.vue` send and acceptance handling when extending product actions: it watches the matching request's `streaming` state with `providerAccepted`, then the terminal result, and fences draft clearing against text edits and navigation. `hasDurableSendAcceptance()` only identifies a saved user row; it is useful for durability reporting, not draft-clearing authority.

History synchronization and background-job recovery use browser-local storage.
They must remain client-only even when a native chat route renders its shell on
the server. Server rendering must never start IndexedDB reads or stream recovery.

Open chat panes observe their indexed conversation rows in the active workspace's
Dexie database. Incoming user turns, completed replies, edits, and deletes update
the open view without reopening it or adding network polls. Observers release on
pane/thread changes, workspace switches, and disposal. Active foreground streams
retain their in-memory reply; a saved terminal history received during streaming
can apply after it settles only when it includes that completed reply from the
same stream generation, including replies held in the separate foreground tail.
Foreground token fragments remain local to the sending client; peers receive
the saved reply.

## Streaming, stopping, and teardown

The default message renderer loads through the theme registry when a message
row mounts. Empty chats keep Markdown and highlighting out of the initial
preload graph; theme-provided message components keep their existing selection.

Render the controller's UI projections rather than raw stream events. Text, reasoning, tool progress, and partial output can arrive independently. Accumulators batch UI updates; persistence and display have separate responsibilities. A transport disconnect does not necessarily mean a server background job stopped.

`createStreamAccumulator()` in `app/composables/chat/useStreamAccumulator.ts`
buffers text and reasoning separately and batches reactive flushes with animation
frames, with a microtask fallback when frames are unavailable. `finalize()`
flushes pending output and seals the accumulator idempotently. Later appends are
ignored until a reset. This display state is not a durable message receipt.

`ChatContainer.vue` uses the `or3-scroll` package for its message viewport.
Preserve keyed message anchors and the existing user's scroll intent when
updating stream projections or restoring a tab. Do not recreate the removed
`VirtualMessageList.vue` thresholds in another watcher.

`abort()` requests cancellation. `dispose()` releases view listeners/subscriptions and can leave admitted generation tracking detached. It does not delete saved messages. `clearConversation({ persistence: 'preserve' })` clears in-memory projections and preserves durable rows. Do not use teardown as a destructive conversation operation or report it as a completed cancellation.

Foreground intake checks cancellation before buffered events and after awaited
processing. Cancellation during the final incoming filter preserves accepted
partial output and produces an aborted result without success completion hooks.
The successful terminal claim is synchronous; later cancellation cannot rewrite
that claimed outcome. Tool-result insertion validates the captured thread, parent
assistant and generation under the same write transaction as its append, so a
hard deletion cannot leave a later orphan result.

Each terminal write must retain request/generation identity so late results from an older retry or workspace cannot overwrite current work. Preparation hooks run before final persistence; a callback or notification finishing is not proof that the database write succeeded. Use the existing tracker and persister recovery paths.

## Context and tools

Native message preparation snapshots content parts, selected binary attachment
bytes, canonical tool calls and media options before asynchronous context
hydration. Hydration appends to the request copy; later edits to the caller's
messages or media settings do not change that in-flight copy.

The preparation foundation exposes
`useAiSettings().captureContextPreference()`: it loads existing settings, reads
the current durable maximum through the strict KV snapshot API, and returns a
frozen scalar with its DB handle and workspace generation. A failed read or
changed workspace rejects capture; retry can recover. These origin fields are
internal and must not be serialized as provider parameters. Native initial
send, retry, continuation and foreground tool iterations consume that captured
value. Native requests send a versioned `_context` envelope containing only
the nullable user maximum and explicit reply allowance. The server resolves
capacity independently through the existing OpenRouter SDK catalog path;
client capacity claims do not authorize a larger window. Background execution
checkpoints retain the envelope across tool iterations and worker recovery.
All OR3 routing/context fields are removed from provider input and usage
fingerprints. Legacy callers without the envelope retain their prior boundary.

Native admission uses the selected model's advertised total window and the
optional user maximum. Missing capacity is refreshed through the model catalog;
unavailable capacity rejects the request with an explicit recovery reason. The
complete provider body includes selected history, system/injected content,
tool definitions and configuration. Initial native rejection precedes thread,
user and assistant writes; refused retry/continuation preserves existing rows.
There is no automatic context trimming, guessed capacity or fixed reply
reserve. An explicit reply allowance must fit the remaining window and model
output maximum. Otherwise output uses the actual remainder up to that maximum,
capped at 65,536 tokens (`DEFAULT_REPLY_ALLOWANCE_TOKENS`). The cap only sizes
`max_tokens`; it never reserves input space. Requesting a whole very large
output window reserves credit for all of it and narrows OpenRouter routing to
hosts that advertise that size, some of which refuse tool histories.
Counts remain estimates, particularly for images and files.

Each foreground tool request checks the complete accumulated body with the
generation's captured maximum. An oversized accepted result stays durable,
ends with `context_full`, and does not cause a tool replay or shortened retry.
Legacy side-effecting final filters still run once after real rows exist; their
mutations are checked before native inference, but that legacy contract cannot
guarantee zero turn writes. The additive pure preparation and acknowledged
commit contract is described in the [hook reference](/documentation/hooks/reference#native-chat-preparation-and-delegated-commit).

Source UI token counting uses `app/composables/core/useTokenizer.ts` and a
shared worker. When the worker is unavailable, including during SSR, it falls
back to a character heuristic rather than importing the encoder on the main
thread. A displayed count is not exact provider billing or proof of admission.

Use the admitted tool registry, schema validation, request-scoped authority, and abort signal. Server/client tool execution and background transport are coordinated by the current host implementation. A tool's name or runtime field alone does not authorize execution. [Chat tools](/documentation/utils/chat-tools) preserve frozen editor snapshots and explicit proposal review.

## Tabs and drafts

Sidebar and tab resource selection stays within the mounted workspace shell.
Direct chat/document URLs mount that shell immediately and use its initial
resource validation, rather than hiding the entire UI behind a second database
lookup. Missing or deleted initial chats and documents return to their base
route before opening an unavailable resource. Development pre-optimization includes lazy Markdown and editor entry
points so opening them does not trigger a Vite dependency reload.

The tab session owns the open-tab manifest and active bindings. The pane adapter owns the mounted panes; chat and document controllers own content. Changing an active tab should not create a second content store.

Tab manifests persist to localStorage by workspace and profile. A failed read keeps the original manifest protected even if writes later work: scheduled saves, Retry and unload cannot publish the temporary layout until a successful restore has read that scope. Reload after storage becomes readable restores the original tab IDs and their drafts. Storage failures never break the workspace: blocked storage (even a throwing `window.localStorage` getter), quota errors and failed debounced writes keep the unsaved layout pending, expose `persistenceStatus` (`ok`, `unavailable`, `write_failed`, `corrupt`), and raise one persistent "Tab layout could not be saved" toast per failure episode with Retry. Draft restoration depends on the saved tab IDs: before browser unload, a failed layout is retried synchronously and an unresolved layout or draft save failure requests the browser's unsaved-change confirmation. This is best effort; browsers can suppress confirmations and users can accept them. A saved layout that is invalid JSON or fails the schema is reported as corrupt rather than missing: the original is copied to `<key>:corrupt` (latest only) before a fresh layout can replace it, and is never overwritten while that copy cannot be made. The persistent "Saved tab layout was unreadable" notice offers **Download original** (`or3-tab-layout-backup.txt`) and **Discard original**; each closes the notice, and the copy stays until it is discarded. The buttons act on the layout key the notice was raised for, so switching workspace or profile first cannot make them touch another layout's copy (`getCorruptLayoutBackup(key)` / `discardCorruptLayoutBackup(key)` take that key). No buttons are shown when the copy could not be made. `useWorkspaceTabs` exposes `getCorruptLayoutBackup()` and `discardCorruptLayoutBackup()` for the same purpose. `flushPersistence()` always saves the current layout, which pane swaps rely on; the debounce, `pagehide` and scope switches write only pending changes.

Composer drafts persist in local-only `workspace_tab_drafts` and
`workspace_draft_versions` tables, scoped by physical workspace database,
account, app tab and a fresh page writer identity. Each set/discard has a
monotonic sequence. One transaction compares the complete observed canonical
row and discard state, preserves displaced legacy content, and commits the
writer head and canonical mirror. A delayed retry cannot resurrect a newer
clear or an explicitly removed version. Reload hints select that page's saved
branch; duplicated browser tabs receive independent writer identities.
The composer quietly restores its own saved branch without a draft-history
panel or version-management controls. Other branches and orphaned app-tab
drafts remain protected in local recovery storage. The recovery APIs archive
the current buffer before restoring a version and require the exact version
for removal. Recovery versions never automatically evict unsent content;
reaching the 200-version content capacity rejects new archived content. Empty
composer and discard markers retain their sequence floors without consuming
that capacity. A full archive never blocks reading drafts: journals that cannot
be imported remain intact and can still restore their composer content.
Restoring an imported journal reuses its writer head rather than publishing a
duplicate recovery version. Recapturing unchanged durable content, including an
empty composer, does not enqueue another write. Explicitly removed versions
retain only a sequence floor, without text or attachment references.

Drafts retain text, editor JSON, settings, pasted blocks and attachment hashes;
missing-file hashes and names survive recapture. File deletion checks both
canonical drafts and saved versions inside its transaction. Writes are debounced
and retried with backoff; page hide captures the current editor immediately.
Synchronous journals up to about 100k characters use immutable per-writer
operation keys (`or3:tab-draft-journal:v2:*`). A confirmed newer own write
compacts its older keys. Legacy v1 records are imported conservatively and
retained because old writers can still mutate them. Unknown records remain
untouched and block restoration only for their own app tab; retry rereads those
records. A failed archive import or journal cleanup does not turn readable bytes
or a confirmed database commit into a restore/save failure. Failed saves retain
the buffer, show **Draft could not be saved** with Retry for the affected
workspace/account/tab, and request unload confirmation
when neither a native receipt nor a journal protects the bytes. Drafts over
about 500k serialized characters stay in memory with a visible failure and
preserve the previous durable copy. Captured scope prevents late writes entering
another workspace/account. Send clears only its submitted composer revision;
close-tab Undo retains its existing grace period and preview URLs are released
on discard. Save and restore notices are removed when their composer navigates
away or unmounts; returning to a draft with an unresolved save failure shows its
warning again.

Concurrent draft flushes can finish out of order. A successful write clears only that tab's failure; it cannot dismiss another tab's unresolved save warning. A confirmed explicit discard clears the corresponding failure once its deletion is durable.

An inactive workspace's database handle can close while its unsaved buffer remains in memory. After that workspace/account is restored, retries may use its already-loaded replacement handle only when the database name also matches. A late callback retains its captured destination; the active workspace never becomes an implicit fallback, and the closed handle is not reopened.

The pane loader reconciles separate canonical tool-result rows into their assistant calls before seeding a chat controller. Tool evidence remains visible after tab activation or reload, while plugin-owned message metadata and stored rows remain intact. Tool-call presentation metadata is retained by stable call ID; canonical status, result and error override stale embedded execution fields. Consumers should use this loader rather than treating raw assistant rows as a complete tool transcript.

A newer activation supersedes older work. Editor sessions are resolved by pane/tab identity, which matters when a document appears in more than one split. Capture outgoing edits and verify local durability before rebinding; do not assume the saved database snapshot contains everything currently visible in an editor.

Tab commands resolve to a status (`activated`, `created`, `failed`, or `superseded`) instead of a bare tab ID, so a failed activation cannot look like success and a superseded one is not reported as an error. Navigation bridges preserve that status; superseded palette, plugin, and version-history requests leave newer UI and feedback intact. Closing a tab waits for that save and then closes against the current tab state, and a failed activation restores only its own pane binding and focus. A close of the still-mounted outgoing tab waits for activation to finish, keeping the rollback target available if its save fails, and is cancelled if the workspace changes. Unrelated tabs opened, renamed, or closed while the save ran are kept.

See [source map](/documentation/start/source-map), [documents](/documentation/database/documents), and [workspace-safe writes](/documentation/database/safe-changes#workspace-safe-operations).

Chat settings and their nested selectors use fade transitions to keep anchor widths stable while Floating UI measures them. Scale transitions can create repeated resize notifications when a nested menu opens before its parent settles.

Interrupted draft reads reject restoration instead of reporting an absent draft. The composer keeps the existing saved row, prevents its untouched empty editor from replacing that unread copy, and shows a persistent "Draft could not be restored" notice with **Retry restore**. The retry is scoped to the originating account, workspace and tab.

A rejected attachment blob or metadata read keeps its original draft reference and reports a retryable restore failure. Partial preview URLs are released before retry. Only a successfully read absent/deleted file is reported through the existing missing-attachment notice.

Save completion acknowledges only the exact current persisted snapshot. An older successful save of the same tab cannot clear a newer failed edit's warning. Immediate discard uses the same receipt rule, and rejected deletion keeps its discard journal and retry pending.

Empty editor transactions do not count as competing edits during restoration.
After an interrupted read, unload or unmount cannot replace the unread saved
buffer merely because the empty editor emitted an update. Retry applies the
saved copy unless the user changed text, attachments or pasted blocks while it
was loading; typing and clearing text still counts as a user edit. This restore
comparison is separate from the revision used to clear accepted sends.

Before unload, the composer captures the latest editor state before the shell
checks local durability. Pending draft bytes require confirmation when neither
a confirmed IndexedDB receipt nor a matching synchronous journal protects them.
This includes valid buffers larger than the unload journal limit and files still
preparing. Recapturing unchanged durable content does not prompt solely because
its timestamp changed. Browser confirmations remain best effort.

Selected attachments remain reactive throughout persistence. A ready/hash or
error transition after the initial draft flush triggers another draft capture,
so an upload that finishes late still persists its restorable file reference.
The original intake ownership and cancellation checks apply throughout.

An attachment in the error state keeps a composer alert naming the failed file
even after its transient error toast expires. The existing toast Retry remains
available during that toast; afterward the user can remove and attach the file
again. Removing a failed attachment or starting/succeeding at retry clears its
persistent alert. A preview alone does not acknowledge file durability.

Capturing before editor construction cannot discard an untouched unread buffer.
If tab props restore text before extensions finish loading, capture retains that
matching scoped saved editor JSON until an editor can supply the current JSON.
Files selected early remain capturable; lack of an editor alone does not discard
their live bytes.
Runtime tab status and view-state updates are reactive projections and do not
schedule writes to the tab manifest. During startup, child status events can
arrive before the shell restores its layout; persisting them would publish the
temporary blank tab and orphan an otherwise durable draft. A fresh scope saves
its initial tab explicitly after checking for a saved layout.
An active stream write coalescer registers a refresh warning after a failed
progress save. The warning stays armed while that write is retried, including
newer deltas arriving during its retry, and is removed only when pending progress
is acknowledged or the coalescer is disposed. Concurrent flush callers join the
current write chain; they cannot return while a newer prepared write is pending.
Disposal cancels idle retries and prevents waiting or new callers from preparing
more writes, while draining the already prepared write. Each writer owns its own
warning; successful writes in another pane cannot acknowledge its failed data.
Terminal persistence after disposal remains the finalization layer's concern.


A failed request-owned terminal assistant save retains its exact content,
reasoning and tool-call snapshot after stream teardown. It retries local
persistence five times with bounded backoff, and on page hide, reconnect or
**Retry local save**. A persistent notice and unload warning remain until
acknowledgement or ownership supersession. Retries reopen only the captured
physical database and check fresh ownership inside each write, including deleted,
superseded and tracker-takeover states. They never replay a provider or tool.
Preparation effects run once; completion effects run once following the durable
write. Canonical/tracker failures remain with their existing recovery owners.

## Automatic titles

A new chat saves a short first-message title immediately. Its first descriptive
user turn starts one auxiliary title request after message persistence, without
awaiting it in the streaming path. Short greetings wait for a descriptive user
turn. Later messages, retries and branches do not regenerate titles; use Rename.

Chats and message-created documents share `/api/openrouter/title`. Inference runs
on the backend through the existing OpenRouter credential policy, including
server-stored BYOK versus instance billing. The default is
`deepseek/deepseek-v4.1-flash:nitro`; the complete routing ID reaches OpenRouter.
Workspace owners can select a supported text model and routing in Dashboard → AI
Settings → Title Generation Model. Managed settings live in the private
`WorkspaceSettingsStore`; ordinary editors cannot change them or override the
model in requests. Source/local mode uses existing AI settings KV persistence.
A changed model affects future requests only.

Optional `title_source` on threads/posts distinguishes temporary, generating,
generated, heading, manual and failed titles. One local transaction claims the
request; completion conditionally updates the still-automatic title. Renames,
deletions, edits to the originating user message, workspace/account changes and staged document renames prevent stale
updates. Existing rows are not backfilled. No indexes or Dexie migration are
needed, and title writes use the existing transactional outbox capture.

Inference sends at most 2,400 source characters and requests at most 48 output
tokens, without streaming, tools, web search or reasoning. The provider deadline
is eight seconds (client transport: ten seconds), with zero automatic retries.
Failures retain the fallback. Reloading does not restart pending work, and static
hosts without a backend retain their fallback titles. Diagnostics record only
kind, outcome and duration, never content or credentials.

A successful chat title adds one browser POST, one provider POST, two thread-row
reads, one originating-message read and two writes (claim and completion). Local mode also reads the AI settings
KV once (one KV lookup and one tombstone lookup); managed inference reads the private model setting once. These writes
participate in normal outbox coalescing/sync; no separate sync requests or polling
are scheduled. Later descriptive turns are excluded using already-loaded history.
Documents with headings add no inference requests or title-state writes. An
AI-named document uses three post-row reads and two writes beyond creation.
Message-action idempotency uses three post lookups on first creation; replay uses
one lookup and preserves existing edits. Opening AI Settings in managed mode adds
one model-setting GET; saving adds one admin POST and one catalog lookup.
These counts cover direct feature operations; existing auth/credential-store
reads and IndexedDB observers depend on the provider and open views. Project
shortcuts read canonical native titles through their existing observer, without
additional project writes.

Admission is atomic across tabs sharing the workspace IndexedDB. Disconnected
profiles/devices still reconcile through OR3's existing clock/HLC LWW policy;
this feature does not introduce cross-device locks or change that sync contract.
