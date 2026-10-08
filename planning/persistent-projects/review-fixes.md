# Review fixes

## Follow-up review: 38 findings

The follow-up code-only review found remaining issues below. These are additional
to the original 29-item campaign. Every item remains in scope; passing a narrow
regression is not final browser/cloud acceptance. No merge or publication.

Current status: 36 follow-up findings have implemented local repairs, one is a
provider release dependency (1), and one was retracted (38). The Workflows repair
also requires installing the qualified candidate into the target app. Earlier
batch counts below are historical receipts, not the current outstanding count.

| # | Finding | State |
| --- | --- | --- |
| 1 | Installed provider ownership contract | Release dependency; SQLite/Convex source contracts are implemented in their isolated worktrees. Installed SQLite 0.0.14 and Convex 0.0.11 do not contain the contract, so unsupported server project execution refuses |
| 2 | New background chat admission ordering | Implemented; first-turn canonical admission precedes ownership checks, rejection persists a terminal snapshot, admitted ordinary/project control regressions pass |
| 3 | Cross-project branch/summary ancestry | Implemented; shared canonical projection checks reference ancestors and recursive summary provenance against nullable owner/exclusions; three real context/read leakage regressions refuse; retained deletion control passes |
| 4 | Project family foreign mutation target | Implemented; explicit/legacy foreign roots no longer supply header title/original actions; same-project root control and existing mounted family actions pass |
| 5 | Legacy document commit authorization | Implemented; registered create/copy move regressions pass; final browser coverage pending |
| 6 | Omitted nullable-owner registry fence | Implemented; ordinary native/legacy move regressions and compatibility lane pass |
| 7 | Read/proposal receipt commit authorization | Implemented in their shared persistence boundary; real registered read move/control cases pass |
| 8 | Hookful helpers inside outer transactions | Implemented for membership, ordinary forks, message appends/tool transcripts, intake/catalog/prepared-post ownership and message attachment references; asynchronous hooks prepare before writes and notify after the outer commit. Connected suites and configured typecheck pass |
| 9 | Workflow inference/write ownership | Implemented and qualified in the host and isolated Workflows candidate; SDK HTTP fetch fences cover foreground models, captions, server jobs and retries with immutable run identity. Candidate typecheck, build, four controller/route cases and packaged archive pass; installation/publication remains separate |
| 10 | Background resumed execution ownership | Implemented; resumed tool/no-tool jobs and every model iteration recheck canonical ownership immediately before fetch; move-between-iterations regression passes |
| 11 | Extracted-file tool pagination | Implemented; registered file reads reconstruct multibyte extraction exactly and reject replaced-extraction cursors; binary originals never supply extraction offsets |
| 12 | Project CRUD captured authorization | Implemented; four workspace-switch and four viewer-write refusal cases pass. Chrome CRUD/navigation journeys pass; installed cloud viewer/revocation boundaries pass |
| 13 | Stale whole-project rewrites | Implemented; narrow rename/fresh document association preserve concurrent membership; title synchronization reads fresh rows within its transaction |
| 14 | Reactive inherited model selection | Implemented; policy changes/moves update inherited choices; explicit overrides survive; reset resumes inheritance across remounts. Chrome settings/reload journey passes |
| 15 | Draft restoration persists model override | Implemented; existing-chat drafts restore text without altering durable or inherited model preferences; pre-chat restoration remains supported |
| 16 | Recovery effective retrieval query | Implemented; filtered project recovery reproduces baseline false context-change refusal and now preserves admitted query, body and durable IDs |
| 17 | Compaction nullable-owner inference fence | Implemented; real auxiliary dispatch move regression reproduced baseline inference after ordinary owner move; 25 summary cases pass including SSR transport controls |
| 18 | Knowledge promotion during lossy confirmation | Implemented; promotion follows successful preparation and omission consent; two actual native rejection regressions pass |
| 19 | Intake cancellation/state on sidebar navigation | Implemented; intake retains its captured scope across navigation; abandoned Processing revisions become retryable after 45 seconds without writes through read-only/revoked scopes. Chrome PDF/DOCX/retry/replacement journey passes; occupied intake controls cannot start a silently discarded upload |
| 20 | Knowledge completion clears newer draft | Implemented; note/document/file completion retains a newer draft or picker selection; three mounted races pass |
| 21 | Note creation/binding partial commits | Implemented; prepared note and source binding commit atomically with membership/references; refusal saves no orphan and retains draft |
| 22 | Hidden activity subscription | Implemented; kept-alive activity unsubscribes while hidden, fences late results and refreshes on activation |
| 23 | Home project query bound | Implemented; Home queries six live projects; search and the project picker load the full catalog only when needed |
| 24 | Project activity workspace-wide scans | Implemented; project activity and expanded families query owning chats and direct document/legacy members without hydrating unrelated rows |
| 25 | Ordinary ownership full-project scans | Implemented; local version-26 multi-entry membership projection supports indexed nullable/legacy ownership, ambiguous-owner refusal and sanitized remote/restored writes |
| 26 | Full-file retrieval work per send | Implemented; title-prioritized automatic extraction search decodes at most 8 MiB per turn, retains late-file facts within budget and records unsearched sources; required sources retain full admission |
| 27 | Continuity ranking before limit | Implemented; relevance outranks recency before the three-result limit, with provenance validation only for selected candidates |
| 28 | Relevant summary passage selection | Implemented; strongest bounded summary passage reaches context and receipt, including matches beyond the first 4,000 characters |
| 29 | Image-only DOCX readability state | Implemented; actual Mammoth browser parser refuses empty/image-only DOCX and marks text with media partial |
| 30 | Unsupported server tools in settings | Implemented; server-owned tools are unavailable in project settings with an explicit browser-boundary explanation; actual mounted view regression passes |
| 31 | Aggregate receipt storage budget | Implemented; shared aggregate preview budget accounts for JSON/iteration metadata and preserves evidence identities; 500-memory actual dispatch succeeds without altering provider input |
| 32 | Prepared versus dispatched receipts | Implemented; uniquely identified request iterations record prepared/dispatched/accepted/failed at real transport boundaries, with guarded updates and normal failed-empty-response cleanup |
| 33 | Installed-artifact qualification lane | Implemented; installed exact provider pins are default, source links/pin mismatches refuse, development overlays require an explicit separately labeled flag. Installed Basic Auth + SQLite 0.0.14 + filesystem 0.0.9 cloud profile passes both Chrome journeys; this smoke shares transitive dependencies and is not a clean release gate |
| 34 | Global disablement bypass in legacy tool execution | Implemented; direct disabled-handler and disable-during-document-preparation regressions failed before repair and pass afterward |
| 35 | Full-project hydration at tool authorization boundaries | Implemented; fresh policy-only reader at registry/approval/execution/delivery boundaries; targetless tools hydrate no source/memory inventory and targeted authorization checks only the requested member |
| 36 | Continuity validation work bound independent of valid-result count | Implemented; candidate attempts and aggregate provenance work are bounded independently of accepted summary count; invalid and oversized evidence regressions pass |
| 37 | Time-grouped activity drops family action payload | Implemented; actual mounted time-grouped list forwards rename/delete payloads unchanged; pre-fix regression emitted the compaction ID instead of the original |
| 38 | Home project projection retains unavailable file metadata | Retracted after actual rendered-boundary qualification: visible child query already observes file metadata and hides unavailable files. Corrected regression proves deletion/restoration with aliases and unchanged durable membership |

