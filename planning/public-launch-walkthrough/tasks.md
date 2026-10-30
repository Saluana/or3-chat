# OR3 public launch walkthrough checklist

Run the app as a new user first, then deliberately interrupt the paths that save data, spend money, change access, or update a deployment. Finish with a clean production candidate, a verified restore/rollback rehearsal, and an independent user completing the core journey without help.

**Status: execution recorded; public launch qualification incomplete.** See the [execution report](../../audit-evidence/public-launch-walkthrough-20261025/README.md) and [case ledger](../../audit-evidence/public-launch-walkthrough-20261025/case-results.md). Only fully evidenced cases within the named local configuration are checked; partial, blocked, failed and unexecuted cases stay open. [Requirements](requirements.md) define acceptance; [design](design.md) defines the evidence format and coverage matrix.

## Walkthrough route

There are 311 individual cases grouped into 32 work batches. Run the included sections in order; optional integrations apply only when included in the public launch.

| Pass | Sections | Focus |
| --- | --- | --- |
| Prepare | 1–2 | Candidate, fixtures, supported configurations, automated baseline |
| Become a user | 3–9 | Arrival, accounts, model access, chat, history, context, navigation |
| Do useful work | 10–15 | Documents, AI edits, projects, knowledge/memory, search, Files |
| Recover work | 16–20 | Local/Cloud restores, workspace isolation, offline sync, tools/jobs |
| Extend the app | 21–25 | Notifications, Activity, webhooks, appearance, plugins, workflows, agents |
| Stress the experience | 26–29 | Real devices, accessibility, performance, security/privacy |
| Operate and explain | 30–31 | Admin/configuration, public docs, independent walkthrough |
| Decide and launch | 32 | Exact-artifact canary, deployment recovery, sign-off, first-day monitoring |

## How to use this checklist

- Each numbered section is one work batch, approximately 1–4 hours per selected configuration. Split longer runs at the browser/provider boundary. Cases inside a batch are individually checkable.
- Record `case ID | owner | configuration/device | pass/partial/fail/blocked/not run/N/A | observation | evidence | defect`. Check a box only after an evidenced pass. For N/A, record why the feature is excluded and verify its entry points are unavailable or accurately explained.
- Run against synthetic data and isolated destinations. Use the real deployed candidate for acceptance and the named harnesses for repeatable fault injection. Keep a model-spend limit and test receiver for external actions.
- After a fix, repeat the failed case, its recovery path, and adjacent affected journeys. After changing the artifact or provider versions, identify which earlier results need repeating.
- **Stop launch for:** data loss/corruption; cross-account/workspace disclosure; authorization bypass; exposed credentials; duplicate paid/action side effects; inability to complete the core journey on a supported device; falsely reported saves/completion/backups; or an unproven restore/rollback path. Minor defects need a named owner, disposition, and accurate public limitations.

## 1. Freeze scope and prepare fixtures

- [ ] **1.0 Complete the qualification setup (1–2 h).** Requirements: R1, R14. Components: C1, C8. Done when every included surface has an owner, candidate identity, fixtures, and a recorded execution boundary.
  - [ ] **1.1** Record source SHA, build/image digest, deployment URL, build mode, configuration revision, exact provider/plugin/theme versions, and qualification date. Keep the tested candidate stable.
  - [ ] **1.2** List launch modes: local/static, the selected Cloud profile, and any additional advertised provider combinations. Identify single-instance versus multi-instance deployment.
  - [ ] **1.3** Inventory every visible sidebar destination, dashboard tile, admin page, menu action, slash action, and installed plugin. Assign each to a section below; investigate unmatched controls.
  - [ ] **1.4** Decide whether Marketplace/Library, workflows, external agents, webhooks, waitlist, compaction, and background execution are included. An unfinished visible feature cannot be silently marked N/A.
  - [ ] **1.5** Record supported browser/OS/device versions and themes. Include real iPhone Safari and Android Chrome if mobile is advertised; record portable-plugin Chromium restrictions separately.
  - [ ] **1.6** Create disposable owner/editor/viewer/removed-member fixtures, two unrelated accounts, two workspaces with similar resource names, and a separate deployment-admin session. Include a second browser/device.
  - [ ] **1.7** Seed an empty workspace and a populated one with chats, branches, documents, projects, prompts, files, images, Trash, and notifications. Retain original file hashes and expected associations.
  - [ ] **1.8** Prepare short/long/Unicode/RTL/code/math text, valid and corrupt PDF/DOCX files, scanned PDF, image-only DOCX, large images, duplicate bytes, unusual filenames, and files immediately below/at/above configured limits.
  - [ ] **1.9** Prepare prior-supported-version data and isolated restore targets. Record model/traffic budgets, fault-injection scope, evidence location, and issue severity rules; redact credentials from artifacts.

## 2. Establish the automated baseline

- [ ] **2.0 Record applicable automated gates (1–4 h of operator work plus runtime).** Requirements: R1, R3–R13. Components: C1–C8. Done when required commands pass against the candidate and their artifacts and limits are recorded.
  - [ ] **2.1** Reproduce the pinned environment with `bun install --frozen-lockfile`, the repository's Bun version, and supported Node version. Use the documented dev/build wrappers.
  - [x] **2.2** Run `bun run type-check`, `bun run test`, `bun run check-imports`, and `bun run check:docs`; retain results. Use `bun run lint:changed -- <files>` for candidate changes and full lint through the applicable qualification lane.
  - [x] **2.3** Run `bun run test:integration` for data/auth/runtime boundaries; run `test:scripts`, `test:release-policy`, and `test:plugin-compatibility` for their included release surfaces. Run `bun run test:full` as release qualification, not as a replacement for browser acceptance.
  - [ ] **2.4** Run `bun run test:e2e:journeys`, `bun run test:e2e:recovery`, `bun run test:e2e:projects`, `bun run test:e2e:command-palette`, and `bun run test:e2e:ui-audit` for included core features; retain traces and failure artifacts.
  - [ ] **2.5** For Cloud, run applicable named harnesses: `test:e2e:admin-auth`, `test:e2e:sign-in-gate`, `test:e2e:workspace-cloud`, `test:e2e:sync:cloud`, `test:e2e:file-backup:cloud`, `test:e2e:server-restarts`, and `test:cloud:provider-compatibility`.
  - [ ] **2.6** Select remaining named harnesses by included feature: `test:e2e:context`, `test:e2e:chat-tools`, `test:e2e:chat-tools:cloud`, `test:e2e:tool-cards`, `test:e2e:plugin-development`, `test:e2e:theme-tokens`, `test:e2e:setup-wizard`, `test:e2e:source-secrets`, and `test:e2e:waitlist`. Confirm prerequisites before paid or credential-writing harnesses.
  - [ ] **2.7** Produce the supported production build; if shipping static mode, also run `bun run generate:static` and inspect its preview. Static startup must not require Cloud SDKs, server routes, or configured server credentials.
  - [x] **2.8** Verify the production candidate excludes test/example pages, fixture APIs, mock inference, and development inspectors. Real acceptance requests must not route to `/api/__or3-e2e`; disable production-journey harness flags for the candidate.
  - [x] **2.9** Treat default Playwright results as Chromium coverage only. Record live provider, Safari/Firefox, mobile, real-model, and production-build evidence separately; do not turn skipped or unexecuted checks into passes.

## 3. Arrive as a completely new user

- [ ] **3.0 Complete first use from a clean browser profile (1–2 h).** Requirements: R2, R4, R14. Components: C2, C8. Done when a new user understands the entry path and reaches saved work without developer help.
  - [ ] **3.1** Open the public root URL with no cookies/storage. Welcome, brand, icons, fonts, loading state, and main action render without a blank screen or hydration failure.
  - [x] **3.2** Follow the intended local, guest, or sign-in-required flow. The UI distinguishes OR3 account access from OpenRouter/model access.
  - [x] **3.3** Use Start a chat, Start a project, and Create a document where enabled. Each opens the correct action and preserves any existing unsent chat; disabled features have no misleading entry point.
  - [x] **3.4** Attempt those actions while signed out on a gated Cloud instance. The correct sign-in dialog opens without creating a record or sending an AI request.
  - [ ] **3.5** Follow invite/deep links through root redirects and authentication. The intended destination survives, and malformed or inaccessible destinations recover clearly.
  - [ ] **3.6** Start offline or with browser storage denied/unavailable. Local capabilities and storage failures are explained; the app does not falsely promise a saved conversation.
  - [ ] **3.7** Open first-chat/help, Terms, Privacy, and support links from the UI. Each reaches the intended public content without authentication loops or development URLs.
  - [ ] **3.8** Complete the shortest real journey: enter, obtain allowed model access, select a model, send one message, reload, and find the same saved conversation.

