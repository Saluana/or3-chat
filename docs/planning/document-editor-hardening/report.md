# Document editor hardening implementation

Branch: `codex/document-editor-hardening`.
Base: `8e8557404d91eb6057a1d8d49faf9f7de6f34230`.
The original review is preserved in `app/components/documents/dumb-issues.md`;
its findings describe the baseline, not the implementation below.

All 20 numbered findings have implementations and production-boundary regression
coverage. No sync wire protocol or database authority was changed.

| Finding | Implemented behavior | Primary regression boundary |
| --- | --- | --- |
| DE-01 | Snapshot versions remain frozen through preflight/generation; stale proposals cannot apply. Acceptance also checks editor/workspace/account ownership. | Real AI agent + TipTap |
| DE-02 | Restore validates content, locks preparation, and refuses intervening body/title/scope changes. Failed restores remain visible. | Mounted editor + IndexedDB |
| DE-03 | Pruning validates canonical chunk IDs, types and parent ownership and fences assessed rows before deletion. | Real revision rows + unrelated document |
| DE-04 | Only complete, checksummed history qualifies for retention; partial deliveries get grace; no readable history means no deletion. | Complete checkpoint + missing-chunk manifests |
| DE-05 | AI settings loads, writes and queues are scoped to the originating database; switched-scope writes fail. Read errors remain retryable. | Deferred settings I/O and workspace switch |
| DE-06 | Malformed JSON or unavailable schemas preserve original bytes and enter recovery with raw download and retry. | CRUD + mounted recovery view |
| DE-07 | Final content determines image ownership after create/update mutation hooks. | Real CRUD + hooks + IndexedDB |
| DE-08 | Save local copy and reload preserves the draft in Files, retains other panes' pending state, and rebases the original without overwriting the committed row. | Mounted stale buffer and two real browser tabs |
| DE-09 | Storage read errors propagate to retryable load state rather than appearing missing. | Failed IndexedDB read + UI retry |
| DE-10 | Toolbar, title, dialogs and plugin button actions respect the editor review/restore lock. | Mounted toolbar event |
| DE-11 | Partial approvals reconcile the accepted subset in original proposal order in one transaction. | Real agent accepting append hunks in reverse order |
| DE-12 | Applied-but-unsaved acceptance retries durability without duplicating content or invalidating itself; successful acceptance clears review. | Real agent + injected persistence failure |
| DE-13 | Markdown exports embed local image bytes and escaped presentation attributes; unavailable images fail the export. | Real serializer + blob I/O |
| DE-14 | Timeout retires and aborts the request, clears loading, and permits the next edit to request again; obsolete completions cannot clear newer results. | Hung stream + subsequent real editor edit |
| DE-15 | Inline buttons act on semantic click; pointer-down only preserves selection. | Real widget; Chromium Enter/Space |
| DE-16 | Saved payloads above the shared 256 KiB ceiling show an explicit local-only warning and image-preserving export/split recovery. Content is retained intact. | Oversized real IndexedDB row + mounted editor |
| DE-17 | Chat Apply/Undo invokes shared retention after atomic commit; currently valid Undo receipts pin their checkpoint under the deletion lock. | Real chat Apply/Undo and stored receipts |
| DE-18 | Mounted context/tools verify canonical availability; fallback mentions exclude Trash and unsupported item state. | Registered tools + real stored visibility state |
| DE-19 | Automatic checkpoint failures have independent visible health, bounded retries and explicit retry. One immutable failed snapshot remains owned across newer edits. | Mounted editor + failed checkpoint followed by newer typing |
| DE-20 | Open history follows relevant revision writes and scope changes while preserving valid previews. | Mounted history + external checkpoint write |

Browser qualification also exposed and repaired a queued quick-action lost update:
field changes now rebase by stable action ID when their serialized write runs.
Native hydration is validated explicitly without imposing incompatible strict HTML
parsing on otherwise valid programmatic table insertion.

## Validation

- Focused document/editor surface: **221 tests passed across 37 files** after all
  fixes, including the retained-checkpoint and queued quick-action follow-ups.
- Supported Nuxt type check: **passed** with installed local auth/SQLite provider
  configuration. Default Cloud configuration lacks credentials in this new
  worktree. No production credentials were used.
- Changed-file ESLint, documentation checks and `git diff --check`: **passed**.
  Documentation validation covered 115 files, 103 mapped routes and 20 checked
  examples. The final diff and all 20 finding-to-regression mappings were reviewed.
- Chromium: **25 document journeys passed**, including all **13 document recovery
  cases**, native Enter/Space, two-tab conflict recovery, table content and queued
  quick-action persistence after reload. External network requests in the
  recovery fixtures were denied.
