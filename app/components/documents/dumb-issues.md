# OR3 document editor hardening review

Reviewed 2026-10-24, at commit `8e8557404d91eb6057a1d8d49faf9f7de6f34230`.

**Verdict: the editor is not ready for a “never lose or misapply my work” standard.** This pass found **20 actionable issues: 5 P1, 14 P2, and 1 P3**. The most serious problems are stale AI edits replacing newer text, history restore overwriting intervening typing, revision pruning deleting unrelated rows or the last usable checkpoint, and AI settings crossing workspace boundaries.

This is a report, not an implementation. Production source was not changed. The accompanying probes deliberately demonstrate current defects; a passing probe means the defect was reproduced. No finite review can certify that every possible bug has been found.

## Scope and evidence

The review followed the docmap, source map, document CRUD and revision guides, editor extension guides, and the current source contracts. It covered the editor root and toolbar, lazy hosting, mounted sessions, autosave and conflict handling, title/body changes, history and codec worker, image intake and ownership, Markdown export, AI proposals and partial acceptance, autocomplete, document tools and workspace Apply/Undo, workspace settings, schema/extension loading, and adjacent sync/storage boundaries.

| Validation | Result | What it establishes |
| --- | --- | --- |
| Existing targeted document/editor suites | **191 tests passed in 33 files** | The current baseline passes despite the findings below. |
| Audit probes | **18 probes passed in 5 files** | 17 distinct findings reproduced at their owning runtime boundaries; AI preflight and generation are separate reproductions of the same stale-snapshot defect. |
| Existing Chromium recovery/polish harness | **Not executed successfully** | Initial startup required the pinned Bun runtime. Retrying with cached Bun 1.3.14 timed out waiting for the dev server; the log also reported the local vault stopping. No browser pass is claimed. |
| Diff inspection | Production source unchanged | Only this report and the document-editor audit evidence were authored for this review. |

Evidence, runnable commands, mocks, and limitations are documented in [the evidence README](../../../audit-evidence/document-editor-review-20261024/README.md). “Runtime” below means the specific described boundary was exercised, not that a complete paid-model or cloud-provider workflow ran. “Source” means the finding follows from inspected callers and implementation, without a dedicated runtime reproduction.

## Findings

### DE-01 — P1 — AI proposals bless an old snapshot with the latest version

**Location:** [useDocumentAiAgent.ts:788](../../../app/composables/documents/useDocumentAiAgent.ts:788), [proposal creation:925](../../../app/composables/documents/useDocumentAiAgent.ts:925), [acceptance:975](../../../app/composables/documents/useDocumentAiAgent.ts:975). **Evidence: runtime, two cases.**

`submit()` freezes the document before awaiting settings, references, model resolution, tokenization, and request hooks. It locks the editor only later. When generation finishes, it assigns `requestVersion` from the *current* content version instead of the version of the frozen snapshot. A newer edit is therefore treated as part of the proposal's baseline even though the candidate does not contain it.

**Reproduction:** hold tokenization, edit the document, release tokenization, then accept the proposal. The stale flag is false and the original body replaces the newer text. The same result occurs when a programmatic edit is made during generation; DE-10 supplies a UI route to such edits. A pre-AI checkpoint may preserve the displaced text, but silently replacing it is still incorrect.

**Fix:** capture content version, editor identity, document identity, and workspace/account ownership with the snapshot. Carry that version through the entire run and validate it before publishing and applying a proposal. Reject or explicitly rebase changed snapshots; never retag an old snapshot with a newer version. Add a regression holding preflight while a user edits.

### DE-02 — P1 — History restore overwrites typing made while its checkpoint is saving

**Location:** [DocumentEditorRoot.vue:1786](../../../app/components/documents/DocumentEditorRoot.vue:1786), [history restore event:155](../../../app/components/documents/DocumentHistoryPanel.vue:155). **Evidence: runtime, mounted editor.**

Restore captures a pre-restore checkpoint, awaits its persistence, and then replaces the live title/body. Its post-await checks cover editor/document/DB identity but not content version, availability, or a restore lease. The editor stays editable during the await. The history panel closes its preview and emits the restore event without owning the asynchronous busy/error state.

**Reproduction:** start restore, suspend checkpoint persistence, type new text, then release the checkpoint. The historical body is persisted. The intervening text appears in neither the restored body nor the captured pre-restore checkpoint. Multiple restores and a Trash transition during preparation also lack a shared operation guard.