## 4. Sign in, sign out, invitations, and account recovery

- [ ] **4.0 Complete account lifecycle checks (2–4 h).** Requirements: R2, R8, R11. Components: C2, C3, C6. Done when supported entry/recovery paths work and rejected paths confer no access.
  - [ ] **4.1** Sign in with valid and invalid credentials; submit empty, malformed, and password-boundary values. Errors identify an actionable problem without exposing another account's details.
  - [ ] **4.2** Exercise open, invite-only, and closed registration in disposable configurations. Existing users can sign in in each mode; new-account admission follows the active policy.
  - [ ] **4.3** Accept a signup invite by link and code, including case/spacing variations. Acceptance creates the recipient's private workspace rather than joining or copying the inviter's workspace.
  - [ ] **4.4** Test wrong-email, expired, revoked, already-used, malformed, and concurrently redeemed invitations. Invalid attempts preserve correctable form input and cannot create unintended membership.
  - [ ] **4.5** Accept a team invite. It joins exactly the named workspace with the chosen role; redirects/new tabs preserve a valid invite through sign-up.
  - [ ] **4.6** Interrupt signup after provider account creation. The documented existing-account sign-in path can finish permitted admission without duplicate accounts or workspaces.
  - [ ] **4.7** Exercise provider-supported password change, reset, verification, and account-recovery paths that are exposed. If a recovery path is absent, public help accurately gives the supported operator route.
  - [ ] **4.8** Let access expire, background the tab, resume it, and retry a chat/upload. Session refresh succeeds or presents sign-in without erasing saved work or granting stale permissions.
  - [ ] **4.9** Sign out with both configured device-retention policies. Personal credentials clear; retained data behavior matches the policy. Signing into a different account never displays the previous account's protected content or key.
  - [ ] **4.10** Sign out or change credentials in another tab during an upload/request. All tabs converge on current identity and stop unauthorized work; repeated invalid login/session requests are bounded.

## 5. Connect models and use the catalog

- [ ] **5.0 Qualify credentials and model selection (1–3 h).** Requirements: R2, R3, R11. Components: C2, C6. Done when supported credential policies and actual model calls agree with the UI.
  - [ ] **5.1** Complete real OpenRouter authorization and return to the same origin. Cancel consent and test missing verifier, stale callback/state, expired transaction, and code-exchange failure; recovery starts a fresh flow.
  - [ ] **5.2** Paste a valid personal key, malformed key, revoked key, and an unfunded/restricted test key. Format validation is not presented as proof of model access; failed persistence does not show Connected.
  - [ ] **5.3** Reload, disconnect, and reconnect. The key follows documented custody and account scope; Disconnect leaves conversations intact and does not claim to revoke the key at OpenRouter.
  - [ ] **5.4** Test instance key only, user overrides allowed, and user overrides disallowed where supported. SSR without a user key uses the server route and never exposes a server key or silently sends directly.
  - [ ] **5.5** Open model catalog, search/filter, inspect model details, favorite/unfavorite, and select from desktop and mobile controls. Empty/loading/provider-error states remain usable.
  - [ ] **5.6** Verify model capabilities, context limits, routing variants, and available price information against the candidate's actual catalog. Unknown data is labeled unknown and does not become a fabricated default.
  - [ ] **5.7** Change workspace default, project default, and per-chat override. Inheritance and explicit reset behave as described; a late load cannot overwrite a newer selection.
  - [ ] **5.8** Remove or lose access to a saved model. Existing history still opens and the user can select a usable replacement without losing the draft.
  - [ ] **5.9** Make a small budgeted real text call and each advertised modality/tool-capable call. Separate upstream refusal from an OR3 defect and retain redacted outcome evidence.

## 6. Compose, send, stream, stop, and retry

- [ ] **6.0 Qualify the core chat loop (2–4 h).** Requirements: R3, R8. Components: C2, C3. Done when admission, visible output, and durable history agree for success and failure.
  - [ ] **6.1** Send short, multiline, pasted rich text, Unicode/emoji, RTL, and long prompts. Enter/Shift+Enter and configured send behavior work; IME composition does not accidentally submit.
  - [ ] **6.2** Attempt blank sends and rapid double-click/keyboard submits. Invalid input does nothing useful-looking, and one intended send does not create duplicate turns or provider calls.
  - [ ] **6.3** Attach by every exposed path: picker, drag/drop, paste, and saved-file/reference selection. Remove and re-add files; previews, names, counts, and model compatibility remain correct.
  - [ ] **6.4** Block preparation, local persistence, attachment loading, or context admission. Draft and attachments remain recoverable. For native admission, draft clearing follows actual acceptance and never clears newer edits typed while waiting.
  - [ ] **6.5** Stream prose, fenced code, tables, links, math, lists, and image output if supported. The first render and final render remain readable; copying code preserves exact source text.
  - [ ] **6.6** Scroll up while a response grows, then return to bottom. Existing reading position is respected and bottom-follow resumes intentionally without layout jumps.
  - [ ] **6.7** Stop during preparation, first token, tool wait, and late streaming. Accepted partial output is retained; cancelled work is not labeled successfully completed and controls become usable again.
  - [ ] **6.8** Inject disconnect, timeout, malformed stream, 401, 429, provider 5xx, and empty response. Each reaches a truthful recoverable state without an endless spinner or exposed upstream secret.
  - [ ] **6.9** Retry a saved failed turn and continue a stopped reply where supported. Correct history/model/context is used; old-generation output cannot overwrite the retry or repeat an already completed action.
  - [ ] **6.10** Navigate, close the view, reload, and crash a disposable tab mid-response. Foreground interruption and supported background continuation are distinguished; reopened history contains the actual durable result.
  - [ ] **6.11** Run different chats in separate panes/tabs. Inputs, stop controls, draft recovery, errors, and results remain associated with their originating chat.

## 7. Manage conversation history and branches

- [ ] **7.0 Qualify saved conversation actions (1–3 h).** Requirements: R3, R4, R7. Components: C2, C3. Done when each exposed history action has the intended target and survives reopen/reload.
  - [ ] **7.1** Create, manually rename, pin/unpin, reopen, and find chats in both sidebar and palette. Pins retain ordinary list membership and persist in the right workspace.
  - [ ] **7.2** Generate automatic titles and manually rename while naming is pending. A late generated title does not overwrite the user's name; a naming failure leaves a usable title.
  - [x] **7.3** Edit a prior message, retry, and create a branch through available controls. Inspect the exact resulting history and family relationship; originals remain accessible as specified.
  - [ ] **7.4** Expand/collapse families, search for a child, and use original/latest links. Selection, labels, ordering, and action targets identify the correct conversation.
  - [ ] **7.5** Copy messages and create a document from a response. Repeating the same unchanged response action opens the same document; changed source content creates its documented distinct snapshot.
  - [ ] **7.6** Delete a message or move a conversation to Trash, cancel a confirmation, then restore. No late response resurrects a deleted destination or leaves an orphan result.
  - [ ] **7.7** Exercise exposed history/export/download actions with attachments and long messages. Output contains the intended conversation and does not claim unsupported content was included.
  - [ ] **7.8** Open large histories, scroll older messages, and receive a change from another client. Ordering and anchors remain stable, and an unrelated chat update does not reset the active pane.

## 8. Prompts, AI settings, context, and compaction

- [ ] **8.0 Qualify prompt and context controls (2–4 h).** Requirements: R3, R4, R6. Component: C2. Done when saved policy, submitted context, and recovery match, with qualification evidence for shipped compaction paths.
  - [ ] **8.1** Create, edit, search, favorite/tag where exposed, select, delete, and restore saved prompts. Default prompt and per-chat choice survive reload without leaking across workspaces.
  - [ ] **8.2** Edit AI defaults and master prompt; leave the settings page immediately. Saving/Saved/Not saved states reflect real persistence; failure preserves input and offers Retry.
  - [ ] **8.3** Test context maximum unset, valid integer, zero, negative, decimal, malformed, and excessive input. Unset uses model capacity; invalid values are rejected; a user maximum cannot override the model's real limit.
  - [ ] **8.4** Change settings/model during an active request. The admitted generation keeps its captured preferences and later generations use the newly saved values.
  - [ ] **8.5** Fill context with text, history, references, tools, and images. Estimates, provider-reported usage, unknown cost/capacity, and reply allowance are distinguished; no silent history truncation occurs.
  - [ ] **8.6** Trigger overflow before save, after save/admission, and during a tool loop. Draft/retry recovery matches the actual boundary and accepted tool results are retained.
  - [ ] **8.7** If lossy-send inspection is exposed, inspect and cancel it, then explicitly approve a valid preview. Omitted material is visible and changed input invalidates stale approval.
  - [x] **8.8** Compact an eligible idle conversation. The summary creates a new linked version, preserves the original, keeps valid landmarks, and retains the unsent draft as documented.
  - [ ] **8.9** Cancel compaction, change its source, simulate invalid summary output, and lose credentials/network. The original remains intact and no partial or stale version is committed.
  - [ ] **8.10** Test auto-compaction off/default/threshold persistence and two tabs reaching the same threshold. One unchanged source gets one attempt; failures do not create an inference loop.
  - [ ] **8.11** Review summary quality across at least three representative conversations and repeated compactions, including project facts and tool history. Verify provider round trips/reconnect against released artifacts; resolve the open boundaries in [the compaction qualification plan](../manual-context-compaction/tasks.md).