- Final browser artifacts: `test-results/document-editor-hardening/journeys-final/`.
- Final validation logs: `test-results/document-editor-hardening/validation/`.
- The broader mixed chat/storage recovery command was started earlier and hit
  two chat-draft restoration failures before it was stopped. This report does not
  claim that broader lane is green or establish whether those failures predate
  these changes. Its artifacts remain in `test-results/data-loss-recovery/`.

The focused suite used the repository's `bun run test` with document components,
composables, CRUD/history, utilities, AI-hunk/autocomplete plugins and Markdown
compatibility paths. Browser qualification used:

```sh
bun run test:e2e:journeys --grep 'production-document-journey' --workers=1 \
  --output=test-results/document-editor-hardening/journeys-final
```

Commands used the cached Bun 1.3.14 runtime and supported development wrappers.
Type checking selected `basic-auth`/`sqlite` with sync, storage and background
streaming disabled. Existing duplicate plugin auto-import warnings remain.

The initial hardening batch had 760 additions/346 deletions in production/tooling and 548
additions/12 deletions in tests/support, counting new files. Documentation and the
historical review are separate. No test-only production injection seam was added.

## Manual testing follow-ups — 2026-10-25

- Tables use a shared visible grid, stay inside the document column beside either
  sidebar, and scroll internally for wide columns. Header shading is distinct from
  the first data row; outer and internal borders are drawn once.
- Inserted dividers retain an opaque line at least 1px wide when a theme removes
  subtle decorative borders. Light and dark appearances were inspected.
- Image selection no longer opens the text-formatting popup. Real text selection
  still opens it. The image toolbar labels resizing with an icon and percentage,
  provides left/center/right alignment, and wraps within the document column.
- Native image alignment defaults to center for existing documents, persists
  across reloads, and is preserved in image-embedding Markdown downloads.
- Final follow-up validation: **245 tests in 38 files passed**, **27 document
  Chromium journeys passed**, and type checks, changed-file lint, documentation
  checks and diff checks passed. The popup regression was demonstrated failing
  on the original behavior before reapplying the fix.
- Artifacts and final logs:
  `test-results/document-editor-hardening/image-controls-final/`.

## AI acceptance and formatted review follow-up — 2026-10-25

- Fixed the reported `DataCloneError`: revision-worker requests now detach nested
  Vue proxies through the existing JSON wire format before dispatch. Synchronous
  dispatch failures release their pending callbacks and leave acceptance retryable.
- The dock's per-hunk Accept handler consumes rejected acceptance promises while
  retaining the visible error and proposal. Retrying clears the previous error;
  a failed checkpoint cannot apply the proposed content.
- Removed/added panes serialize native nodes and marks through the installed
  editor schema. Headings, paragraph spacing, emphasis, lists and other native
  formatting survive collapse/expansion without a plaintext or Markdown round trip.
  Preview links and checkboxes do not act as document editing controls.
- Regressions first demonstrated the nested-proxy clone failure and missing
  heading markup. A browser failure-and-retry case also exposed a stale error
  after a successful retry; it now passes.
- Final validation: **248 tests in 39 files passed**, **30 document Chromium
  journeys passed**, and type checking, changed-file lint, documentation and diff
  checks passed. Browser acceptance used the production editor session tool API
  to stage a proposal, then exercised inline Accept, dock Accept and Accept all.
  Each saved/read its original checkpoint through a real worker and retained the
  accepted formatting after reload. This did not make a paid inference request.
- Artifacts, screenshots and validation logs:
  `test-results/document-editor-hardening/ai-checkpoint-preview-final/`.

## Offline autocomplete follow-up — 2026-10-25

- Autocomplete now checks the browser's offline hint before scheduling inference
  and after loading its prompt. Disconnect events abort the active stream, clear
  its suggestion/loading state and retire queued requests. A brief disconnect
  cannot replay an old debounce, and late results/errors cannot affect a newer
  request after reconnecting. The event listener is removed with its editor.
- New online typing resumes suggestions. Reconnection alone does not replay
  offline edits. Local document editing and persistence remain independent.
- Fixed a second defect exposed by the logs: network errors no longer cache the
  server route as unavailable for 15 minutes. Only an unmarked missing-route
  404/405 does that. A failed server fetch cannot trigger direct fallback while
  the browser reports offline; permitted online fallback remains available.
- Six regressions failed before the fixes for the intended connectivity,
  cancellation and cache behaviors. Final focused validation: **83 tests in
  three files passed**, plus the credential-eligible Chromium offline/reconnect/
  reload journey. It observed zero offline inference requests and one scripted
  server-route request after new online typing, without making a paid request.
  Type checking, changed-file lint, documentation and diff checks passed.
