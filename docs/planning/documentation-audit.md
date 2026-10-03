# Documentation drift and consolidation audit

Audited on October 1, 2026, starting from `public/_documentation/docmap.json`.
The published inventory was structurally sound. The original pass found older
`docs/` guides competing with maintained public pages and stale runtime guidance
in several public Cloud pages. A follow-up pass reviewed more source extension,
theme, backup, streaming, and deployment notes.

The cleanup requested after this audit is complete. The findings below describe
the pre-cleanup state; their original line references are historical. Maintained
guides now contain the corrected contracts, and older repository paths contain
short pointers instead of competing implementations. Two additional obsolete
repository pages with no maintained incoming references were removed.

## Applied cleanup

- [x] Correct workflow package routes and implementation ownership.
- [x] Replace unsupported sidebar registration examples with maintained tutorials.
- [x] Retire the duplicate notification architecture guide into a pointer.
- [x] Correct background eligibility and browser-tool bridge guidance.
- [x] Remove unsupported notification idempotency and clock-as-sync-proof advice.
- [x] Correct hidden-tab/subscriber completion suppression.
- [x] Make shared Cloud diagnostics provider-neutral.
- [x] Remove the extracted host workflow import from the subflow guide.
- [x] Correct the SDK streaming limitation claim and consolidate OpenRouter usage.
- [x] Centralize sync troubleshooting and remove the obsolete publishing blocker.
- [x] Correct hook signatures and consolidate documentation-system guidance.
- [x] Consolidate all 12 groups in the proposal table, preserving useful source
  contracts and OpenClaw/Hermes connection instructions in maintained guides.
- [x] Merge the two public Types forwarding pages into the overview; remove their
  files and docmap entries, and update tooling references and the generated ledger.
- [x] Move manual workspace-profile qualification notes to
  [historical evidence](../history/workspace-profile-qualification.md).

Validation after cleanup: `bun run check:docs` passed with 107 checked files,
95 mapped routes, and 21 typechecked examples. A separate scan of all 49 Markdown
files under `docs/` found no missing relative link targets. The compatibility
ledger was regenerated from its updated module manifest. Rendered checks on the
existing development server verified the merged Types tables, workflow route
text, and theme background-layer table. No existing preview server was stopped
or reconfigured.

## Follow-up cleanup applied

This was a deeper targeted source review of the remaining repository guides,
not exhaustive verification of every statement in both directories.