## 9. Tabs, panes, sidebar, and Dashboard

- [ ] **9.0 Qualify workspace navigation (1–3 h).** Requirements: R4, R8. Components: C2, C3. Done when navigation preserves ownership, recoverable drafts, and expected layout.
  - [ ] **9.1** Open several unsent chats. Draft numbering and tab labels distinguish them, and switching tabs retains the correct text/attachments.
  - [ ] **9.2** Open chat, document, Files, and enabled app panes; split, resize, swap, reorder, focus, and close using all exposed controls. Pane limits and tiny widths remain usable.
  - [ ] **9.3** Reload each layout and switch workspace/profile. Appropriate tabs and geometry restore without duplicate panes, wrong titles, or stale asynchronous restoration.
  - [ ] **9.4** Open the same document/chat in two panes and perform actions in each. Controls act on the intended pane and share only the state that should be shared.
  - [ ] **9.5** Collapse/expand sidebar, scroll long lists, search, use context menus, and operate the mobile drawer. Focus, selection, and scroll positions remain understandable.
  - [ ] **9.6** Open every Dashboard tile and nested page. Back climbs one level, breadcrumbs go to the selected ancestor, and long content scrolls within the viewport.
  - [ ] **9.7** Close a dashboard deep link and reload. The closed modal does not reopen, and unrelated URL parameters remain intact.
  - [ ] **9.8** Load direct chat/document/plugin links, use browser Back/Forward, and target missing/deleted/unauthorized resources. Show a recoverable unavailable state rather than the wrong resource.
  - [ ] **9.9** Restore a tab for a disabled, still-loading, or unavailable plugin. Preserve its identity and show the actual state instead of substituting an empty chat.

## 10. Write and save documents

- [ ] **10.0 Qualify document editing and recovery (2–4 h).** Requirements: R5, R7, R8. Components: C2, C3. Done when edits remain durable or explicitly recoverable through all tested transitions.
  - [x] **10.1** Create a document from the global UI, a project, and a chat response. Title, owning project where applicable, tab, and sidebar entry match the action.
  - [ ] **10.2** Exercise every exposed formatting control: headings, emphasis, lists, checklists, links, quotes, code, tables, images, and undo/redo. Paste plain/rich text and verify stored content after reload.
  - [ ] **10.3** Rename and edit rapidly, leave the pane, hide the page, and reopen. Confirm a durable save receipt/state before treating the content as saved.
  - [ ] **10.4** Fail a save, fill storage, and lose write access. The persistent failure notice offers recovery, retains the buffer, and does not show a false Saved state.
  - [ ] **10.5** Try refresh/close with unsaved changes. The supported unsaved-change warning appears after interaction; cancelling preserves the buffer. Document the limits of forced browser termination.
  - [ ] **10.6** Edit the same document in two panes/tabs/devices. Clean views update; independent edits cause an explicit conflict/recovery path instead of silently overwriting a local draft.
  - [ ] **10.7** Use outline navigation, find, replace, and replace-all across formatting. Counts refresh; replacements are literal; navigation targets the correct pane and respects reduced motion.
  - [ ] **10.8** Insert/remove/resize images using available controls, then fail image persistence or close/switch the editor during intake. The document stays intact and unavailable images have a recoverable state.
  - [x] **10.9** Create, inspect, and restore document checkpoints/history through exposed controls. Restoration targets the originating document/workspace and respects subsequent edits.
  - [ ] **10.10** Export/import each exposed document format and inspect formatting/content. Test large documents, read-only documents, deletion while open, and unavailable records without trapping the user in an unusable tab.

## 11. Use document AI and reviewed edits

- [ ] **11.0 Qualify document AI authority (1–3 h).** Requirements: R5, R9, R11. Components: C2, C4, C6. Done when only explicit, current, authorized acceptance changes document content.
  - [ ] **11.1** Ask for a cursor-local edit, a selected-text edit, and an explicitly broader edit. Proposal scope matches the request and frozen editable context.
  - [ ] **11.2** Apply, discard, and cancel proposals through every exposed review control. Discard/cancel leaves content unchanged; accepted edits save and history reflects the committed result.
  - [x] **11.3** Edit the document while a proposal is pending, then attempt Apply. A stale proposal cannot overwrite the new revision; recovery is explained.
  - [ ] **11.4** Add document/chat/file references and attachments. References are deduplicated, current-document/self or missing/deleted references are rejected as documented, and reference content grants no write access.
  - [ ] **11.5** Switch document, pane, workspace, or account during preparation/streaming/review. No proposal or status is delivered to the wrong editor.
  - [ ] **11.6** Exercise saved/plugin slash actions. They insert the expected prompt without sending immediately; missing or disabled contributions disappear cleanly.
  - [ ] **11.7** Fail model transport, context limits, proposal validation, and persistence. The original remains intact, failure does not appear as Applied, and retry does not duplicate a committed edit.
  - [ ] **11.8** Verify autocomplete if enabled under personal-key, instance-key, guest, and no-credential policies. Unauthorized inference does not start; ordinary local editing remains available.

## 12. Organize projects and their policy

- [ ] **12.0 Qualify project organization (1–3 h).** Requirements: R4, R6, R8. Components: C2, C3. Done when navigation, membership, and saved policy agree across entry points.
  - [ ] **12.1** Create, rename, pin, search, open, and recoverably delete projects from Home and the full Projects list. Card padding and Enter/Space open correctly; pinning does not open the project.
  - [ ] **12.2** Exercise Home shortcuts, Show more, activity pagination, section back navigation, and project search with more than five projects. Browsing does not replace the active chat pane.
  - [ ] **12.3** Edit, save, clear, cancel, and Escape the project brief. Displayed and submitted brief agree; failed saves preserve input.
  - [ ] **12.4** Leave unfinished brief/settings/note/memory forms and return within the workspace. Their documented in-memory drafts remain; reload/workspace-switch limits are accurately disclosed.
  - [ ] **12.5** Create project chats and documents. Their owning project and Knowledge bindings are correct; documents are unavailable when that feature is disabled.
  - [ ] **12.6** Move a conversation family between projects, exclude it from memory, and resolve a legacy multiple-project ambiguity. Branches move consistently and an unresolved owner prevents unsafe sending.
  - [ ] **12.7** Save model, instructions, and tool permissions; discard unsaved edits. Chat override/reset follows inheritance, and only committed settings affect later turns.
  - [ ] **12.8** Test Off/Ask first/On, always-approval tools, unavailable tools, and repository restrictions. Project policy narrows workspace authority and cannot enable server-owned execution without project support.
  - [ ] **12.9** Delete and restore a project using supported controls. Underlying chats/documents/files remain preserved as documented; old async work cannot recreate deleted policy or bind to another project.

  **Current finding:** the local candidate has no project restore control in Trash. Project deletion detaches chats and removes project settings and links, so this recovery case remains open; see the worktree walkthrough evidence for the corrected warning and its limits.

## 13. Add knowledge, memory, and continuity