**Fix:** acquire a document mutation lease or compare the complete title/body version immediately before mutation. Keep the operation serialized, recheck availability after every await, validate the entire replacement before changing either title or body, and expose restore failure/retry in the panel. Preserve intervening work before allowing a retry.

### DE-03 — P1 — Revision pruning can delete unrelated documents or other posts

**Location:** [document-revisions.ts:43](../../../app/db/document-revisions.ts:43), [deletion:254](../../../app/db/document-revisions.ts:254). **Evidence: runtime, real helpers over disposable IndexedDB.**

Manifest parsing accepts arbitrary string `chunkIds`. Pruning passes those IDs directly to `posts.bulkDelete()` without checking that each target is a chunk belonging to that revision. Documents, prompts, manifests, and chunks share this table.

**Reproduction:** create a victim document, create 21 parseable revision manifests for another document, and place the victim's ID in the oldest manifest's chunk list. Pruning the owner deletes the victim. This is a same-workspace corruption/import/sync trust problem; this review does not claim an unauthenticated or cross-tenant exploit.

**Fix:** validate every deletion target inside the deletion transaction: chunk post type, parent revision title, deterministic chunk ID, uniqueness, and ownership. Reject malformed manifests rather than letting stored metadata authorize arbitrary deletion. Also validate nonnegative byte counts, reasonable timestamps, and bounded chunk lists at ingestion. A regression must prove that a malformed manifest cannot remove any unrelated row.

### DE-04 — P1 — Incomplete revisions can displace the only recoverable checkpoint

**Location:** [retention selection:216](../../../app/db/document-revisions.ts:216), [pruning:254](../../../app/db/document-revisions.ts:254). **Evidence: runtime.**

Pruning selects retained IDs from manifest metadata without checking chunk availability or checksum validity. Its comment promises to preserve the newest complete checkpoint, but the implementation preserves the newest manifest. Incremental synchronization or interrupted imports can expose manifests before all their chunks are usable.

**Reproduction:** store one complete checkpoint and 20 newer manifests whose chunks are missing. Before pruning, one revision is recoverable; afterward, none is. The complete checkpoint was deleted.

**Fix:** determine which snapshots are complete before selecting the recoverable retention set. Always pin at least the newest validated complete snapshot. Treat incomplete revisions separately and guard completeness/ownership again before deletion. Include partial-sync and corrupt-checksum cases in retention tests.

### DE-05 — P1 — AI settings from one workspace can be saved into another

**Location:** [useDocumentAiSettings.ts:66](../../../app/composables/documents/useDocumentAiSettings.ts:66), [loading/update:122](../../../app/composables/documents/useDocumentAiSettings.ts:122), [KV writer:508](../../../app/db/kv.ts:508). **Evidence: runtime with a deferred KV boundary.**

The settings value and in-flight load promise are module singletons. A workspace-B caller can inherit workspace A's pending promise. A late A load publishes its value unconditionally. `update()` then merges that value and calls the KV writer without a captured DB, so the write resolves against whichever workspace is currently active.

**Reproduction:** start an update in A, delay its settings read, switch to B, and release A's read. The writer receives B as its destination along with A's private system instruction and tool settings. The mock controls the storage boundary; the real KV API confirms that an omitted DB defaults to `getDb()`.

**Fix:** scope settings state and loading promises to the originating DB/account, pass the captured DB through both read and write, and prevent obsolete completions from publishing into another workspace's UI. On failure, preserve the prior value instead of marking default settings as successfully loaded. Verify A→B switches during both reads and writes.

### DE-06 — P2 — Malformed persisted content is silently presented as a blank document

**Location:** [documents.ts:244](../../../app/db/documents.ts:244). **Evidence: runtime.**

`parseContent()` returns an ordinary empty TipTap document on JSON parse failure or an invalid root. The record carries no corruption status and remains editable. A subsequent save can overwrite the original raw payload, removing material that might have been recoverable by repair or export.

**Reproduction:** replace a document's stored content with truncated JSON and read it through `getDocumentInDb()`. It returns a normal document with empty content, not an error or recovery record.

**Fix:** distinguish a deliberately empty document from an unreadable document. Preserve the raw bytes, show a corruption/recovery state, and require an explicit recovery choice before replacing them. Schema incompatibility needs a similar read-only recovery path. Do not convert load failures into writable emptiness.

### DE-07 — P2 — Document hooks can make image ownership metadata disagree with the body

**Location:** [creation:352](../../../app/db/documents.ts:352), [update:655](../../../app/db/documents.ts:655), [file deletion guard:57](../../../app/db/files.ts:57). **Evidence: runtime for creation; matching update path inspected.**