- The supplied log's repeated `PageShell` resolution messages are development
  debug output. The excerpt contains autocomplete transport failures, with no
  evidence of a document-save or revision-checkpoint failure.
- Validation logs and browser evidence:
  `test-results/document-editor-hardening/autocomplete-offline/`.

## Document AI offline recovery follow-up — 2026-10-25

- Document AI blocks new inference while the browser reports offline. The
  composer keeps its prompt, attachments and references; saved/plugin actions
  share the same submission guard. Reconnect enables manual Send without
  replaying interrupted or offline requests.
- Preparation now has its own cancellable status and a controller before the
  first asynchronous operation. Disconnect and scope teardown retire active
  work, unlock the editor and prevent obsolete results, status callbacks and
  token estimates from changing a newer request. Preparation errors follow the
  normal error/cleanup path. The tool loop checks cancellation between streamed
  events, tool dispatches and model turns; registered tools still receive the
  existing abort signal for cooperative cancellation of work already dispatched.
- Model metadata loads from the local cache when mounted offline and refreshes
  on reconnect. Local reference lookup, settings and token estimates remain
  available. Offline token estimates use the existing character approximation
  rather than attempting to download the exact tokenizer into a worker.
- Existing suggestions remain reviewable offline. A browser test exposed a cold
  revision-worker fetch preventing Accept all from saving its safety checkpoint.
  Offline revision reads/writes now use the already-loaded codec, preserving the
  same encoding, checksum and local persistence contracts.
- Eight owner-boundary regressions failed before the agent/loop fixes. Browser
  regressions separately reproduced the offline tokenizer download and failed
  cold-worker checkpoint. The repaired browser flow starts offline, retains an
  image attachment and prompt through an interrupted request, confirms no
  automatic replay, retries online, accepts offline, and retains the accepted
  heading after reconnect/reload. All responses are scripted locally; no paid
  provider request or persisted credential was used.
- Validation: **326 tests in 41 files passed**, followed by **65 focused tests
  in 14 files** after the codec fallback. All **31 document Chromium scenarios**
  were verified: the final broad run passed 30, with an existing text-selection
  test racing asynchronous image intake. Waiting for the image to finish
  inserting fixed its setup; that scenario and the offline AI journey both
  passed the targeted rerun. Type checking, changed-file lint, documentation and
  diff checks passed.
- Evidence: `test-results/document-editor-hardening/document-ai-offline-verified/`,
  `test-results/document-editor-hardening/document-ai-offline-rerun/`, and
  validation logs in `test-results/document-editor-hardening/document-ai-offline-logs/`.
  The existing development server remains at `http://127.0.0.1:3017/` (HTTP 200).

## Blank keyboard focus follow-up — 2026-10-25

- Blank now uses the same themed inset outline for native and Nuxt UI buttons,
  links and tabs. It honors the saved focus-width preference, removes competing
  focus halos and restores full opacity on focused toolbar controls. Keeping the
  outline inside each control prevents clipping by sidebar and tab/toolbar scroll
  containers.
- Primary chat/document/project buttons paint around the visible row. Menu and
  pin buttons retain their own indicator without also outlining the entire row.
  Project toggles now fit their Blank container height, fixing a second source
  of clipped bottom edges.
- Browser baseline checks reproduced clipped category/tab outlines, incomplete
  row indicators and inconsistent focus colors. The final regressions exercise
  actual keyboard focus in light/dark mode, 1440px/1000px layouts and saved 2px/4px
  focus preferences, including secondary sidebar actions. Screenshots were also
  visually inspected.
- Validation: **43 tests in four files passed**, all **33 document Chromium
  scenarios passed**, and type checking, changed-file lint, documentation and
  diff checks passed. The development server remains available at
  `http://127.0.0.1:3017/` (HTTP 200).
- Evidence: `test-results/document-editor-hardening/blank-focus-verified/`,
  `test-results/document-editor-hardening/blank-focus-suite/` and validation logs
  in `test-results/document-editor-hardening/blank-focus-logs/`.

## Qualification limits

This closes the 20 numbered findings; it is not a guarantee against every future
failure. Live provider/paid-network behavior was not exercised. The shared cloud
row ceiling remains unchanged: oversized documents require export or splitting.
The original review's separate concerns about decompression/resource bounds,
worker cancellation/deadlines, very large find operations and orphan cleanup
integration remain follow-up qualification work. No release, deployment, package
publication, destructive migration or live-data replacement was performed.
