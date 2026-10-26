# OR3 public launch walkthrough results

**Public launch qualification is incomplete.** The Chrome walkthrough found and fixed a bug that replaced an unsent chat tab when opening a document. Two test/setup problems were also fixed. The full non-live test suite and static build passed, but performance gates failed and restore, live providers, real devices and deployment recovery remain unqualified.

> Generated captures linked below (screenshots, command logs, JSON receipts and the synthetic `.or3cloud` export) stayed in the local run directory and are not versioned, per the [audit evidence policy](../README.md). The [case ledger](case-results.md) is the versioned record.

The [311-case checklist](../../planning/public-launch-walkthrough/tasks.md) has **11 passed, 113 partial, 163 blocked, 22 not run and 2 failed** cases. These are compound acceptance cases, often containing several actions and failure variants. Partial observations do not check a case off. The [case ledger](case-results.md) states the observation and evidence for every case. This is a substantial local walkthrough, not a completed 311-case release qualification.

## Configuration and evidence

The walkthrough ran October 25–26, 2026, in Chrome 155.0.8059.85 on macOS using Computer Use. It covered desktop and a 390×844 browser viewport. A resized desktop browser does not qualify a real phone, software keyboard or another browser engine.

| Profile | Configuration | Proven boundary |
| --- | --- | --- |
| Disposable Cloud | Basic Auth, installed SQLite provider 0.0.22, filesystem provider 0.0.15; background execution disabled | Sign-in/out, workspace selection, local/Cloud documents, project settings, export, dashboard and admin surfaces |
| Local journey fixture | Auth/sync/storage disabled; scripted provider and fake test key | Chat streaming, errors, stop/retry, branches, response documents, workspace tools and native compaction |
| Static production build | Journey harness and Cloud disabled; served emitted assets over loopback | Cold startup, independent draft/document tabs, save/reload, Unicode search and theme switching |

The source was `8e8557404d91eb6057a1d8d49faf9f7de6f34230`, package version 0.1.91, plus the user's existing changes and the focused fixes below. [Source identity](source-receipt.json), [installed provider identity](cloud-profile.json) and [static artifact digest](static-artifact-receipt.json) are retained. Node 24.22.1 matches `.node-version`; installed Bun 1.4.4 differs from the requested 1.3.14. Dependencies and global runtimes were not replaced.

No live model acceptance, real-user data mutation, production deployment, package publication, account permission expansion or major UI redesign was performed. The Cloud profile had no real model credentials. Scripted inference does not establish released-provider behavior or model output quality.

## Fixed defects

| Finding | Repair | Verification |
| --- | --- | --- |
| Opening a project document replaced a blank chat tab containing an unsent draft | The tab host now captures the composer before checking whether the blank tab is reusable. Text, attachments, missing references and large text blocks preserve the tab; pending draft hydration is treated conservatively. | [Before](005-draft-tab-replaced-bug.png), [after](006-draft-preserved-after-fix.png), [reload](007-draft-survives-reload.png), and [static build](042-static-document-reloaded.png). The new owner-boundary regression failed before the repair and passed afterward. |
| Disposable Cloud journey startup used the wrong generated TypeScript directory and inherited an unavailable secret provider | Align the copied TypeScript references with the journey build directory and explicitly disable personal-key persistence in this disposable profile | Cloud profile booted and completed the recorded manual flows; 49 focused setup/credential tests passed. This profile does not qualify personal-key custody. |
| A missing-credential test depended on the developer's ambient OpenRouter key | Explicitly stub and restore the credential environment in that test | The initial core failure disappeared; full non-live qualification passed. No production credential handling was changed. |