- [ ] **13.0 Qualify project context quality and preservation (2–4 h).** Requirements: R6, R7, R9. Components: C2, C3, C4. Done when required context is included or visibly blocks, optional context is bounded, and evidence remains scoped.
  - [ ] **13.1** Add each supported source: PDF, DOCX, text/Markdown/CSV, image, note, saved file, and OR3 document. Verify actual original bytes, readable preview, title, status, and source location information.
  - [ ] **13.2** Test scanned PDFs, image-only/mixed DOCX, corrupt files, and extraction size/page/time boundaries. Ready/Partially readable/Failed accurately describe the result; no OCR capability is implied.
  - [ ] **13.3** Navigate away during extraction, then switch workspace or revoke permission. Same-workspace processing stays with the original project; changed authority prevents unauthorized commits. Reload-interrupted work becomes retryable.
  - [ ] **13.4** Replace a source successfully and unsuccessfully. Retain originals/revisions; a failed replacement leaves the working revision current. Renaming a bound document updates its displayed title.
  - [ ] **13.5** Test Use when relevant, Always include, and Do not use. Required unavailable/partial/oversized/incompatible inputs block visibly; excluded sources are absent from automatic context and project tool reads.
  - [ ] **13.6** Send a file in project chat, repeat identical bytes with another filename, and cancel preparation. Successful intake reuses appropriate sources; cancelled/rejected preparation does not promote attachments.
  - [ ] **13.7** Add/edit/delete manual memories and Remember for this project from a message while another project is visible. The review names the actual owning project and preserves user-edited text.
  - [ ] **13.8** Exercise automatic capture with durable preferences versus one-time questions or unaccepted suggestions. Capture is bounded, nonblocking, and not falsely presented as browser-closed background work; a capture failure preserves the conversation.
  - [ ] **13.9** Exclude/move/delete source chats or edit captured evidence. Dependent automatic memories and summaries stop contributing as documented; explicit user-owned memories retain their separate semantics.
  - [ ] **13.10** Continue in new chat. The handoff stays in the project, retains usable evidence links, respects capacity and exclusions, and does not invent a successful transfer of unavailable context.
  - [ ] **13.11** Ask representative cross-source questions and inspect recorded inclusion diagnostics. Distinguish available, retrieved, and included evidence from whether the model actually relied on it.

## 14. Search and run commands

- [ ] **14.0 Qualify discovery across the workspace (1–3 h).** Requirements: R4, R6, R8. Components: C2, C3. Done when results are current, bounded, correctly scoped, and keyboard/touch usable.
  - [ ] **14.1** Search titles and body content across chats, documents, projects, prompts, images, Files, dashboard pages, and enabled plugin records. Category prefixes and chips filter the intended sources.
  - [ ] **14.2** Search empty, common, rare, Unicode, punctuation, very long, and no-match queries. Loading/empty/error states distinguish their causes and remain responsive.
  - [ ] **14.3** Edit a message/document, replace file bytes, rename a source, delete, and restore without changing row counts. Results and previews reflect the current content and revision.
  - [ ] **14.4** Type rapidly and press Enter during debounce. An old query cannot execute its former result; closing cancels stale previews/actions.
  - [ ] **14.5** Use Cmd/Ctrl+K, arrows, Enter, action tray, Escape, and focus return. Reopening does not stack overlays; commands act on the current selection/workspace.
  - [ ] **14.6** Inspect file excerpt coverage, duplicate chunks, and bounded reads. Filename-only/partial indexing is disclosed and matching resources are not misleadingly duplicated.
  - [ ] **14.7** Break or delay indexing and rebuild it through supported recovery. Substring fallback remains usable; UI does not freeze or expose deleted/unauthorized sources.
  - [ ] **14.8** On mobile, search with the keyboard open, preview a result, scroll actions, dismiss, and return to the same query/list position. Background content remains fixed.
  - [ ] **14.9** Switch workspace/account or revoke a result's access while preview/action work is pending. Stale data, errors, or side effects do not appear in the new scope.

## 15. Files, image gallery, cache, and Trash

- [ ] **15.0 Qualify original-file handling (2–4 h).** Requirements: R7, R8, R11. Components: C3, C6. Done when references, originals, transfer state, and user-visible status remain consistent.
  - [ ] **15.1** Upload every advertised type by each available intake path. Preview/download/open and metadata show the right original; duplicate bytes do not create inconsistent ownership or references.
  - [ ] **15.2** Test file size/count/type boundaries, empty files, MIME/extension mismatches, Unicode/long filenames, and corrupt previews. Rejection is actionable and unrelated files remain usable.
  - [ ] **15.3** Interrupt upload/download, go offline, reload, and expire the presigned URL. Transfers recover or ask for the original again without falsely reporting completion.
  - [ ] **15.4** Lose membership or switch scope during transfer. Requests and completion writes remain authorized for the origin and cannot attach bytes to another workspace.
  - [ ] **15.5** Open the image gallery, scroll/paginate/search, open/close the viewer, copy and download. Large/missing images show useful states and closing releases owned previews.
  - [ ] **15.6** Reference one file from several messages/documents/project sources; remove one reference. Other consumers still work and derived reference accounting does not delete a needed original.
  - [ ] **15.7** Move files to Trash, restore, and inspect retained references. Trash view has restore/navigation controls; creation/upload controls remain in the active Files view.
  - [ ] **15.8** Test configured cache limits and eviction. Remote-backed originals can be downloaded again; unsynced/local-only originals are not silently discarded to satisfy cache cleanup.
  - [ ] **15.9** Exercise storage-full, missing-blob, failed commit, rejected MIME, and provider-outage recovery. Metadata-only success is not presented as a successful original upload.
  - [ ] **15.10** Inspect any permanent-delete/cleanup controls on disposable data. Confirmation identifies the scope; retention and live references prevent premature collection; cancel preserves data.

## 16. Export and restore a local workspace

- [ ] **16.0 Prove local backup recovery (1–3 h).** Requirements: R7, R8. Component: C3. Done when a supported local backup restores verified content and malformed imports preserve destination data.
  - [ ] **16.1** Export populated local data through the supported save-picker and download fallback. Progress and completion reflect a committed output file, including attachments supported by the format.
  - [ ] **16.2** Cancel the picker/export, fail destination writes, and modify data during snapshot/export. Do not report a complete backup; an incomplete download is identified for disposal.
  - [ ] **16.3** Switch workspace while export preparation is pending. The export remains bound to its original workspace and never silently changes scope.
  - [ ] **16.4** Import into a disposable supported destination using default Append & merge with overwrite off. Existing destination records remain intact and metadata/version information is shown first.
  - [ ] **16.5** Test explicit overwrite separately from append. Conflicting records follow the chosen record-level policy; duplicate source identities are rejected rather than treated as overwrite permission.
  - [ ] **16.6** Rehearse Replace only with an explicitly approved disposable target and a verified pre-import backup. Cancel leaves it intact; supported streaming failures roll back the clear and import.
  - [ ] **16.7** Feed truncated streams, unknown records, missing terminal markers, trailing data, duplicate keys, oversized files, and future schema versions. Verify documented format-specific failure behavior without assuming every legacy format has identical guarantees.
  - [ ] **16.8** Reload restored chats, branches, documents, prompts, project context, Files, and retained Trash. Compare representative bodies, associations, counts, and original file hashes.
  - [ ] **16.9** Verify backup guidance explains browser profile/origin, local credential sensitivity, lack of archive encryption, and why local export is not a complete Cloud or operator backup.

## 17. Export and restore a Cloud workspace

- [ ] **17.0 Prove Cloud archive recovery (2–4 h plus large-file runtime).** Requirements: R7, R8, R13. Components: C3, C8. Done when a canonical archive restores into a fresh workspace with verified originals and truthful failure handling.
  - [ ] **17.1** Export a `.or3cloud` archive containing canonical records and originals absent from this browser cache, including retained Trash. Verify the actual deployed provider supports the archive snapshot contract.
  - [ ] **17.2** Export with unsynced edits, unfinished uploads, missing originals, or invalid references. Backup waits/blocks as documented instead of silently omitting work and reporting success.
  - [ ] **17.3** Corrupt archive metadata, payload bytes, or checksum. Complete validation fails before creating a destination or applying records.
  - [ ] **17.4** Restore into a new workspace. The source remains untouched; restored originals receive valid new storage identities and all required writes settle before success.
  - [ ] **17.5** Interrupt restore during upload or record application, expire the session, and induce 429. Incomplete destinations remain labeled; deferral and reselect/retry instructions match the supported fresh-workspace recovery path.
  - [ ] **17.6** Restore with originals around configured upload limits. Allowed destination adjustment stays within the supported ceiling; unsupported input refuses visibly without damaging source data.
  - [ ] **17.7** Reload the new workspace on a second client. Compare chats, branches, documents, project knowledge, live files, retained Trash, and original hashes with the fixture manifest.
  - [ ] **17.8** Verify Cloud UI does not permit local JSON/JSONL in-place replacement or expose cache/queue/cursor/device-credential state as canonical recovery content.
  - [ ] **17.9** Repeat on every advertised archive backend, using published provider artifacts and matching backend schema/functions. Qualify the advertised large-archive size with retained memory/transfer evidence.

## 18. Switch workspaces and enforce roles