| Finding | Applied change | Implementation evidence |
| --- | --- | --- |
| The generic UI extension template invents `registerToolbarAction()` and a removed `ui-extensions/` layout | Replaced with the current source-map registry inventory and lifetime guidance | `app/composables/_registry.ts`, `app/composables/sidebar/useHeaderActions.ts` |
| Message-action examples use stale imports, fabricate share routes, and omit owned teardown | Replaced with a complete copy-ID example, typed source imports, and owned disposal | `app/composables/chat/useMessageActions.ts`, `app/components/chat/ChatMessage.vue` |
| Project-tree docs guarantee `treeRow` and imply `all` is a wildcard | Documented current `root`/`child` payload fallback and actual visibility checks; removed invented navigation routes and the outer Markdown code fence | `app/components/sidebar/SidebarProjectTree.vue`, `app/composables/projects/useProjectTreeActions.ts` |
| Thread-history docs promise `{ thread }` | Merged thread guidance into the document/history guide and documented `{ document: thread }` | `app/composables/history/createHistoryActionRegistry.ts`, `app/components/sidebar/SidebarUnifiedItem.vue` |
| Editor examples copy interfaces, import a nonexistent barrel, and omit cleanup | Shortened to actual registry owners, complete toolbar/AI examples, lazy loading boundaries, and correct handle-versus-ID cleanup | `app/composables/editor/useEditorToolbar.ts`, `useEditorNodes.ts`, `useDocumentAiActions.ts` |
| Dashboard docs duplicate examples and treat declared page count as navigation availability | Consolidated to one complete registration example, source types, owned tile disposal, and available-page behavior | `app/composables/dashboard/useDashboardPlugins.ts` |
| Five theme guides compete with maintained public guides | Merged personal override API, border variables, and icon source rules into Theme reference; retained styling/identifier ownership in the existing guide; replaced older paths with pointers | `app/core/theme/useUserThemeOverrides.ts`, `app/composables/useIcon.ts`, `app/theme/_shared/generate-css-variables.ts` |
| Tokenizer docs promise a dynamic-import exact fallback | Corrected to the current character heuristic, readiness meaning, batch keys, and source imports | `app/composables/core/useTokenizer.ts` |
| Image-cache docs imply hard limits and additive pins | Documented eviction targets, max-level pinning, cancellation, caller-owned flush/workspace coordination, and current source locations | `app/composables/core/usePreviewCache.ts`, `app/pages/images/` |
| Streaming notes name the removed `VirtualMessageList.vue` and copy obsolete thresholds | Merged accumulator and `or3-scroll` ownership into Chat lifecycle; left a short source-owner pointer | `app/composables/chat/useStreamAccumulator.ts`, `app/components/chat/ChatContainer.vue` |
| Backup UI guide duplicates published safety and codec guidance | Replaced with links to the maintained backup and stream-contract pages | `public/_documentation/database/backup.md`, `utils/workspace-backup-stream.md` |
| Pane compatibility docs promise the old `'bridge'` message ID and imply document staging proves persistence | Replaced the copied catalog with a concise source reference preserving all method families, durable-ID/rejection behavior, staging boundaries, and post restrictions | `app/plugins/pane-plugin-api.client.ts` |
| Akash recipe promises absent SDL and repeats deployment-specific URLs/commands | Removed `docs/convex-deployment-akash.md`; the maintained Convex integration guide remains | Repository reference search and `public/_documentation/cloud/provider-convex.md` |
| CSS-selector implementation summary names removed helpers and unsupported timing/memory estimates | Removed `docs/css-selectors-implementation.md`; maintained styling/architecture already cover the current runtime | `app/theme/_shared/css-selector-runtime.ts`, `public/_documentation/themes/styling.md` |

Nine older guide paths now point to maintained material; two unused obsolete
pages were deleted. The repository has 47 Markdown files under `docs/`, and
the published inventory remains 95 mapped routes. Theme audit-pack inputs now
include the public references instead of the retired duplicate guides or the
removed `useThemeClasses.ts` helper.

The two README files and documentation-system guide now define where published
guides, repository procedures, and plans belong. Maintainers should keep one
authoritative document per topic and verify source registration return types
before documenting cleanup.

Follow-up validation: `bun run check:docs` passed with 107 checked files,
95 mapped routes, and 21 checked examples. A separate Bun check validated local
links and rendered heading anchors across all 47 repository Markdown files and
typechecked all nine complete TypeScript examples added or rewritten in this
pass, including the personal-theme example outside the default checker scope.
Rendered spot checks verified the merged personal-theme API table, its TOC entry,
and the corrected chat architecture text on the existing development server.
`git diff --check` passed. No provider deployment or paid model call was needed.

## Initial audit scope and validation

- Inspected the inventory and outlines across all 97 mapped pages, then reviewed
  selected guides and overlapping repository docs against current source.
- `bun run check:docs` passed: 109 files, 97 mapped routes, and 21 typechecked
  examples. No missing mapped files, unlisted public Markdown pages, or broken
  checked local links were reported.
- Separately scanned relative Markdown links across `docs/`; found two missing
  targets, both in `docs/theme-backgrounds.md`.
- Checked explicit source-file references in public docs. Tutorial files that
  readers are instructed to create were excluded from missing-file findings.
- No browser rendering, provider deployment, or paid model execution was run.
  This is a structural audit with targeted source verification, not exhaustive
  qualification of every API statement and example.

## Original drift findings

### Workflow background routes refer to the removed core implementation

**Priority: high.** `public/_documentation/cloud/background-execution.md:9`,
`:206`, and `:233` direct callers to `/api/workflows/background` and
`/api/workflows/hitl`. Line 215 names the absent
`server/utils/workflows/background-execution.ts` implementation.