The seven-file focused patch landed with [#312](https://github.com/Saluana/or3-chat/pull/312). Production code changed only the draft-preservation path. Existing unrelated sync, storage, notification and other worktree edits remain in place. Temporary diagnostic logging used while investigating the scripted tool failure was removed.

## Observed browser results

| Area | Direct observation | Evidence |
| --- | --- | --- |
| Entry and accounts | Invalid/valid disposable sign-in; separate OR3 and OpenRouter access; signed-out chat/project/document actions ask for sign-in. Logout clears the visible workspace; same-account sign-in recovers the document and tabs. | [Signed out](047-cloud-signed-out.png), [recovered](048-cloud-data-after-signin.png) |
| Chat | Multiline/Unicode/RTL input, scripted streaming, partial failure/retry, stop with retained partial output, reload, safe 401/402 messages, code copy, long URL/table/code rendering | [Completed](021-scripted-chat-completed.png), [retry](023-chat-retry-completed.png), [stop](024-chat-stopped-partial.png), [401](030-provider-auth-error.png), [402](031-provider-credit-error.png) |
| Chat history | Branch and edit a child while preserving the original; convert a response to a document; repeating the unchanged action opens the same record in another pane | [Child edit](028-branch-message-edited.png), [original](029-original-after-branch-edit.png), [document views](027-two-document-views.png) |
| Documents | Create globally/from project/from response; save title/body; literal markup stays inert; find/replace-all; H2 and emphasis; Undo/Redo; checkpoint preview and restoration; recoverable Trash/Restore | [Reload](003-document-reloaded.png), [search](008-search-edited-content.png), [Trash](009-document-trash.png), [restore](010-restored-document.png), [history](039-document-version-restored.png) |
| Projects and prompts | Project brief/instructions, document Knowledge bindings, source preview/Ready status, Always include selector, manual memory add/edit, saved prompt tag/favorite | [Memory](036-project-memory-saved.png), [settings](037-project-settings-saved.png), [prompt](038-prompt-library-saved.png) |
| Workspace tools | Search/read synthetic source; stage proposal; explicit review/Apply; receipt survives reload; Undo restores original. A subsequent manual edit blocks stale proposal review and offers Update proposal/Discard. | [Applied](043-reviewed-edit-applied.png), [undone](044-reviewed-edit-undone.png), [stale proposal](045-stale-proposal-blocked.png) |
| Compaction | Native Chat settings Compact action creates a linked version using scripted summary transport, retains unsent draft, and opens source history from the landmark | [Compaction](046-native-compaction.png) |
| Workspace isolation | New workspace starts without original project/document; original document link is unavailable there; switch-back restores original content | [Second workspace](016-empty-second-workspace.png), [refused link](017-cross-workspace-document-unavailable.png), [switch back](018-original-workspace-restored.png) |
| Dashboard and admin | Visited all seven dashboard tiles and every main admin destination. Unconfigured Marketplace/Library, missing workflow package, disabled jobs and unavailable operational capabilities are explained. Invalid webhook URL is rejected without creating a subscription. | [Marketplace](019-marketplace-unconfigured.png), [webhook](014-webhook-invalid-url.png), [admin](040-admin-overview.png), [operations](admin-operations.png) |
| Layout and appearance | Narrow composer, drawer, tab filter and long-content containment; representative Blank/Retro/Cyberpunk light/dark controls. Baseline Blank/light restored after checks. | [Narrow chat](033-mobile-chat-layout.png), [drawer](034-mobile-navigation.png), [tabs](035-mobile-tabs-filter.png), [Retro](049-retro-dark.png), [Cyberpunk](051-cyberpunk-light.png) |

An initial scripted workspace-tool request failed with a safe 502 response. Retry and a subsequent new proposal completed. The original cause was not isolated; this remains an observation to reproduce on the actual configured provider, not a claimed repaired defect. Scripted title generation was unavailable and fallback conversation titles remained usable.

Reloading a foreground response recovered the last durable partial and eventually showed an actionable failed/Continue state after the ownership lease expired. A reload immediately after the first token can happen before the persistence debounce; this run does not claim that every displayed trailing token survives forced interruption. No late old-page output was observed overwriting recovery.

## Validation and failed gates

| Check | Result |
| --- | --- |
| Full non-live suite | **738 files; 6,817 passed; 1 skipped.** Includes scripts, release-policy and plugin-compatibility projects. [Log](full-tests.log) |
| Separate integration lane | **724 passed; 1 skipped.** [Log](integration-tests.log) |
| Draft owner/composer suites | **68 passed.** [Pre-fix failure](draft-regression-before.log), [post-fix](draft-regression-after.log) |
| Focused setup/credential suites | **49 passed.** [Log](focused-setup-tests.log) |
| Type check, import/doc checks, focused lint | **Passed.** [Types](type-check.log), [imports](import-check.log), [docs](docs-check.log), [lint](lint-changed.log) |
| Static production generation | **Passed**, followed by actual Chrome smoke of emitted assets. [Build](static-build.log), [artifact receipt](static-artifact-receipt.json) |
| Static fixture exclusion | No known journey UI, fake key or devtools markers in emitted JS/HTML/JSON. Fixture URL did not expose fixture UI. [Receipt](static-artifact-receipt.json) |
| Asset budgets | **Failed:** JS raw **13,823,753 / 13,480,000** bytes; JS gzip **4,413,150 / 4,200,000** bytes; precache raw **19,659,281 / 18,400,000** bytes. Other recorded budgets passed. [Report](production-build-assets.json) |
| Populated workspace | **Failed seed-time budget:** 1,200 threads / 14,400 messages seeded in **6,311.76 ms**, then **6,048.16 ms** after stopping owned test servers; limit **6,000 ms**. Idle-run recent lookup 2 ms, search 32.12 ms, transcript 1.22 ms and heap delta 32,072,968 bytes passed. [First run](populated-workspace-busy.json), [idle run](populated-workspace-idle.json) |

Performance limits were not relaxed. The asset result needs focused optimization and another build; the near-threshold seed result needs qualification on the repository's controlled performance environment. These measurements do not establish real-user loading latency, Core Web Vitals, concurrency capacity or a memory-leak verdict. Browser performance tracing was unavailable after the permission rejection.

The production build also reports existing duplicate-import warnings and a trusted-host plugin loader qualification warning. Successful compilation does not qualify browser plugin activation or remove those restrictions.

## Backup and remaining launch requirements

The Cloud UI exported [a synthetic `.or3cloud` archive](or3-workspace-2026-10-26T06-28-23.or3cloud), 7,560 bytes. The canonical parser validated all checksums and terminal counts; the expected document was present. [Validation](backup-validation.json) records its SHA-256. The archive contains metadata, four KV records, eight posts and one project, with no original-file coverage. **An export that validates is not a proven restore.**

Before public launch, the open requirements include:

- Select the exact immutable staging candidate, advertised providers/features and supported devices. Repeat the core journey on that configuration with real model credentials and a bounded spend allowance.
- Resolve the failed asset gate and qualify the seed-time result. Retain the final artifact identity and repeat affected smoke tests after changes.
- Complete permitted original-file upload, Cloud fresh-workspace restore, original-byte/hash comparisons, multi-client offline/sync recovery and operator backup/rollback rehearsal.
- Qualify additional account/role/invite policies, real phones and browser engines, keyboard/screen-reader accessibility, configured background jobs, notifications/webhooks and included plugins/workflows/agents.
- Complete the remaining unexecuted cases in the ledger, confirm public policy/help/support links, obtain an independent-user walkthrough, then record release and operations sign-off.

No package/image was published, release version bumped, deployment changed or launch sign-off issued. Test tabs and owned servers were stopped, and the three owned temporary profile directories were removed. [Cleanup receipt](cleanup.json) records the exact paths and ports. Evidence and the synthetic archive remain in this directory; disposable browser-origin storage was not cleared through a permanent-deletion action.

Browser automatic approval rejected the synthetic file upload and raw CDP network fault-injection setup, reporting that permission was declined. The rejected operations were not bypassed through shell automation, another browser API, a different origin or alternate file-intake path. Those acceptance cases remain open.