The latest code-only review also identified stale completion claims in
`tasks.md`; qualification claims must be corrected alongside the relevant work,
including the installed-artifact cloud lane and remaining read-only/browser
checks. Phase 3 remains contracts, not delivered collaboration/import features.

Latest bulk execution/artifact stage (2, 9, 10, 33): **92 passed** across five
connected host/server/provider-resolution suites. Canonical first-turn admission
precedes the background ownership check; rejected admission leaves a terminal
job. Resumed jobs, tool iterations, workflow models and image captions recheck
captured ownership and authorization at each actual SDK/fetch boundary, including
retries. Configured Nuxt typecheck and documentation checks pass.

The isolated Workflows source candidate is
`../or3-plugin-workflows-projects` (preserved 0.1.1 baseline; the user's separate
0.2.0 checkout was not changed). Its **four controller/route cases**, typecheck,
build and pack pass. Archive:
`output/workspace-assistant-files/review-fixes/workflows-0.1.1-projects.1.zip`.
Package content digest:
`sha256-f754e88d27afcb150b891ae028d3f288b107b779b246fc6b10e25fb1b9bc4af6`;
manifest digest:
`sha256-832b5d07c8da4c3b17f7bdb939eaf13419b311fb98fcf629d27916dbccb807ee`.
ZIP SHA-256:
`b6e810195b59c938233a1d6dbba40bc420137154be06455db0271b90a45363e2`.
Older installed Workflows artifacts without run origin refuse safely; the local
candidate has not been installed or published into the user's existing app.

Final Chrome qualification: **six journeys passed in 47.1 seconds**, with traces
and screenshots in `output/workspace-assistant-files/review-fixes/chrome-accepted`.
An earlier cold dev failure coincided with concurrent Nuxt generation; the repeat
exposed an intake control race rather than a DOCX parser failure. The held-worker
regression failed before the control repair; **eight mounted intake cases pass**
afterward. The journey now waits for actual input availability between uploads;
no timeout was increased. Empty memory saves are disabled. Manual Chrome checks
also cover settings save, decision create/edit, note intake and entry-aware back
navigation, with no errors in the real app console. Paid inference and credentials
were not used.