The current host calls `/api/plugins/or3-workflows/workflows/background` and
`/api/plugins/or3-workflows/workflows/hitl` in
`app/composables/plugins/workflow-host-bridge.ts:225` and `:280`. The remaining
server integration is `server/utils/workflows/plugin-server-bridge.ts`.
There is no `server/api/workflows/` directory.

**Recommendation:** update the routes and ownership explanation. State that
workflow execution requires the installed/enabled workflow package. Keep chat
background internals here and link workflow usage to `workflows/editor.md`.

### The sidebar plugin tutorial teaches unsupported registration

**Priority: high.** `docs/plugins/sidebar-plugin-guide.md:26` and `:244`
use `nuxtApp.$multiPane`, register definitions with `name` instead of `label`,
and describe a `hooks` object containing record/pane lifecycle methods.
The guide also points to absent `app/composables/sidebar/types.ts`.

`app/composables/core/usePaneApps.ts` defines `PaneAppDef` with required
`label`, `createInitialRecord`, owned registration handles, and no such
`hooks` property. The maintained source tutorial uses
`createTrustedHostContext().workspaceApi` in
`public/_documentation/start/mini-app-tutorial.md`.

**Recommendation:** replace this guide with a short pointer to the source
tutorial and portable plugin tutorial. Do not preserve its registration example.

### The old notification architecture guide contradicts current behavior

**Priority: high.** `docs/NOTIFICATION_CENTER_ARCHITECTURE.md` is 926 lines
of overlapping usage, architecture, and API guidance. It creates conflict
notifications at line 338, treats `notify:action:push` as a stored-notification
event at line 646, and recommends `debug:notifications` at line 875.

`app/plugins/notification-listeners.client.ts:123` only logs conflicts.
`NotificationService.startListening()` consumes push requests and `create()`
filters/validates them before storage; observing a push does not prove a row
was stored. The maintained public notification guide explicitly explains both
boundaries and the absence of the debug flag. The older page also gives timing,
memory, and virtualization claims without a linked repeatable measurement.

**Recommendation:** retire the duplicated implementation guide into a short
pointer to `public/_documentation/cloud/notifications.md`. Preserve genuinely
historical implementation evidence separately if needed; do not retain its
performance estimates as current guarantees.

### Background troubleshooting asks for a nonexistent start mode

**Priority: medium.** `public/_documentation/cloud/troubleshooting.md:374`
asks whether the start mode is `background`. The background execution guide
already says there is no separate start-mode setting.

`app/composables/chat/useAi.ts:2510` selects background execution from the
feature/session gates, browser-tool bridge capability, and text-only output.
Tools are supported when their required bridge is available.

**Recommendation:** replace the start-mode check with the current eligibility
conditions and link to the background guide rather than maintaining a second
independent eligibility list.

### Notification troubleshooting promises unsupported idempotency and proof of sync

**Priority: medium.** `public/_documentation/cloud/troubleshooting.md:303`
advises using idempotency keys when creating notifications. Its line 312 treats
a `clock` field as evidence that a notification was synced.

`app/core/notifications/notification-service.ts:41` accepts no caller ID or
idempotency key, and line 173 generates a fresh UUID. Local records also have
clocks, so a clock does not prove remote delivery.

**Recommendation:** advise deduplicating the originating event before emitting
the push request. Verify sync through outbox outcomes and remote observation in
the same workspace/user scope, not the presence of a row field.

### The public notification guide misstates hidden-tab suppression

**Priority: medium.** `public/_documentation/cloud/notifications.md:191`
says a local completion notification requires no subscribers. Its later
troubleshooting also says attached subscribers suppress completion alerts.

`app/utils/chat/useAi-internal/backgroundJobNotifications.ts:69` suppresses
when subscribers exist **and the tab is visible**. A hidden tab can notify even
with subscribers. Server preference and thread muting are separate checks.

**Recommendation:** document the actual visible/hidden-tab condition and keep
one authoritative suppression explanation.