- [ ] **18.0 Qualify account/workspace isolation (2–4 h).** Requirements: R8, R11. Components: C3, C6. Done when both UI and direct requests preserve current authority and originating identity.
  - [ ] **18.1** Create, rename, switch, delete, and restore workspaces through the permitted surfaces. The active pointer, session, database, and visible name agree; switching never merges databases.
  - [ ] **18.2** Populate both workspaces with similar names and selected same-ID fixtures where supported. Tabs, document caches, titles, search, prompts, model settings, and Files show only the correct scope.
  - [ ] **18.3** Switch during chat preparation, document save, file upload, extraction, backup, search, and plugin activation. Late completion stays in its origin or is rejected; it cannot mutate the new view.
  - [ ] **18.4** Race A→B→A across tabs with delayed responses. Monotonic workspace selection prevents an older result from restoring an obsolete active workspace.
  - [ ] **18.5** Exercise owner/editor/viewer permissions against UI and APIs. A viewer cannot write, upload, manage membership, enable plugins, or initiate paid background work merely by supplying a model key.
  - [ ] **18.6** Demote/remove a member while SSE, sync, file access, and tool approval are active. Fresh authorization blocks further protected access or mutation according to the operation's role contract.
  - [ ] **18.7** Verify last-owner protection and restore-before-editing behavior for deleted workspaces. Team invites cannot confer access beyond their exact workspace and role.
  - [ ] **18.8** Open deep links to another workspace/account's chats, files, documents, jobs, notifications, plugin records, and admin targets. Neither IDs nor browser history bypass permission checks.
  - [ ] **18.9** Verify logout clear/keep-device policy and direct account changes against all retained workspace databases. Credentials and sensitive late notifications never carry into the next account.

## 19. Work offline, reconnect, and reconcile sync

- [ ] **19.0 Qualify offline and multi-client recovery (2–4 h per backend).** Requirements: R7, R8, R9. Components: C3, C4. Done when local durability, convergence, retries, and deletion follow existing contracts.
  - [ ] **19.1** Go offline after loading the app. Read cached work and make supported local edits; online-only inference and uncached originals explain their unavailable state.
  - [ ] **19.2** Queue edits/deletes/uploads, reload offline, reconnect, and inspect both clients. Supported work survives and converges without duplicate records or attachments.
  - [ ] **19.3** Edit the same record concurrently on two devices, including equal-clock/tie fixtures. Verify the documented clock/HLC winner, preserved recoverable editor conflicts, and deterministic message ordering.
  - [ ] **19.4** Drop the response after a server accepts a push, then retry the same operation. Idempotency replays its result rather than applying a second write.
  - [ ] **19.5** Apply remote rows locally. They do not re-enqueue into an endless outbox cycle; repeated local edits coalesce without losing the latest intended state.
  - [ ] **19.6** Inject structured 429/Retry-After responses and transient outages. Deferrals respect the retry time, do not increment failed-attempt counts, and do not create request storms.
  - [ ] **19.7** Expire authentication and disconnect subscriptions during push/pull. Recovery refreshes the correct session and resumes from a valid workspace cursor without mixing workspaces.
  - [ ] **19.8** Delete records while a client is offline, then reconnect before and after supported retention/snapshot recovery boundaries. Tombstones and resync do not resurrect deleted data or silently discard legitimate pending writes.
  - [ ] **19.9** Exercise schema upgrade from a supported previous browser database and backend. Preserve originals, outbox/indexes, conversation lineage, and local writes; upgrade does not fabricate a mass upload.
  - [ ] **19.10** Run named recovery/stress harnesses with bounded queues, large libraries, clock skew, and partial dependency outage. Confirm quarantine/recovery is actionable and healthy features remain usable.
  - [ ] **19.11** Retain backend evidence for atomic writes/outbox capture, contiguous workspace server versions, one workspace cursor, and GC constrained by minimum device cursor plus retention. UI agreement alone does not prove these invariants.

## 20. Execute tools and recover background jobs

- [ ] **20.0 Qualify execution and side-effect safety (2–4 h).** Requirements: R3, R8, R9, R11. Components: C2, C3, C4, C6. Done when approval, persistence, cancellation, and canonical job state agree.
  - [ ] **20.1** Toggle tools and exercise Off, Ask first, and allowed automatic execution. Approval cards identify the action/target; deny, cancel, dismiss, and permission loss prevent execution.
  - [ ] **20.2** Exercise built-in chat/document/workspace search and read tools. Results are bounded, current, correctly scoped, and omit unavailable/deleted content.
  - [ ] **20.3** Create a document/project or propose an edit through tools; repeat the execution receipt. Successful mutations report only after commit and retries do not duplicate the side effect.
  - [ ] **20.4** Use Send message to thread where exposed with explicit approval. It targets another authorized thread, appends the intended message, and does not falsely imply it launched a model reply.
  - [ ] **20.5** Apply/discard a document proposal from chat, then edit and attempt Undo. Stale acceptance or undo cannot overwrite a newer user revision.
  - [ ] **20.6** Start an eligible background generation, navigate, close/reopen the tab, and attach from another client. Output and terminal state match canonical history; project/unsupported-tool ineligibility is explained.
  - [ ] **20.7** Break SSE, fail polling, retry 429/5xx, and resume at a durable offset. No duplicate text or fabricated terminal result appears; uncertainty is not mislabeled completion.
  - [ ] **20.8** Park a browser-owned tool, lose its viewer, reconnect, and race two claimants. Completed/uncertain side effects are not blindly replayed; expired or superseded claims cannot write results.
  - [ ] **20.9** Stop while streaming, executing a tool, or detached. Cancellation reaches eligible upstream work and prevents later steps; accepted prior results remain durable.
  - [ ] **20.10** Restart or lose a worker during admission, progress, and terminal-history delivery. Durable providers recover/fence execution as documented; the UI never treats a transport loss as job success.
  - [ ] **20.11** Switch account/workspace, remove membership, delete/move the target chat, or change it into a project mid-run. Subsequent tool/model dispatch and result delivery revalidate origin and authority.
  - [ ] **20.12** Hit configured concurrency, runtime, output, and tool-loop limits. Refusals are clear, billing/action attempts remain bounded, and another user's work remains available.

## 21. Notifications, Activity, and webhooks

- [ ] **21.0 Qualify completion reporting and integrations (1–3 h).** Requirements: R8, R9, R10, R11. Components: C3, C4, C5, C6. Done when events reflect canonical state and reach only the intended audience.
  - [ ] **21.1** Complete/fail/cancel jobs while viewing and while detached. Notification behavior follows the documented suppression policy and does not repeatedly announce the same completion.
  - [ ] **21.2** Open the notification center, read/unread or dismiss where exposed, follow an action, reload, and sync another device. Counts, destination, and retained state agree.
  - [ ] **21.3** Switch account/workspace while an event is pending. Notifications and click targets retain originating scope; a removed member cannot use an old notice to regain access.
  - [ ] **21.4** Resolve ordinary sync conflicts. They do not create the reserved conflict notifications that documentation says are intentionally silent.
  - [ ] **21.5** Inspect Activity summaries, details, live events, filtering, and exposed retry/cancel/open actions. Each action matches the canonical subsystem; stale events cannot replace terminal status.
  - [ ] **21.6** Fail one Activity source or disable its plugin. Other sources remain usable; retained data is not presented as a running capability.
  - [ ] **21.7** If webhooks ship, create one against an owned test receiver; copy its once-only signing secret, select events, send a test ping, and verify signature/payload/scope.
  - [ ] **21.8** Fail/time out the receiver, retry, inspect delivery logs, disable/delete the webhook, and remove owner access. Retry/deduplication expectations are explicit and secrets remain redacted.
  - [ ] **21.9** Verify user versus admin event separation, encrypted secret custody, required encryption configuration, and blocked unsafe destinations/redirects. Missing webhook setup must not break ordinary chat.

## 22. Themes, appearance, and workspace profiles

- [ ] **22.0 Qualify personalization (1–3 h).** Requirements: R4, R12. Components: C2, C7. Done when advertised themes/profiles retain usable controls and documented persistence.
  - [ ] **22.1** Switch every bundled launch theme through light/dark/system behavior where offered. Main surfaces, dialogs, editor, chat, menus, disabled/error/focus states remain readable.
  - [ ] **22.2** Change colors, typography, text size, interface scale, borders, density, backgrounds, focus width, and motion settings through exposed controls. Allowed extremes remain usable.
  - [ ] **22.3** Reload and switch workspace/device. Theme selection versus browser-local appearance preferences follows documented scope; do not assume all appearance settings sync.
  - [ ] **22.4** Add valid/invalid/large background images, change layers/opacity, and reset each category and all settings. Reset targets the intended scope and preserves unrelated data.
  - [ ] **22.5** Apply Standard OR3, Minimal Chat, Document Workspace, and included package profiles. Preview matches the resulting navigation; applying a profile preserves data, active panes, and permissions.
  - [ ] **22.6** Reload/reset a layout and disable a profile-contributing plugin. Initial panes do not duplicate; missing profiles fall back with clear diagnostics.
  - [ ] **22.7** Verify a theme recommendation requires explicit application. Installing/selecting a theme does not silently change the workspace profile.
  - [ ] **22.8** Test cold production SSR/hydration, including an authenticated client-plugin profile transition. No request shares another user's theme/profile state; record evidence for the previously unqualified transition.
  - [ ] **22.9** If custom theme installation ships, exercise declared trust tiers and invalid packages. A new production theme requires the supported rebuild/redeploy; restarting unchanged assets is not advertised as activation.