Installed cloud qualification: **two Chrome journeys passed in 44.5 seconds**,
including file/project backup round trips, new-device reads, workspace isolation,
viewer write refusal and membership revocation. Provider versions and temporary
data removal are recorded in
`output/workspace-assistant-files/review-fixes/cloud-sqlite-fs-installed/profile.json`.
Finding 1 remains a release dependency; no installed Convex qualification or
server-side project execution is claimed. Installed providers without the
ownership marker also cannot authorize ordinary server tools/background jobs;
the provider release is required for those paths. Projects continue to use their
browser execution boundary. Nothing merged or published.

Final production build passes with Basic Auth, native SQLite, filesystem storage,
managed registration and disposable database/storage paths. Both Nuxt output and
the built-in/V1 plugin bundle check pass. The first build attempt lacked the
filesystem provider's required build-time configuration; supplying the disposable
profile corrected it without code changes. The existing trusted-host ModuleV2
UI rebuild qualification remains unproven and is not claimed by this build.
Final changed-diff inspection and `git diff --check` pass.

Settings/receipt batch (30–32): mounted server-tool availability, 500 saved memories and held/successful/failed native transport reproduced their pre-fix failures. **161 passed, 1 existing skipped**, four connected suites. Configured typecheck and documentation checks pass. Failed empty responses keep their normal cleanup; the error hook observes the failed diagnostic state before removal. Evidence identity manifests are never discarded merely to meet the preview target. Remaining implementation findings: **5** (1, 2, 9, 10, 33), plus final browser/cloud/read-only qualification. No merge or publication.

Knowledge batch (18–21, 29): rejected native preparation/consent, three mounted draft races, orphan-note rollback, expired Processing and the actual DOCX browser parser reproduced failures before repair. **104 passed, 1 existing skipped** across three connected suites. Configured typecheck and mapped documentation checks pass. Navigation timers retain one visible refresh; no embeddings or merge.

Sidebar/retrieval batch (22–26, 35–36): actual kept-alive and Home views, scoped activity, real legacy ownership/index migration, lightweight authorization, invalid/oversized continuity and extraction decoding reproduced their failures before repair. **215 passed, 1 existing skipped** across nine connected suites including deletion/fork lineage. Configured typecheck, documentation checks and changed-diff inspection pass. Version 26 derives local membership lookup keys without changing canonical clocks/data; sync strips them. Remaining follow-up implementation findings: **8** (1, 2, 9, 10, 30–33), plus final browser/cloud/read-only qualification. Published registry versions are SQLite 0.0.14 and Convex 0.0.11; neither carries the new ownership contract. No merge or publication.

Bulk transaction batch (8): ten new real-Dexie regressions reproduced failures
before repair across both ordinary forks, message append and seven file ownership
paths. The bulk implementation separates hook preparation, guarded atomic row
writes and post-commit notifications across those callers, including cross-thread
tools and foreground tool transcripts. Forks recheck source state/ownership/root;
attachments recheck their message and release provisional Blob references on
failure. Notification failures report the problem without inviting duplicate
retries of durable writes. Connected suites: **212 passed, 1 existing skipped**
over eleven files. Configured Nuxt typecheck, documentation check and final diff
inspection pass. Remaining follow-up findings: 20, plus final browser/cloud and
read-only qualification. No merge or publication.

Fourteenth follow-up batch (project reference portion of 8): three real source
save cases reproduced inactive IndexedDB transactions before repair when a
reference hook awaited a timer (including the later-missing-hash rollback case).
After repairing source saves, two added soft/hard project deletion cases
independently failed at the same still-unrepaired nested notification boundary.
All five cases now pass. The shared hook-free `changeFileRefRows` writer retains
existing classification, clocks and clamped reference-count semantics, returns
the existing typed hook payload, and requires the caller's captured read/write
transaction. Source save and deletion collect those payloads inside their atomic
write and notify after the outer commit. Failed writes emit none; failed
reference notifications report an error without failing a committed operation.
The existing hookful helper reuses the row writer without changing its callers'
notification timing; other nested callers remain in the audit scope.

Connected source/intake, file attachment/deletion/restore, message reference
ownership and workflow-host suites: **83 passed**, seven files, no skips.
Configured Nuxt typecheck and mapped documentation checks pass. Changed
production/test/documentation diffs inspected; `git diff --check` passes.
No dependency or schema changed. Finding 8 remains open for branch/message and
other nested helper paths. Remaining follow-up findings: 21, plus final
browser/cloud/read-only qualification. Nothing merged.