`file_hashes` is derived before the documented content filters and before-actions run. A hook can change `content` without recalculating the metadata. The final row persists both values as supplied, while file ownership/deletion checks trust `file_hashes`.

**Reproduction:** a `db.documents.create:filter:input` hook adds a native image to the body. The persisted JSON contains its hash but the row's `file_hashes` remains null. This leaves a real image reference invisible to ownership checks; removing images through a hook can produce the opposite leak.

**Fix:** validate final content and derive ownership metadata after all mutation hooks, immediately before persistence. Treat file references as derived state rather than an independently authoritative hook field. The workspace chat Apply/Undo path already recalculates after validation; use a consistent boundary for ordinary CRUD too.

### DE-08 — P2 — A detected cross-tab conflict has no usable reconciliation path

**Location:** [useDocumentsStore.ts:123](../../../app/composables/documents/useDocumentsStore.ts:123), [refresh:258](../../../app/composables/documents/useDocumentsStore.ts:258). **Evidence: runtime.**

The optimistic comparison correctly prevents overwriting a remote edit. However, the failed pending buffer keeps its original comparison baseline, and refresh refuses to adopt a newer record while pending work exists. Repeated Retry compares against the same stale baseline. The editor has no explicit keep-local/keep-remote/merge/save-copy operation that can reconcile this state safely.

**Reproduction:** load Base, stage Local, commit Remote directly through another storage writer, and flush. After the conflict, even changing the local buffer to exactly Remote and calling refresh plus flush leaves the original baseline and error in place.

**Fix:** keep the refusal to overwrite, but add a recovery workflow that first durably preserves the local draft, displays both versions, and explicitly adopts a new comparison baseline after a user's resolution. Test completing recovery, not only detecting a conflict.

### DE-09 — P2 — Storage read failures are misreported as unavailable documents

**Location:** [getDocumentInDb:406](../../../app/db/documents.ts:406), [load state:258](../../../app/composables/documents/useDocumentsStore.ts:258), [load banner:17](../../../app/components/documents/DocumentEditorRoot.vue:17). **Evidence: runtime.**

The document read uses `dbTry` without rethrowing. A storage exception becomes `undefined`; the store treats it as missing/unavailable and clears `lastError`. The root's error-only retry path is therefore bypassed.

**Reproduction:** make the IndexedDB row read reject. `loadDocument()` finishes with `status: unavailable` and no error instead of a retryable loading failure.

**Fix:** propagate storage failures to the store, while reserving `undefined` for a successful read that found no visible document. Keep missing, trashed, schema-incompatible, and transient I/O states distinct. The lazy host's initialization retry does not resolve this incorrect store classification.

### DE-10 — P2 — The AI edit lock does not cover toolbar mutations

**Location:** [toolbar:30](../../../app/components/documents/DocumentEditorRoot.vue:30), [lock definition:593](../../../app/components/documents/DocumentEditorRoot.vue:593), [lock policy](../../../app/composables/documents/documentAiLifecycle.ts:37). **Evidence: runtime, mounted editor.**

AI streaming/review/acceptance sets the editor noneditable, but toolbar inertness is tied only to item availability. TipTap's `setEditable(false)` stops native typing; it does not make command calls immutable. Toolbar handlers can still change the document. Some controls already use `editorLocked`, so behavior is inconsistent.

**Reproduction:** put the editor in AI preview, confirm `editor.isEditable === false`, activate Bold through the real toolbar component, and observe changed marks. During generation, this can combine with DE-01; during review, it can invalidate the proposal unexpectedly.

**Fix:** gate all mutation entry points on the same lock/lease, including toolbar commands, title changes where they belong to the operation baseline, dialogs opened before a lock, image operations, and extension commands. Avoid relying solely on DOM inertness or contenteditable.

### DE-11 — P2 — Accepting append hunks out of order changes the proposed result

**Location:** [document-ai-hunks.ts:218](../../../app/utils/documents/document-ai-hunks.ts:218), [live insertion:337](../../../app/utils/documents/document-ai-hunks.ts:337), [acceptHunk:1012](../../../app/composables/documents/useDocumentAiAgent.ts:1012). **Evidence: runtime.**

Each `insert_end` hunk appends to the current document end. The full candidate and accepted-operation projection use proposal order, but incremental application uses click order.

**Reproduction:** preview Base → First append → Second append. Accept Second, then First. The resulting document is Base → Second append → First append. Accept All produces a different result from accepting the same hunks individually.