### Cloud diagnostics still assume Convex in provider-neutral sections

**Priority: medium.** Notification diagnostics at
`public/_documentation/cloud/notifications.md:261`, sync diagnostics in
`cloud/sync-layer.md`, and upload diagnostics at
`cloud/troubleshooting.md:204` present `VITE_CONVEX_URL` as required.
The managed profile is Basic Auth + SQLite + filesystem, as documented in
`cloud/providers.md`.

**Recommendation:** point to the selected provider's requirements. Restrict
Convex URL checks to Convex deployments and avoid echoing configuration values
into shared troubleshooting output.

### Subflow integration still imports the extracted host workflow module

**Priority: medium.** `docs/workflows/subflows.md:21` imports
`~/plugins/WorkflowSlashCommands/useWorkflowSlashCommands`, which no longer
exists in this checkout. The public workflow guide correctly attributes the
editor and engine to `or3-plugin-workflows`.

**Recommendation:** retain the record-ID invariant, move package-specific
registry construction guidance to the workflow package's docs, and replace the
host import example with a pointer to that maintained implementation.

### OpenRouter documentation incorrectly says the SDK cannot stream

**Priority: medium.** `docs/openrouter-integration.md:91` says the SDK does
not support streaming. The installed SDK's
`node_modules/@openrouter/sdk/esm/sdk/chat.d.ts` explicitly supports streaming
and has a `stream: true` overload.

**Recommendation:** describe OR3's choice to use its raw-fetch SSE pipeline
without claiming that the SDK lacks streaming. Preserve the shared adapter
architecture explanation, then link model, key, and streaming contracts to the
maintained public pages.

### Sync troubleshooting retains obsolete retention and blocker wording

**Priority: medium.** `public/_documentation/cloud/sync-layer.md:363`
describes cursor expiration as a default 24-hour rule. The same page's earlier
retention contract and the general troubleshooting guide distinguish explicit
`oldestRetainedVersion`/`requiresSnapshot` recovery from legacy fallback.
`app/core/sync/subscription-manager.ts` branches on those response fields.

Line 354 also conditions performance artifacts on a dependency publishing
blocker supposedly described in `providers#supported-combinations`; that target
has no such blocker description.

**Recommendation:** reuse the authoritative retention explanation. Remove or
relocate the unsupported blocker statement to dated qualification evidence.

### Hook signatures and older documentation-system guidance have drifted

**Priority: low.** `public/_documentation/hooks/hook-catalog.md:26` lists
`any[]` for the input hook; `app/core/hooks/hook-types.ts:521` uses
`ChatMessage[]`. The next catalog row omits the before-send tuple's
`OpenRouterMessage[]` type and object-or-array union at `hook-types.ts:545`.
The older hook map also labels actions fire-and-forget, while async dispatch
awaits listeners sequentially; the emitter controls detachment.

`docs/UI/DocumentationShell.md:169` instructs readers to modify
`initializeSearch()`, which is absent from the current component. Its copied
default navigation includes routes absent from docmap. The newer
`docs/UI/documentation-system.md` correctly explains docmap discovery and the
content/navigation/TOC composables.

**Recommendation:** correct the public hook rows, consolidate old hook guides,
and move only useful custom component-prop examples into the documentation-system
guide. Remove the copied search implementation and navigation catalog.

## Consolidation applied

The changes below were applied. Legacy repository paths remain short pointers;
the two public Types forwarding pages were removed after updating references.
Unique contracts were preserved in the maintained destination guides.