Thirteenth follow-up batch (38 qualification): the old test again reproduced
its failure (7 passed, 1 failed), but inspection of the actual Home rendering
path showed that it asserted the wrong contract: raw project membership is
intentionally retained, while SidebarProjectsSection's expanded-child query
already reads and observes file metadata. The strengthened existing test mounts
the sidebar-to-displayed-project-to-real-section path, stubbing only child-row
presentation. It proves metadata deletion hides the file shortcut, metadata
restoration returns its saved alias, and durable membership is unchanged.
The fixture disables attribute fallthrough so the sidebar's collapsed expansion
state cannot override its explicit expanded-project setup. No production change
was needed. Finding 38 (and item 13 of the latest review) is retracted, not
declared repaired or waived.

Complete sidebar, project persistence and mounted intake integration suites:
**28 passed**, no filtered cases or skips. Configured Nuxt typecheck passes.
The changed test diff was inspected; `git diff --check` passes. No public behavior
changed, so this batch does not add documentation or rerun its unchanged checker.
The latest review's nested file-reference hook concern is explicitly retained
under finding 8. Remaining follow-up findings: 21, plus final browser/cloud and
read-only qualification. Nothing merged.

Twelfth follow-up batch (37): extended the existing family-action regression to
mount the actual time-grouped list and its real family child, with real Dexie
discovery. The initial fixture lacked the hook engine used by the live query;
after initializing that production dependency, the pre-fix regression emitted
`earlier` rather than `root` for rename. The repaired parent forwards rename and
delete payloads unchanged instead of substituting its displayed item. No new
production seam or duplicate regression was added.

Focused family cases: **6 passed**, 19 unrelated cases filtered out. Separately,
the complete project persistence and mounted intake suites: **20 passed**.
Configured Nuxt typecheck and mapped documentation checks pass. The changed
production/test/documentation diff was inspected; `git diff --check` passes.
The unavailable-file projection failure remains open as finding 38; this batch
does not claim the complete sidebar suite passes. Remaining follow-up findings:
22, plus final browser/cloud/read-only qualification. Nothing merged.

Ninth follow-up batch (4): both explicit/legacy foreign-root title/action cases
fail before the repair. Project headers now expose the original only when that
original passes project ownership/visibility checks, independently of query and
pinned filters. Otherwise the permitted member retains its title and target.
The same-project control and existing global family action/search cases pass.
Focused persistence and mounted family suites: **21 passed**, four unrelated
cases filtered out. A broader sidebar run had **24 passed, 1 failed**: unavailable
file metadata remains in Home's projection. That exact failure also reproduces
after temporarily removing only this batch's production guard; the repaired
file was restored afterward. It remains explicit follow-up 38, not a waived
check. Mapped documentation checks and configured Nuxt typecheck pass. Changed
production/test/documentation diff inspected; `git diff --check` passes.
Remaining follow-up findings: 23, plus final browser/cloud qualification.

Tenth follow-up batch (write portion of 9): the real workflow host ports
reproduced seven unauthorized writes before repair (foreign thread/stream,
deleted/non-workflow messages, owner moves and project image attachment); the
ordinary create/update and image reference controls passed. Four real-port
viewer/revocation cases also failed on the pre-fix host; unchanged editor
controls passed. A caller changing the submission before commit redirected the
write until entry snapshotting was added. The exposed scoped record update port
independently bypassed project/viewer/move checks (three failures, unchanged
editor control passes). Two invalid incoming-data cases reproduced message-type
corruption before the upsert input guard. All regressions use actual host ports,
Dexie records and PNG/file reference paths; UI-only dependencies are stubbed.

Writes now use captured workspace generation/permission, transactional nullable
ownership checks, preserved thread/stream identity and entry snapshots. Image
attachment rechecks the captured destination and releases a failed temporary
reference. Scoped record updates retain their original compare-and-swap
semantics inside the authorized outer transaction. No shared store API or
package dependency was added. Final connected workflow-host, trusted-record,
native admission and persistence suites: **124 passed, 1 existing skipped**.
The initial typecheck caught a fixture wrapper returning a plain Promise rather
than Dexie's PromiseExtended; the scheduling fixture now preserves that contract.
Configured Nuxt typecheck and mapped documentation checks pass. Final changed
production/test/documentation diff inspected; `git diff --check` passes.
Finding 9 remains open for raw inference/caption dispatch. The task checklist
now explicitly reopens incomplete background/workflow and final cloud/browser
qualification claims. Remaining follow-up findings: 23. Nothing merged.