**Fix:** anchor insertions to stable positions in the proposal's ordered result, or rebuild the accepted subset in canonical order while preserving undo history. Test reverse acceptance of multiple appends and insertions at the same anchor, plus partial rejection.

### DE-12 — P2 — A failed Accept All leaves an applied proposal that cannot retry acceptance

**Location:** [useDocumentAiAgent.ts:995](../../../app/composables/documents/useDocumentAiAgent.ts:995), [stale calculation:339](../../../app/composables/documents/useDocumentAiAgent.ts:339). **Evidence: runtime.**

Accept All changes editor content before awaiting persistence. If persistence fails, the candidate remains visible and the proposal retains its old request version. The next acceptance attempt fails its own stale check before trying storage again.

**Reproduction:** reject the first `persistCurrent()` call with a disk-full error and make the next call succeed. After the first failure, the AI appendix is visible, the proposal is stale, and the next Accept All throws “The document changed.” Persistence was called only once. Ordinary document-save retry may still save the buffer, but the AI review state remains inconsistent.

**Fix:** represent “applied in memory, awaiting durable save” explicitly. Retry that persistence without reapplying the proposal; only mark the review complete after it succeeds. Keep discard/undo behavior clear when application and durability have diverged.

### DE-13 — P2 — Markdown download drops usable native image content

**Location:** [document-to-markdown.ts:11](../../../app/utils/documents/document-to-markdown.ts:11), [or3-document-image.ts:27](../../../app/extensions/or3-document-image.ts:27), [download:428](../../../app/components/files/WorkspaceFilesPane.vue:428). **Evidence: runtime serializer plus inspected download caller.**

The custom image node serializes to a hash-bearing `figure`, without an image URL or Markdown serializer. The download path emits only a `.md` Blob and supplies no referenced image assets. Text exports successfully, making the missing image payload easy to overlook.

**Reproduction:** export a document containing a paragraph and `or3Image`. The result contains the paragraph but no usable Markdown image, `<img>` element, or embedded image bytes.

**Fix:** define an image-preserving export format: an asset bundle with relative Markdown links, or another format carrying bytes. Resolve images through the captured workspace and report unavailable assets. If an export intentionally omits images, disclose that before presenting it as the document download.

### DE-14 — P2 — Autocomplete's loading timeout cannot clear loading

**Location:** [timeout:187](../../../app/plugins/EditorAutocomplete/TiptapExtension.ts:187), [fetch guard:238](../../../app/plugins/EditorAutocomplete/TiptapExtension.ts:238), [state reducer:535](../../../app/plugins/EditorAutocomplete/TiptapExtension.ts:535). **Evidence: runtime plugin state.**

The five-second timeout dispatches `loading: false`. The reducer handles only `loadingMeta === true`; a false value leaves the old state unchanged. The request guard refuses new work while loading, so the timeout fails precisely when a hung request needs recovery.

**Reproduction:** dispatch the same true and false loading metadata through the actual TipTap plugin. Loading remains true after the timeout's update. Other clearing interactions may recover it, but the advertised timeout does not.

**Fix:** handle both boolean values, abort the timed-out request, and use request ownership so a late completion cannot revive stale suggestions or reset a newer request. Verify retry after timeout, rather than just the timer firing.

### DE-15 — P2 — Inline AI review buttons ignore keyboard and semantic click activation

**Location:** [makeButton:64](../../../app/plugins/DocumentAiHunks/TiptapExtension.ts:64), [marker button:101](../../../app/plugins/DocumentAiHunks/TiptapExtension.ts:101). **Evidence: runtime DOM activation.**

Accept, Reject, expand, and marker buttons attach their action to `mousedown` only. Native keyboard button activation and assistive technology activation normally dispatch a click, not a mouse-down gesture. The controls look semantic but do not implement semantic activation.

**Reproduction:** call `click()` on the rendered Accept button: no acceptance callback. Dispatch `mousedown`: the callback fires. This proves the missing click path without claiming a full screen-reader qualification.

**Fix:** execute the action on `click`; use pointer/mousedown prevention only to preserve editor selection. Ensure Enter/Space and assistive activation trigger exactly one action. Add a real keyboard browser case when the harness is operational.

### DE-16 — P2 — Valid local documents can exceed the cloud row ceiling with no editor-level recovery