## 23. Install, configure, update, and remove plugins

- [ ] **23.0 Qualify plugin and Marketplace lifecycle (2–4 h per launch package/profile).** Requirements: R9, R10, R11. Components: C4, C5, C6. Done when exact-package verification, workspace authority, activation, and a useful action all succeed.
  - [ ] **23.1** Open Discover, search/filter, inspect version/permissions/costs/browser requirements, and handle empty/error/unavailable states. Static or incompatible browsers receive an accurate supported-path explanation.
  - [ ] **23.2** Approve a signed exact release for the site, then install and enable it in a chosen workspace. Site approval, shared instance code selection, workspace enablement, and browser activation remain distinct.
  - [ ] **23.3** Complete required configuration/connections, test credentials, cancel setup, and resume it. Secrets use the documented custody; missing setup prevents activation/use without losing progress.
  - [ ] **23.4** Run the browser activation check, then perform the plugin's first useful action. A successful Run check alone is not counted as feature acceptance.
  - [ ] **23.5** Deny/revoke capabilities, change account/workspace, and use read-only membership. UI contributions, network calls, file reads, tool dispatch, and server routes respect current grants.
  - [ ] **23.6** Install/tamper invalid signatures, integrity, manifests, unsupported runtime, and incompatible versions using disposable fixtures. Quarantine/denial fails closed and never falls back to trusted execution.
  - [ ] **23.7** Interrupt install/update, reload, retry, expand permissions, and roll back. Review occurs for authority expansion and a failed update preserves the current usable installation and saved data.
  - [ ] **23.8** Enable across selected workspaces and as a new-workspace default. Preview, partial progress, cancellation, setup blockers, and retries retain exact targets and do not create duplicate installs.
  - [ ] **23.9** Disable/re-enable and uninstall/reinstall. Registrations/listeners/tabs clean up without duplicate controls; retained records stay recoverable and shared uninstall scope is explicit.
  - [ ] **23.10** If Library/paid access ships, complete a staging purchase, link a fresh host, acquire the exact covered release, unlink/relink, paginate purchases, expire/renew coverage, and qualify Plus separately if advertised.
  - [ ] **23.11** Exercise ordinary-buyer install requests and administrator approval. Changed membership, linked account, site approval, or entitlement blocks stale requests/retries from acquiring a covered artifact.
  - [ ] **23.12** For source/development admission, require an explicit workspace target, inactive candidate, canary, and promotion. Static, safe-mode, disabled-loader, and unsupported-browser paths cannot execute the package.

## 24. Build and run workflows when included

- [ ] **24.0 Qualify the installed Workflows package (2–4 h).** Requirements: R9, R10. Components: C4, C5. Done when editor, execution, interruptions, and retained checkpoints work on the exact package.
  - [ ] **24.1** Confirm Workflows is installed/enabled and editing/execution is permitted. With the package disabled, navigation disappears while saved records and read-only execution summaries remain.
  - [ ] **24.2** Create, name, describe, edit, save, reopen, duplicate/import/export where exposed, and delete a workflow. Descriptions and graph data round-trip accurately.
  - [ ] **24.3** Add/configure every advertised node type; connect/disconnect, select, move, pan, zoom, and delete. Start-node protection and canvas keyboard/touch controls behave as documented.
  - [ ] **24.4** Build invalid and warning-only graphs. Validation points to the affected node; errors block Run and warnings are distinguished.
  - [ ] **24.5** Choose Run. It saves, opens a chat, and prefills a command without sending; the supplied chat text becomes run input.
  - [ ] **24.6** Run sequential, branching/parallel/join, tool, and human-approval flows supported by the package. Inputs follow graph connections; unrelated branches/chat history do not silently leak into nodes.
  - [ ] **24.7** Stop/fail/reload and Resume from last checkpoint. Completed outputs stay intact, completed side effects do not replay, and edited/removed graph nodes follow documented checkpoint reconciliation.
  - [ ] **24.8** Qualify background text runs and foreground image-output runs separately. Cards, generated attachments, inactivity timeout, cancellation, and reload state agree with the actual execution path.
  - [ ] **24.9** Move the chat into a project, revoke write access, or switch workspace during a run. Host origin checks refuse unsupported project inference/writes and preserve prior durable state.

## 25. Connect external agents when included

- [ ] **25.0 Qualify advertised agent integrations (2–4 h per runtime).** Requirements: R8, R9, R10, R11. Components: C3, C4, C5, C6. Done when the installed package and actual host agree on capabilities, authority, and recovery.
  - [ ] **25.1** Connect each advertised Intern/OpenClaw/Hermes host with its supported URL/token flow. Verify capability discovery, invalid token, unavailable host, TLS/origin, and timeout errors.
  - [ ] **25.2** Do not advertise QR/device pairing as implemented by this client. Verify onboarding matches the pre-authorized bearer-token boundary documented for the shipped package.
  - [ ] **25.3** Test memory-only credentials and optional PIN remembering: reload locked, unlock the correct host from a historical pane, enter a wrong PIN, forget/remove, and reconnect.
  - [ ] **25.4** Create/open sessions, send/stream/stop, use advertised model/reasoning/slash-command controls, and approve/deny actions. Unsupported runtime controls stay hidden or explained.
  - [ ] **25.5** Lose SSE, reconnect with replay, time out an idle stream, and switch hosts mid-request. Deduplication works and late events from the old host cannot replace the new session.
  - [ ] **25.6** Upload attachments using advertised capability and size/count limits. Failed pre-start batches clean up safely; accepted runs retain needed bytes and unsupported cleanup produces its documented warning.
  - [ ] **25.7** Verify host roots, approval policy, and execution are owned by the trusted host. Chat does not launch arbitrary provider CLIs or send credentials to an unrelated redirect/destination.
  - [ ] **25.8** Switch workspace/account and inspect session discovery, local references, artifacts, and errors. No remote session from another workspace appears through an imprecise prefix.
  - [ ] **25.9** Disable/re-enable the package and test OR3 Connect separately if advertised. Saved references remain intact; host status/recovery remains usable within its actual ownership boundary.

## 26. Browsers, mobile devices, and installed app behavior

- [ ] **26.0 Complete supported-device journeys (2–4 h per device class).** Requirements: R2, R4, R12. Components: C2, C7. Done when actual supported devices complete core work without viewport, input, or storage traps.
  - [ ] **26.1** Repeat first sign-in/connect → chat → document → project/file → reload/reopen on supported desktop browsers and real phones. Record browser versions and intentional extension restrictions.
  - [ ] **26.2** Test narrow phone, landscape phone, tablet, laptop, and wide desktop layouts. Navigation, dialogs, menus, split panes, and action bars do not overflow or hide critical actions.
  - [ ] **26.3** Open the software keyboard in composer, document AI, search, settings, and auth forms. Inputs and submit/cancel buttons remain visible and scrolling does not move the wrong layer.
  - [ ] **26.4** Rotate, resize, zoom, change text size, collapse browser chrome, and use safe-area/notched layouts. Focus and unsent edits survive.
  - [ ] **26.5** Use touch selection, copy/paste, long press, file/photo pickers, share/download, and clipboard permissions. Unsupported clipboard/download paths offer a useful fallback.
  - [ ] **26.6** Background/suspend and resume the browser during save, upload, and streaming. Status refreshes without duplicating work or promising persistence that did not occur.
  - [ ] **26.7** If PWA installation is offered, install/open from the home screen, follow deep links, reload offline, and return from OAuth. Navigation and saved-origin behavior stay correct.
  - [ ] **26.8** Upgrade the app with an old service worker/cache and open tabs. Assets reconcile without an unrecoverable mixed-version shell, lost drafts, cached protected API responses, or a stale sign-in screen.
  - [ ] **26.9** Exercise restricted/private storage where supported. Explain persistence limits; do not represent private browsing or site-data clearing as a durable backup strategy.

## 27. Accessibility and product clarity