Eleventh follow-up batch (navigation portion of 19): the actual kept-alive
Projects page left a source in Processing when hidden, when navigating Home,
and when selecting another project. All three cases fail before the scope
repair. Admitted intake now captures its own existing workspace operation scope
inside the page's error-handled action. Upload, saved-file intake and extraction
retry use that scope; view deactivation and project selection cannot cancel the
operation or retarget its binding. Workspace generation, authorization and
source compare-and-swap checks remain enforced by the existing boundaries.
The three mounted upload cases prove Ready is persisted in the original project,
the other project stays empty, and the source appears when returning to
Knowledge. The fixture waits for the reopened async view before navigating its
Knowledge link; earlier failures at that assertion were fixture ordering, not
failed persistence. No new job manager, exported API or dependency was added.

Connected mounted-intake, persistence and workflow-host suites: **42 passed**.
Configured Nuxt typecheck and mapped documentation checks pass; changed
production/test/documentation diff inspected; `git diff --check` passes. Finding
19 stays open for reload/revocation interruption-state qualification and final
Chrome coverage. Remaining follow-up findings: 23. Nothing merged.

Workflow inference contract discovery: the installed package's
`WorkflowExecutionPorts.createOpenRouterClient(apiKey)` and caption input carry
no originating thread/message. Its executeWorkflow caller does have messageId,
and its send controller has assistant.threadId/messageId before captioning.
The repair must pass those identities through the package ports, bind the host
client to that captured run, and fence every provider dispatch. Neither active
pane state nor the last workflow message/history lookup is a safe substitute
under concurrent runs. This requires qualifying the updated workflow artifact
alongside the host; the existing context-free client must not be declared fixed.

First follow-up batch: before repair, registered legacy create/copy and native
creation dispatched successfully after ordinary-to-project moves during document
preparation. A registered document read also persisted its manifest after an owner
move in a message hook. The unchanged receipt control passed. After repair:
10 targeted authorization cases pass; connected native/persistence suites report
67 passed, 1 existing skipped; legacy document suite 34 passed; registry
compatibility 8 passed. The compatibility/document fixtures now create actual
originating chats instead of referring to nonexistent IDs. Initial configured
typecheck caught two incomplete fixture rows (missing status/pinned); corrected
and configured Nuxt typecheck now passes. Mapped documentation checks pass
(110 files, 98 routes, 20 examples). Registry delivery uses its shared authorization
callback instead of repeating the same policy checks separately.

Final authorization batch verification: `bunx vitest run --project=app-integration
--project=core-app --project=plugin-compatibility
app/composables/chat/__tests__/useAi.context-admission.integration.test.ts
app/db/__tests__/project-workspace.integration.test.ts
app/utils/documents/__tests__/document-chat-tools.test.ts
app/utils/chat/__tests__/tool-registry-profiles.test.ts --bail=0 --reporter=dot`
reports **109 passed, 1 existing skipped**. Changed commit/registry/legacy write
diffs inspected; `git diff --check` passes. No completion claim for the remaining
30 follow-up findings or the campaign's final browser/cloud qualification.

Second follow-up batch (16–17): filtered project recovery failed on the baseline
with “Project context changed” despite unchanged policy/evidence. The checkpoint
now stores the admitted effective query and recovery retains its same message
IDs/body without rerunning filters. Eight targeted retrieval/recovery cases pass.
Auxiliary summary inference previously proceeded after an ordinary source moved
into a project at transport entry; the source chat and captured nullable owner
now reach the shared dispatch fence. Its real-transport regression refuses before
fetch. SSR auxiliary fixtures supply their actual origin session for the new
authorization boundary; all 25 summary cases pass. Configured Nuxt typecheck and
mapped documentation checks pass. Remaining follow-up findings: 28; final
browser/cloud qualification remains outstanding.

Final recovery/summary batch: `bunx vitest run --project=app-integration
app/utils/chat/compaction/__tests__/summary.integration.test.ts
app/composables/chat/__tests__/useAi.context-admission.integration.test.ts
--bail=0 --reporter=dot` reports **79 passed, 1 existing skipped**. Production
checkpoint/query and summary dispatch diffs inspected; `git diff --check` passes.

Third follow-up batch (12–13 and membership portion of 8): all ten CRUD cases
failed before repair (four workspace switches, four viewer writes, two concurrent
membership overwrites). Delayed membership hooks also reproduced a completed
IndexedDB transaction and a partial committed move on an invalid later target.
All twelve focused cases now pass. CRUD uses captured writable scopes; rename
rebases a narrow name patch, document creation/association commits atomically,
and title synchronization reads fresh rows in its write transaction. Membership
preparation and notification run outside the hook-free atomic batch.

Final connected native/persistence suites: **80 passed, 1 existing skipped**;
legacy document/tool suite: **34 passed**. Configured Nuxt typecheck and mapped
documentation checks pass; changed production diff inspected and `git diff
--check` passes. Finding 8 remains open for branch/message transactions. Remaining
follow-up findings: 26, plus final browser/cloud and read-only UI qualification.