**Location:** [document persistence:320](../../../app/db/documents.ts:320), [shared size ceiling:17](../../../shared/sync/sanitize.ts:17), [permanent failure classification:918](../../../app/core/sync/outbox-manager.ts:918). Installed SQLite gateway validation was also inspected at `or3-provider-sqlite/dist/runtime/server/sync/sqlite-sync-gateway-adapter.js:185`. **Evidence: runtime local/sanitizer boundary; provider rejection source-traced.**

A native document is one unchunked JSON string in a posts row. The editor/CRUD path permits large bodies and the posts sanitizer retains them. The inspected gateway rejects payloads over 256 KiB, and oversized failures are permanent. Revision chunking does not chunk the current document body.

**Reproduction:** save a 300 KiB text document locally. It reads back intact, and its sanitized wire payload exceeds `MAX_SYNC_PAYLOAD_BYTES`. This review did not send it to a live provider.

**Fix:** establish a supported native document size contract. At minimum, expose that a document cannot sync and provide export/split recovery without destroying local content. A chunked-current-document protocol requires explicit architecture approval; do not silently truncate content or treat revision chunks as a substitute for the live row.

### DE-17 — P2 — Chat Apply/Undo bypasses revision retention

**Location:** [workspace-document-change.ts:187](../../../app/utils/chat/workspace-document-change.ts:187), [atomic checkpoint write:219](../../../app/utils/chat/workspace-document-change.ts:219), [normal revision wrapper:190](../../../app/db/document-revisions.ts:190). **Evidence: source.**

Workspace chat Apply/Undo correctly writes its checkpoint, changed document, and receipt atomically. However, it calls `prepareDocumentRevision()` and writes the prepared rows directly; it never runs the pruning performed by `createDocumentRevision()`. No other caller schedules pruning for these successful actions. Repeated actions against an unopened document can accumulate history indefinitely instead of respecting the documented retention target.

**Fix:** schedule bounded retention after a successful action, while preserving the atomic write. Define receipt-aware pinning before pruning: deleting the checkpoint referenced by a still-supported Undo receipt would break Undo. Verify retention through the real Apply/Undo entry points, not just the revision helper.

### DE-18 — P2 — An open editor can expose trashed document text to chat tools

**Location:** [openPaneContext:219](../../../app/utils/documents/document-chat-tool-execution.ts:219), [chatToolRun:390](../../../app/composables/documents/useDocumentAiAgent.ts:390), [fallback mention search:43](../../../app/utils/documents/document-ai-context.ts:43). **Evidence: runtime read-only agent boundary plus source-traced Trash route.**

For an inactive document, the chat context path reads through the visibility-filtered CRUD helper. For a mounted editor, it uses the live session directly. `chatToolRun()` does not enforce the read-only/availability option, so retaining a read-only editor after Trash does not stop it from supplying its content to chat. The fallback mention search also filters only `deleted`, not full workspace-item visibility.

**Reproduction:** configure the real agent read-only and make the editor noneditable as the root does; `getChatContext()` still returns the document body. Source tracing shows the mounted Trash editor reaches this branch. Acceptance has separate read-only guards, so this is not a claim that the tested path writes through Trash.

**Fix:** distinguish unavailable/trashed from intentionally readable read-only content, and enforce availability at every live-session context/tool entry point. Check the originating workspace and current row before returning text. Reuse the canonical visibility predicate in fallback mention search.

### DE-19 — P2 — Automatic checkpoint failures disappear without a recovery signal

**Location:** [DocumentEditorRoot.vue:637](../../../app/components/documents/DocumentEditorRoot.vue:637). **Evidence: source.**

After the body saves, automatic history creation catches any checkpoint failure and converts it to null. That is indistinguishable from “identical snapshot; no new revision needed.” It neither exposes a history failure nor schedules a retry independent of further editing. A worker/storage failure can therefore leave the body saved but history absent while the UI offers no indication that protection failed.

**Fix:** track local-body durability separately from history health. Preserve and surface a checkpoint error, provide a bounded retry, and retain the snapshot intended for that retry. Avoid retry storms and avoid rewriting a newer state under an older checkpoint's label. Exercise successful body save followed by failed history storage.

### DE-20 — P3 — An open history panel never notices automatic or externally added revisions

**Location:** [DocumentHistoryPanel.vue:109](../../../app/components/documents/DocumentHistoryPanel.vue:109), [subscriptions:194](../../../app/components/documents/DocumentHistoryPanel.vue:194). **Evidence: source.**