- [ ] **27.0 Complete accessible interaction review (2–4 h).** Requirements: R12, R14. Components: C7, C8. Done when primary journeys work with keyboard and assistive technology and state is understandable.
  - [ ] **27.1** Complete sign-in, send/stop, model selection, search, document edit, file upload, and settings without a pointer. No keyboard trap; focus order and visible focus match visual structure.
  - [ ] **27.2** Open/close nested dialogs, menus, drawers, popovers, and tool approvals. Escape/back behavior is consistent and focus returns to a meaningful triggering control.
  - [ ] **27.3** Use VoiceOver or another supported screen reader. Inputs, icon-only actions, selected tabs, headings, errors, progress, and save states have meaningful names and relationships.
  - [ ] **27.4** Read a streaming response and changing job status with assistive technology. Announcements do not repeatedly interrupt the user or omit terminal state.
  - [ ] **27.5** Test light/dark themes, custom colors, high text zoom, reduced motion, and forced/high-contrast settings where supported. Information is not conveyed by color alone and controls remain legible.
  - [ ] **27.6** Verify touch targets and compact icon buttons remain independently operable; hover-only functionality has keyboard/touch access.
  - [ ] **27.7** Inspect every empty/loading/error/disabled/success state. Explain the next useful action, distinguish saving from saved, and avoid exposing internal stack traces or raw provider jargon as the only guidance.
  - [ ] **27.8** Verify destructive confirmations name the target and consequence; Cancel is safe. Buttons, titles, labels, tooltips, punctuation, truncation, and long/Unicode names remain consistent.
  - [ ] **27.9** Run an accessibility scanner as supporting evidence, then manually resolve its applicable findings. Scanner success alone is not sign-off for keyboard, mobile, or screen-reader behavior.

## 28. Performance, capacity, and cost

- [ ] **28.0 Qualify production performance and bounds (2–4 h plus soak runtime).** Requirements: R8, R9, R12, R13. Components: C3, C4, C7, C8. Done when recorded budgets and launch load targets pass on the actual candidate.
  - [ ] **28.1** Run `bun run performance:production-build:check`, `bun run performance:workspace:check`, and `bun run performance:browser:check` in their supported environments; retain budget results and hardware/network conditions.
  - [ ] **28.2** Measure cold/warm welcome and workspace startup on representative desktop/mobile hardware with an empty and populated workspace. Separate app startup from model-provider first-token latency.
  - [ ] **28.3** Profile long chat scrolling/streaming, large documents, many projects/tabs, Files/gallery, and palette searches. Existing strict budgets apply; record p95/worst cases rather than only averages.
  - [ ] **28.4** Repeat open/close/switch/stream cycles. Memory, preview URLs, workers, listeners, subscriptions, timers, and background trackers settle rather than growing without bound.
  - [ ] **28.5** Confirm heavy optional code stays lazy: document conversion, syntax highlighting, catalog/plugin/history tooling, and Cloud features do not block an unrelated first action.
  - [ ] **28.6** Test configured limits and realistic launch concurrency for chat jobs, sync, uploads, extraction, notifications, and webhooks. Rejection/backpressure is understandable and does not starve unrelated users.
  - [ ] **28.7** Simulate a reconnect burst and a slow consumer/dependency. Queues, polling, retries, timeouts, and logs remain bounded; service recovers within the recorded target.
  - [ ] **28.8** Measure paid request counts for retries, titles, memory capture, compaction, document AI, and workflows. Repeated failures/background tasks do not create an unbounded spend loop.
  - [ ] **28.9** Record expected concurrent users, request/upload rate, retention/storage capacity, cost ceiling, and alert thresholds before the soak. Test the expected peak and an agreed burst; do not invent a launch capacity from a single-user smoke test.
  - [ ] **28.10** For multiple instances, use supported shared/durable providers and exercise active sync/jobs during rolling restart from another instance. Process-local success is insufficient for shared-state correctness.

## 29. Security and privacy acceptance

- [ ] **29.0 Complete focused security verification (2–4 h per boundary; split as needed).** Requirements: R8, R9, R10, R11. Components: C3–C6. Done when relevant authorization, content, network, and secret-custody checks have evidence and no launch-blocking finding remains.
  - [ ] **29.1** Call protected API/provider operations directly as signed-out, viewer, wrong-workspace, removed-member, and non-admin users. Cover reads, mutations, jobs, files, backups, plugin administration, and entitlements.
  - [ ] **29.2** Verify mutation intent, same-origin/CSRF defenses, cookie scope/security, no-store responses, and configured rate limits on auth, admin, paid inference, storage, and plugin endpoints.
  - [ ] **29.3** Inspect the production bundle, Nuxt payload, HTML, browser storage, URLs, errors, telemetry, logs, traces, and downloads for unintended server secrets or cross-user data. Respect documented personal-key and backup custody rather than assuming they are encrypted.
  - [ ] **29.4** Render adversarial Markdown/HTML/SVG/links/filenames/document content in previews, chat, editor, tool cards, and notifications. Content stays inert or safely handled; scriptable URLs and active asset escape paths are blocked.
  - [ ] **29.5** Test URL imports, webhook destinations, plugin networking, and external-host redirects against the intended destination restrictions and SSRF protections using owned fixtures.
  - [ ] **29.6** Verify presigned URL expiration, workspace authorization, upload reservation/commit ownership, original-byte validation, and unauthorized Trash/original access.
  - [ ] **29.7** Put hostile instructions in a knowledge file, retrieved chat, tool output, and plugin record. They cannot grant capabilities, approve actions, alter project ownership, or edit read-only reference content.
  - [ ] **29.8** Qualify isolated-plugin containment, revoked capability handling, resource budgets, and safe mode with the applicable compatibility/containment tooling. Trusted-host code has separate reviewed trust; failure does not downgrade isolation.
  - [ ] **29.9** Review dependency/image scan results for the exact artifact, including runtime providers. Resolve exploitable critical/high-impact findings and record any accepted lower-risk exception with owner and scope.
  - [ ] **29.10** Verify implemented export, deletion, retention, consent, and account-removal/support procedures against public privacy statements. External AI recipients and unencrypted backup sensitivity are accurately disclosed; make no unverified legal-compliance claim.

## 30. Admin, provisioning, configuration, and secret custody

- [ ] **30.0 Qualify operator controls (2–4 h).** Requirements: R2, R10, R11, R13. Components: C2, C5, C6, C8. Done when administrative changes apply only to intended scope with recoverable, truthful lifecycle state.
  - [ ] **30.1** Sign into the separate admin surface as deployment admin, restricted workspace admin, and ordinary user. Navigation and direct routes enforce the same authority; normal sign-in does not imply global admin access.
  - [ ] **30.2** Visit every included admin page: overview, workspaces, members/invites, admin users, registration, features, plugins, themes, branding, webhooks, system/operations, advanced, and waitlist if enabled.
  - [ ] **30.3** Create a workspace with a valid existing owner, search missing owners, change roles, protect the last owner, and restore a deleted workspace. Form validation and concurrent changes do not strand ownership.
  - [ ] **30.4** Save registration/features/branding/configuration and race an external revision. Distinguish saved from active policy, reject stale saves, and require verified replacement boot when needed.
  - [ ] **30.5** Complete setup/wizard validation with installed and missing providers, valid/invalid secrets, port conflicts, and filesystem permission failures. Unknown configuration entries and supported aliases survive updates.
  - [ ] **30.6** Exercise secret-store lock/unlock/unavailable/restart/credential-change paths in an isolated deployment. Secret values do not enter browser configuration, logs, exported diagnostics, or ordinary localStorage.
  - [ ] **30.7** Preview and request a supported restart with active chat, parked tools, uploads, and pending history delivery. Waiting/cancel/error/recovery states are truthful and new admission follows the documented lifecycle.
  - [ ] **30.8** Select an explicit admin workspace, then change the Chat workspace in another view. Plugin/member operations retain the admin target and revalidate access immediately before mutation.
  - [ ] **30.9** If waitlist ships, toggle it live, submit valid/invalid/duplicate addresses, hit rate limits, and submit from an already-open page after closing it. Joining creates no account/access/email; only instance admins can read the list.
  - [ ] **30.10** Verify health/provider warnings and system status after failure. An HTTP 200 with degraded deep health is not success, and unavailable restart/update capability offers the supported operator route.

## 31. Public documentation, support, and an independent walkthrough