Fourth follow-up batch (14–15): four actual-composable/composer regressions
failed before repair. Inherited model selection now observes singleton policy,
updates on project moves, and leaves explicit choices intact. Reset clears the
durable override through the guarded serialized KV writer and resumes inherited
selection after remount. Existing-chat draft restoration does not write model
preferences; the old variant restoration race fixture now correctly represents
an unsent pre-chat draft. Connected composer/settings/native suites: **91 passed,
1 existing skipped**. Configured Nuxt typecheck and mapped docs checks pass.

Fifth follow-up batch (34): disabled legacy direct calls still reached handlers,
and disabling a registered native tool during document preparation still saved
the document. Both regressions failed before repair. Enablement now applies
independently of admission at entry and guarded commit boundaries. The trusted
Document AI override remains explicit. Connected native/composer/settings,
registry compatibility and Document AI selection suites: **104 passed, 1 existing
skipped**. Selection tests do not prove Document AI override execution; that
boundary still needs direct qualification. Configured Nuxt typecheck and mapped
documentation checks pass. Changed model/composer/registry production diffs
inspected; `git diff --check` passes. Remaining follow-up findings: 25, plus final browser/cloud and read-only
UI qualification. No merge or publication.

Sixth follow-up batch (11): a registered project PDF read with a four-byte
binary original and multi-page extraction falsely returned no continuation on
the baseline. File reads now use current project extraction blobs, text byte
lengths and extraction-bound revisions. A real registered/Dexie regression
reconstructs every UTF-8 character and rejects its cursor after text-hash
replacement. Plain-text originals retain their own pagination path; binary
catalog-only prefixes stop honestly as partial, never switching to upload bytes.
Missing/deleted extraction bytes refuse rather than falling back. Ownership,
catalog and binding rechecks guard delivery. No new schema or blob ownership
model was introduced.

Connected native/persistence/document-tool suites: **118 passed, 1 existing
skipped**. Configured Nuxt typecheck and mapped documentation checks passed.
Final metadata-availability guard refinement: all **35 document-tool tests pass**.
Production paging/integration diff inspected; `git diff --check` passes.
Remaining follow-up findings: 24, plus final browser/cloud and read-only UI
qualification. Changes remain unmerged.

Seventh follow-up batch (27–28): the extended real Dexie/context-builder case
first selected three recent weak matches instead of an older three-term match.
After ranking repair it still failed because the matching August 2042 passage
occurred beyond the 4,000-character prefix. Both independent failures reproduced
before their owner repairs. Discovery ranks distinct matched terms before
limiting valid results, with recency as a tie-breaker; evidence validation stays
bounded to selected candidates. Existing lexical chunking selects the strongest
bounded summary passage for both messages and receipt. No embeddings/index or
new public API. Suggestion review keeps newest-first ordering; empty-query
retrieval still reads no historical evidence.

Connected native/persistence suites: **84 passed, 1 existing skipped**. Final
persistence suite after ownership recheck/sort simplification: **15 passed**.
Mapped documentation checks pass; production diff inspected and `git diff
--check` passes. Configured Nuxt typecheck passes. Remaining follow-up
findings: 22, plus final browser/cloud and read-only UI qualification.

Eighth follow-up batch (3): all three ancestry cases (reference, compacted,
inherited summary) returned foreign provenance on the baseline through both
normal context and workspace reads. The corrected local-workspace fixture and
temporarily restored pre-fix history implementation reproduced all six leaking
results without changing user edits. Both readers now share one authorized
projection, including recursive inherited provenance and project exclusions.
Retained summaries still work after original messages/thread tombstones are
deleted when ownership remains provable. Missing/cyclic/foreign provenance
refuses. The resolver's explicit includeDeleted option is provenance-only;
normal reads/mutations continue to refuse deleted chats.

Connected checks exposed missing project/post tables in the recovery transaction
and a whole-read Dexie.waitFor wrapper that stalled native retry. Hash waiting
now applies only to the crypto operation. Rolling compaction needed an explicitly
async parent transaction callback to retain native-async work. No timeouts were
increased. An old project compaction fixture now creates its claimed project and
checks all three committed outbox records (child, summary, membership). Local
history/fork fixtures explicitly choose local mode rather than claiming an
authenticated workspace without a session.

Final connected history/compaction/summary/native/document-tool suites:
**166 passed, 1 existing skipped**. Configured Nuxt typecheck and mapped docs
checks pass. The separately run ordinary-fork lineage suite: **10 passed**.
Production diff inspected; `git diff --check` passes. Remaining follow-up
findings: 21, plus final browser/cloud and read-only UI qualification. No merge.