History loads on mount, document/workspace change, and manual Save version. It does not subscribe to revision writes or refresh after an automatic/AI checkpoint. Leave the panel open while a new version is created and it keeps showing the old list, potentially “No saved versions yet,” until remounted or manually refreshed through another action.

**Fix:** add an owner-scoped revision invalidation subscription or a bounded live query. Refresh only when the relevant document's revision set changes; do not repeatedly decode all history on unrelated posts writes. Preserve the selected preview when it remains valid.

## Additional hardening gaps requiring dedicated qualification

These are source-supported risk areas, **not additional demonstrated failures counted in the 20 findings**.

- **History decode/resource bounds:** [listCompleteDocumentRevisions:130](../../../app/db/document-revisions.ts:130) loads and decodes every manifest concurrently. [revision-codec.ts:50](../../../app/utils/documents/revision-codec.ts:50) collects an entire decompressed stream before checking its hash, and [the worker client](../../../app/utils/documents/revision-codec-client.ts:43) has no operation deadline/cancellation. Encoded retention size is not a decompressed-memory limit. Qualify bounded decode sizes, decompression ratios, chunk counts, worker failure, and cancellation before claiming imported/synced history is safe under hostile or very large inputs. No OOM/crash was intentionally induced.
- **Large-document find/replace:** [searchMatches:1646](../../../app/components/documents/DocumentEditorRoot.vue:1646) synchronously scans all text blocks and materializes every match per query/content change. Replace All builds a transaction containing every replacement. Qualify sustained typing, large tables, repeated-character searches, responsiveness, and undo memory; no latency threshold was measured here.
- **Extension/schema recovery:** validate load/export/restore with a removed, renamed, failed, or upgraded custom node/mark. Strict schema checks are useful, but users also need a way to preserve/export original content when the matching extension is unavailable. Do not silently strip unknown content to make loading succeed.
- **Orphan cleanup integration:** the production tree defines `repairOrphanRevisionChunks()` but contains no call to it. The public guide tells import callers to invoke it. Verify real import/bootstrap lifecycle wiring and concurrency before relying on orphan cleanup, including partially delivered manifests and the seven-day grace period.
- **Browser coverage still needed:** run the existing recovery/polish harness after the source launcher starts reliably, then add genuine keyboard/IME/touch, clipboard/drop, navigation during failed saves, offline blob retrieval, workspace/account switches during AI/history work, and multi-provider size/partial-sync cases. The audit's jsdom and fake-indexeddb results do not substitute for browser lifecycle or live-provider qualification.

## Repair order and acceptance bar

1. **Stop unsafe replacement/deletion:** DE-01 through DE-04. Capture correct versions, serialize mutations, and validate deletion ownership/completeness inside the authoritative boundary. These should be fixed before layering more editor features on top.
2. **Restore workspace and recovery safety:** DE-05 through DE-09 and DE-18. Preserve raw/draft data, isolate settings, derive file ownership after hooks, and provide explicit conflict/error recovery.
3. **Make review operations deterministic and retryable:** DE-10 through DE-12, DE-14, and DE-15. A visible lock must block all mutation paths, equivalent acceptance choices must give equivalent content, and failure must leave a recoverable state.
4. **Make storage/export promises honest:** DE-13, DE-16, DE-17, DE-19, and DE-20. Preserve images, bound cloud/history behavior, and expose whether history is healthy.
5. **Qualify the remaining resource and browser boundaries.** Reuse the canonical test owners and named browser harnesses. Turn each audit reproduction into a regression for the corrected contract rather than permanently preserving tests that expect the bug.

The architecture already has useful boundaries: captured DB handles in many document paths, optimistic write refusal, editor leases for host Apply/Undo, explicit schema/link validation, image ownership checks, and atomic workspace receipts. The hardening work should make these boundaries consistent. A wholesale editor rewrite is not justified by this review.

## Limitations and change status

- No fixes, version changes, publishing, deployments, or data migrations were performed.
- Runtime probes used synthetic content and disposable storage; AI model/tokenizer and selected I/O boundaries were controlled. No paid model call or live cloud mutation was used to prove a finding.
- The Chromium harness could not complete startup. Its failure is recorded as an environment/launcher limitation, not attributed to the editor.
- No new full-project typecheck or full test lane was run because production contracts/source were not changed. Existing targeted suites and the isolated audit probes were run.
- Concurrent changes to the root `dumb-issues.md`, `audit-evidence/sync-review-20261024/`, and `docs/reports/chat-system-2026-10-24/` were left untouched.
- The findings are tied to the inspected commit and current source. They do not establish that all possible defects have been enumerated.