- [ ] **31.0 Qualify the public promise (1–3 h).** Requirements: R1, R2, R14. Components: C1, C2, C8. Done when an independent tester can use the shipped configuration from public instructions and every limitation has an accurate disposition.
  - [ ] **31.1** Follow first-chat, connection, project, backup, self-hosting, plugin, and recovery guides from the actual UI. Links, labels, screenshots, routes, versions, and prerequisites match the candidate.
  - [ ] **31.2** Reconcile draft-clearing wording with native provider acceptance and context-refusal behavior; reconcile generic JSONL backup wording with Cloud `.or3cloud` fresh-workspace restore.
  - [ ] **31.3** Resolve stale provider-version and qualification claims against actual published packages/backend deployment. Sibling source code or a matching version label alone does not prove a fix shipped.
  - [ ] **31.4** Publish an accurate feature/browser/deployment matrix: local/offline limits, paid model requirements, plugin Chromium limits, package-dependent workflows/agents, project background restrictions, and supported archive sizes.
  - [ ] **31.5** Decide the launch disposition of documented open compaction/provider-quality work, authenticated plugin-profile hydration, and unsupported secure agent pairing. Qualify, disable, or narrow the claim explicitly.
  - [ ] **31.6** Verify public title/description/favicon/share metadata, canonical public URLs, help/Terms/Privacy/support links, and intended indexing of public versus private app pages. No staging branding, fixture credentials, or localhost links remain.
  - [ ] **31.7** Make cost/credential custody, backup versus sync, browser-data loss risks, source/managed setup differences, and realistic recovery instructions understandable to a non-developer.
  - [ ] **31.8** Prepare a monitored support route, reproducible bug-report template, known-issues list, escalation owner, and incident/status communication process. Bug reports request version and safe diagnostics, not secrets.
  - [ ] **31.9** Have someone who did not build the flow complete entry → chat → project/source → document edit → find/reopen → backup/recovery using only public guidance. Log confusion and dead ends as defects, not user mistakes.
  - [ ] **31.10** Retest the corrected independent journey on the final candidate. Confirm launch copy does not promise an untested feature, provider, device, privacy property, or recovery guarantee.

## 32. Rehearse deployment and make the launch decision

- [ ] **32.0 Complete release and launch acceptance (2–4 h plus workflow/soak runtime).** Requirements: R1, R7–R14. Components: C1, C3–C8. Done when canonical promotion gates, product acceptance, recovery evidence, and named operational ownership are complete.
  - [ ] **32.1** Freeze a clean candidate and follow [Cloud updates](../../docs/cloud-updates.md), [Cloud release checklist](../../docs/cloud-release-checklist.md), and [releasing](../../docs/releasing.md). Use the documented stable candidate/tag ceremony only when release publication is explicitly authorized.
  - [ ] **32.2** Retain release readiness/preflight evidence, required CI results, package integrity, exact image/operator digests, architecture checks, scans, and candidate receipt. Qualification and publication remain distinct states.
  - [ ] **32.3** Deploy that immutable artifact to representative staging with the actual selected providers. Verify HTTPS/DNS, proxy/origin/cookies, persistent volumes, permissions, capacity, and shallow/deep health.
  - [ ] **32.4** Run the documented staging canary and retain its required schema/status, candidate/previous artifact IDs, provider-data snapshot identity, and evidence hash. Test real sign-in, sync, original-file transfer, job recovery, and backup restore.
  - [ ] **32.5** Take an operator deployment backup and restore it in isolation. Verify auth/workspace metadata, original files, configured services, and required secret/config recovery; a workspace export does not replace this test.
  - [ ] **32.6** Rehearse supported upgrade, interrupted update/recovery, and rollback with synthetic writes before and after the update. Record the exact data-loss boundary of snapshot restoration and obtain explicit approval before destructive recovery.
  - [ ] **32.7** For multiple instances, execute the canonical scale gate: shared job state, supported storage topology, rolling restart, dependency failure and recovery, and bounded multi-instance soak. Observe from another instance.
  - [ ] **32.8** Verify rollback/restore access and recovery materials are usable by the named operator. Record acceptable recovery time/data-loss targets and measured rehearsal results; do not equate an older image with a reversed database migration.
  - [ ] **32.9** Confirm every applicable case is passed or has an explicit accepted minor-defect disposition. No unresolved data-loss, authorization, credential, duplicate-action, false-success, core-journey, or recovery blocker remains.
  - [ ] **32.10** Record product, engineering, security/data, and operations sign-off against the same candidate. One person may own several roles, but each responsibility is explicitly accepted.
  - [ ] **32.11** Assign launch monitoring and response owners; verify alerts for availability, auth errors, job failures, sync backlog, transfer failures, disk/storage growth, provider spend, and failed backups using safe test events.
  - [ ] **32.12** After separately authorized promotion, verify public package/image/deployment identities, production configuration, health, and a fresh-user smoke from the public URL. Retain publication and activation evidence separately.
  - [ ] **32.13** At initial exposure and during the first day, review core-journey success, errors, latency, queue depth, costs, support reports, and backup completion. Expand traffic only within demonstrated capacity; invoke the rehearsed response when rollback thresholds are crossed.
  - [ ] **32.14** Retain release evidence and recovery snapshots for the agreed retention window. Remove disposable accounts/test receivers and synthetic data through approved cleanup, without deleting real-user data or protected recovery points.

## Traceability Matrix

| Requirement | Design component | Checklist batches |
| --- | --- | --- |
| R1 Scope and evidence | C1 | 1, 2, 31, 32 |
| R2 First use and accounts | C2 | 3, 4, 5, 26, 30, 31 |
| R3 Chat and context | C2 | 2, 5, 6, 7, 8, 20 |
| R4 Navigation and preferences | C2 | 3, 7, 8, 9, 12, 14, 22, 26 |
| R5 Documents and AI edits | C2 | 10, 11 |
| R6 Projects and context | C2 | 8, 12, 13, 14 |
| R7 Files and recovery | C3 | 7, 10, 13, 15, 16, 17, 19, 32 |
| R8 Isolation and sync | C3 | 4, 6, 9, 10, 12, 14–21, 25, 28, 29, 32 |
| R9 Execution | C4 | 11, 13, 19, 20, 21, 23, 24, 25, 28, 29, 32 |
| R10 Extensions | C5 | 21, 23, 24, 25, 29, 30, 32 |
| R11 Access and privacy | C6 | 4, 5, 11, 15, 18, 20, 21, 23, 25, 29, 30, 32 |
| R12 Usability and performance | C7 | 22, 26, 27, 28, 32 |
| R13 Administration and release | C8 | 2, 17, 28, 30, 32 |
| R14 Public readiness | C8 | 1, 3, 27, 31, 32 |

## Definition of Done

The checklist is complete only when every applicable acceptance criterion has evidence for the final artifact, all required verification commands are green, the traceability matrix has no uncovered launch surface, restore and rollback have been demonstrated, and designated owners sign off. Justified N/A cases are scope exclusions, not successful tests. Accepted minor issues must not weaken a data-safety or authorization contract.

Record the decision here after execution:

| Field | Value |
| --- | --- |
| Candidate SHA / artifact digest | Not selected |
| Public modes / providers / plugin versions | Not recorded |
| Passed / failed / blocked / not run / N/A | Not tallied; all cases initially not run |
| Unresolved launch blockers | Not assessed |
| Accepted minor issues and owners | Not assessed |
| Restore / rollback evidence | Not run |
| Sign-off owners and time | Not recorded |
| Decision | **Not qualified yet** |
| Production activation / public smoke | Not performed |

## Source references

- [Docmap](../../public/_documentation/docmap.json), [source map](../../public/_documentation/start/source-map.md), and [development setup](../../public/_documentation/start/development-setup.md).
- [First chat](../../public/_documentation/start/first-chat.md), [chat lifecycle](../../public/_documentation/architecture/chat-lifecycle.md), [AI preferences](../../public/_documentation/architecture/ai-preferences.md), and [compaction](../../public/_documentation/utils/manual-context-compaction.md).
- [Projects](../../public/_documentation/start/projects.md), [documents](../../public/_documentation/database/documents.md), [chat tools](../../public/_documentation/utils/chat-tools.md), and [search](../../public/_documentation/start/command-palette.md).
- [Accounts](../../public/_documentation/cloud/auth-system.md), [providers](../../public/_documentation/cloud/providers.md), [sync](../../public/_documentation/cloud/sync-layer.md), [storage](../../public/_documentation/cloud/storage-layer.md), and [backup](../../public/_documentation/database/backup.md).
- [Background execution](../../public/_documentation/cloud/background-execution.md), [notifications](../../public/_documentation/cloud/notifications.md), and [webhooks](../../public/_documentation/cloud/webhooks.md).
- [Themes](../../public/_documentation/themes/customize.md), [workspace profiles](../../public/_documentation/architecture/workspace-profiles.md), [plugins](../../public/_documentation/plugins/install-and-manage.md), [workflows](../../public/_documentation/workflows/editor.md), and [external agents](../../public/_documentation/architecture/activity-external-agents.md).
- [Package commands](../../package.json), [browser configuration](../../playwright.config.ts), [Cloud release checklist](../../docs/cloud-release-checklist.md), and [canonical updates](../../docs/cloud-updates.md).