Scope: all 29 findings in the October 6 code review. Changes remain unmerged.
“Implemented” is not final acceptance: connected browser/cloud qualification
and the complete final diff review remain required.

| Finding | Current state |
| --- | --- |
| 1 Provider ownership contract/pins | Pending; qualify published packages, not local overlays |
| 2 Approval authorization race | Gate reauthorizes after approval; registry rechecks registration/admission; send-to-thread checks inside its transaction. Ownership regression passes. Registry now supplies an immutable-argument/definition authorization callback; native document creation, project updates and send-to-thread recheck inside their transaction after preparation. Five registered-document control/race cases pass. Legacy writes and proposal-receipt boundaries still require audit |
| 3 Mutable sidebar operation target | Pin, exclusion, settings and brief saves capture scope/project. Memory review/save/edit, suggestion review, previews and downloads also capture scope/drafts; completion guards applied. Browser race proof pending |
| 4 Duplicate source bindings | Transaction rejects duplicate item bindings. Parallel-add regression passes; replacement/browser qualification pending |
| 5 Receipt inventory storage limit | Persisted receipts omit unused catalog records and retain an aggregate count; 300-source real dispatch regression passes |
| 6 Legacy chats in activity | Activity, expanded families and latest-compaction reads use unambiguous legacy membership; real Dexie regression passes. Family prefix bounds also fixed after an observed IndexedDB DataError |
| 7 Ordinary fork ownership | Both ordinary fork writers resolve and atomically retain project ownership/membership; reference/copy regression passes |
| 8 Deleted membership/partial CRUD | Captured CAS transaction applies only chat deltas, skips unchanged deleted associations and rolls back failed additions; regression passes |
| 9 Membership extension fields | Preserved across moves; real Dexie regression passes |
| 10 Persisted project model inheritance | Populated chats inherit project defaults; explicit model/variant stored per chat in existing workspace KV. Real mounted/Dexie navigation and remount regression passes; browser qualification pending |
| 11 Final-model image capability | Continuation consumes modalities captured by model readiness; normal sends build from captured state after outgoing filters and final model readiness. Canonical-slug/vision browser qualification pending |
| 12 Continuation retrieval query | Uses normalized preceding user intent; real provider-dispatch regression passes |
| 13 Continuation project preflight | Project snapshot passed through preflight; dedicated optional-context admission regression still pending |
| 14 Large-paste retrieval query | Extra text participates in retrieval; real provider-dispatch regression passes. Outgoing-filter prompt regression also passes |
| 15 Null-to-project preparation transition | Captured nullable owner checked before persistence and dispatch, including direct fallback, background retry and continuation. Normal preparation and continuation move regressions pass; recovery/browser qualification pending |
| 16 Reactive attachment ownership | Composer consumes shared live ownership and resets destination on moves/workspace changes; browser qualification pending |
| 17 Disable unavailable source | Implemented; real Dexie regression also checks re-enabling is refused |
| 18 Edit historical memory | Implemented; real Dexie regression checks edits succeed and foreign rebinding refuses |
| 19 Complete approval payload | Full arguments in bounded scrollable modal; browser qualification pending |
| 20 Pending settings save/newer draft | Save captures draft and retains dirty state for newer edits; browser regression pending |
| 21 Brief/settings isolation | Brief saves a brief-only patch; browser regression pending |
| 22 Busy context selector | Disabled during conflicting work; browser qualification pending |
| 23 Per-message ownership subscriptions | Chat container provides one ownership subscription to all messages and composer; rendered-query count/browser qualification pending |
| 24 Hidden sidebar broad reads | Hidden page unsubscribes; selected-project view skips all-project catalog; documents/files/chat catalogs load only for open pickers/management. Active Projects list still reads its virtualized catalog; browser performance proof pending |
| 25 Unbounded continuity validation | Uses indexed project threads plus legacy member lookups, captured settings, relevance-before-evidence validation, cancellation and a three-result bound. Empty/matching-query evidence-read regressions pass |
| 26 Extraction prefix discovery | Searches completed extraction with existing lexical chunker, retaining bounded best passages; provider-dispatch regression finds a fact after the 16k catalog prefix. No embeddings; large-file retrieval profiling pending |
| 27 Current-chat exclusion | History authorization and tool result filtering exempt the current chat; regression verifies its own reads succeed while another excluded chat refuses |
| 28 Historical extraction retry promotion | Historical retries update extraction status/text without replacing the newer current revision. Real source-intake persistence regression passes |
| 29 Initial upload failure copy | Checks for a different readable retained revision; browser qualification pending |

## First batch evidence

- Added regressions before persistence/authorization changes. Baseline failures:
  duplicate bindings both succeeded; moved membership lost `color`; editing
  deleted provenance failed; approval still succeeded after an ownership move.