| Existing docs | Maintained destination | Proposed action |
| --- | --- | --- |
| `docs/core-hook-map.md`, `docs/hooks-augmentation.md` | Public `hooks/hook-catalog.md` and `hooks/reference.md` | Replace competing catalogs/examples with pointers; `docs/hooks.md` already provides this pattern. |
| `docs/NOTIFICATION_CENTER_ARCHITECTURE.md` | Public `cloud/notifications.md` | Retire duplicated guide after reviewing unique architecture detail. |
| `docs/plugins/sidebar-plugin-guide.md`, `docs/custom-pane-apps-quickstart.md` | Public `start/mini-app-tutorial.md`, `database/posts.md`, and `plugins/first-plugin.md` | Consolidate tutorial entry points; distinguish source integration from portable packages. |
| `docs/workspace-profiles.md` | Public `architecture/workspace-profiles.md` | Keep one guide; replace the copied full schema with a source link. Preserve diagnostics and reset semantics. |
| `docs/activity-external-agents.md` | Public `architecture/activity-external-agents.md` plus package docs | Merge host ownership/security rules. Preserve unique OpenClaw/Hermes setup by relocating it to its owning package or a focused connection guide. |
| `docs/UI/DocumentationShell.md` | `docs/UI/documentation-system.md` | Retain useful component embedding examples in a short section; retire copied internals. |
| `docs/theme-backgrounds.md` | Public `themes/styling.md`, `themes/customize.md`, and `themes/api-reference.md` | Merge unique background-layer contract and upload troubleshooting. Its two Related links currently target missing files. |
| `docs/error-handling.md` | Public `utils/errors.md` | Merge useful error-code/tag reference after source validation, then use a pointer. |
| `docs/openrouter-integration.md` | Public `auth/` and `utils/openrouterStream.md` | Keep a short shared-adapter architecture note; remove duplicated usage/error catalogs. |
| Public `types/hooks.md` and `types/plugins.md` | `types/overview.md`, hook reference, and SDK reference | Fold the small import maps into the overview. These two pages mostly forward to other references. |
| Troubleshooting sections in public `cloud/sync-layer.md` and `cloud/notifications.md` | `cloud/troubleshooting.md` | Keep local contract explanations; centralize diagnosis and link to specific anchors. |
| Public `architecture/workspace-profiles.md` manual qualification narrative | Dated planning/qualification evidence | Move the Undici override and individual smoke-run narrative out of the user/reference guide; retain actual limitations. |

Merging the two small Types pages reduced mapped public routes from 97 to 95.
Incoming links and docmap were updated together, and the retired Markdown files
were removed so they are no longer served directly.

## Docs to retain separately

- Keep provider-specific guides. Basic Auth, Clerk, SQLite, Convex, filesystem,
  and S3 have distinct credentials, runtime boundaries, and operational rules.
- Keep `cloud/configure.md`, `config-reference.md`, and
  `environment-reference.md` distinct: configuration workflow, typed object
  contracts, and environment variables serve different tasks. Shorten duplicated
  examples instead of making a single enormous reference.
- Keep database file metadata, message-file relationships, and image queries
  distinct. Legacy URL attachments also need an explicit boundary; folding them
  indiscriminately into blob storage would imply incorrect lifecycle semantics.
- Keep portable manifest, SDK, CLI, connections, and runtime/security references
  distinct. They describe different boundaries, not redundant entry points.
- Keep `docs/cloud-updates.md` authoritative for deployment updates and retain
  release policy and historical evidence separately from feature guides.
- Keep `start/plugin-quickstart.md` as a deliberate short navigation bridge unless
  route compatibility is explicitly addressed. Its small size alone is not drift.
- Keep `docs/pane-plugin-api.md` until its remaining host-only contracts have a
  maintained replacement. Do not silently present them as portable SDK methods.

## Cleanup order

- [x] Correct public workflow routes and notification/background troubleshooting.
- [x] Retire the obsolete sidebar tutorial and notification architecture duplicate.
- [x] Consolidate hook docs and update `docs/README.md` to point to maintained guides.
- [x] Merge architecture/theme/error duplicates while preserving unique material.
- [x] Fold the two Types forwarding pages into the overview and update docmap/links.
- [x] Re-run `bun run check:docs` and inspect changed rendered pages.

The current checker validates all mapped public links but only a fixed list of
repository docs. Its example typechecks exclude Cloud, Themes, Hooks, Plugins,
and Workflows and exclude Vue templates. Consider expanding link coverage to
all maintained `docs/` pages and adding explicit runnable-example metadata
before expanding typechecks. Existing partial reference snippets should not be
treated as executable programs.