- `bunx vitest run --project=app-integration
  app/db/__tests__/project-workspace.integration.test.ts --bail=0 --reporter=dot`:
  9 passed (including the current-chat exclusion regression added subsequently).
- `bunx vitest run --project=plugin-compatibility
  app/utils/chat/__tests__/tool-registry-profiles.test.ts --reporter=dot`:
  8 passed.
- Configured Nuxt typecheck passed via `bun scripts/cli/nuxt-task.ts type-check`
  with Basic Auth, SQLite/better-sqlite3 and filesystem provider selection,
  sync/storage disabled for type validation. Direct `.nuxt` checker invocation
  was not equivalent and reported unrelated test/declaration errors; the normal
  `bun run type-check` tsx launcher could not create its sandbox IPC socket.
- Existing edits in `tests/e2e/persistent-projects.spec.ts` were preserved.

## Second batch evidence

- Before fixes, legacy activity omitted its chat, membership updates failed on
  an unchanged deleted chat, and both large-paste/continuation dispatches lacked
  the relevant project evidence.
- Connected persistence + native admission suites: 48 passed, 1 existing skipped.
  Persistence suite rerun after expanded-family repair: 11 passed.
- Configured Nuxt typecheck passed after shared ownership and model capability
  snapshot changes. The later family-bound changes require the next type pass.
- No merge, publication, provider release or production mutation performed.

## Third batch evidence

- Outgoing-filter and null-owner preparation regressions failed before fixes.
  Continuation also dispatched after a model filter moved the chat; fixed.
- A 300-source unused inventory blocked actual provider dispatch before receipt
  aggregation. It now dispatches with a small persisted diagnostic receipt.
- Connected persistence + native admission suites: 52 passed, 1 existing skipped.
- Configured Nuxt typecheck passed after request ordering, nullable-owner dispatch
  checks and receipt aggregation. Subsequent sidebar scope/lifecycle edits need
  the next type pass and browser validation.
- The authenticated foreground history fixture supplied no cached session; it
  now supplies a real-shaped owner session rather than bypassing authorization.

## Fourth batch evidence

- Before fixes, retrying an old failed extraction promoted it over the current
  revision; empty-query continuity read all historical evidence; late-file
  facts were missing from provider dispatch; populated model selection used
  the global default instead of project policy. All reproduced before fixes.
- Last connected suites before the model change: 56 passed, 1 existing skipped.
  Mounted/Dexie model navigation + remount regression passed independently.
- Sidebar scope and section-scoped subscription typecheck passed. The latest
  continuity, extraction, lexical selection and durable model changes need the
  next full connected pass and configured typecheck.

## Fifth batch evidence

- Connected persistence, native admission and model-selection suites: 65 passed,
  1 existing skipped. Configured Nuxt typecheck and documentation checks passed.
- A real registered native document tool saved a document after a preparation
  hook moved the originating thread; only result delivery refused it. Added
  transaction guards now reject owner, policy, registration and enablement
  changes before saving; unchanged control succeeds (5 cases passed).
- Reauthorization inside transactions avoids imports/crypto preparation and
  preserves the normalized approved arguments; preparation remains outside the
  write transaction. Latest guard batch: 78 connected tests passed, 1 existing skipped; configured Nuxt typecheck and mapped documentation checks passed.

## Code-review follow-up: fixes for the 15 review findings

Implemented in this change:

- Saves keep stored top-level fields this version does not know, and refuse to overwrite a record in a format it cannot read (`save`, `keepStoredUnknownFields`). Editors pass the revision they read, so a same-clock sync replacement is refused.
- A legacy chat listed in several projects shows a choose-project banner above the composer (`ChatProjectChoice`, `ambiguousChatProjects`). Keeping it in one project moves its branch family.
- Joining a project moves the whole branch family. Leaving releases only the branches that project owned. Moves report related chats in a notice from the sidebar and the banner.
- Receipts carry `omitted_memory_count` for explicit memories left out by the byte budget or by context admission.
- A new chat's first send persists the composer's explicit model only when that composer armed the choice (`armNewChatSelection`). A chat opened later keeps its own preference.

Evidence: 14 affected suites passed (343 passed, 1 skipped). The wider changed-file run has the same 81 failures as the PR head, all pre-existing, and no new ones. The CI-profile typecheck passed. ESLint reports the same 19 `no-unsafe-assignment` errors as the PR head and none new.

Not done here: a Playwright journey for the new-chat model choice (covered by a composable test instead); the title-weighting and score-threshold part of the source-relevance finding; lazy clearing of stale project pointers. Provider releases that declare `projectOwnership` (SQLite 0.0.14, Convex 0.0.11) and the new Workflows package need the release process and version pins, so they are outside this change.
