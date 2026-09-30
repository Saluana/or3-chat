# Plugin administration qualification

This is the scenario map and redacted evidence record for `tasks.md`. A checked
task requires the named behavior and its verification, not just a code path.

## Authoritative state and identities

| Fact | Source | Scope |
| --- | --- | --- |
| Published release | Signed marketplace release metadata and registry state | Registry release |
| Site visibility and future default | Versioned site plugin policy | Site and exact release |
| Installed/selected/candidate code | Package store and pointer | Site and exact digest |
| Acquisition stage | Durable acquisition operation | Plugin, release, acting workspace |
| Permission review and setup | Workspace settings and setup descriptors | Workspace and selected authority |
| Enablement | `plugins.enabled` through provider CAS | Workspace |
| Runtime observation | Portable or trusted activation registry | Browser, workspace, exact digest |
| System administration | Separate admin session | Site or authorized workspace |
| Marketplace and Library | Chat session plus Library coverage | User and workspace |

An admin session does not imply a Chat session. A package selected for the site
does not imply enablement, and an enabled workspace does not imply that this
browser has run the plugin. A successful update check leaves the current
selection active until promotion commits.

## Status scenarios

| Scenario | Expected status and next action | Existing or added check |
| --- | --- | --- |
| Disabled, site approval missing | Needs site approval; open site review | `lifecycle-view.test.ts`, site policy tests |
| Disabled, consent/setup missing | Disabled here; enable starts scoped checks | `lifecycle-view.test.ts` |
| Enabled, consent missing | Needs permissions; review exact authority | `lifecycle-view.test.ts`, grants route tests |
| Enabled, setup missing/blocked | Needs setup or attention; configure | `lifecycle-view.test.ts`, rollout service tests |
| Selected current, update candidate failed | Current remains selected; update shows failure separately | Update and acquisition tests |
| Enabled, browser unopened | Enabled; browser check pending | `lifecycle-view.test.ts`, MarketplaceInstalled tests |
| Running different digest or workspace | Unconfirmed; never active | MarketplaceInstalled tests |
| Exact trusted/portable activation | Active here, with browser scope | MarketplaceInstalled tests |
| Browser check times out | Not observed after 30 seconds; retry observation | MarketplaceInstalled tests and browser recovery journey |

## Failure and recovery scenarios

| Boundary | Scenarios to prove | Evidence |
| --- | --- | --- |
| Site policy | Empty migration, verified selected seed, hide survives restart, corrupt fails closed, quarantine, unapproved direct URL, direct acquisition/enablement, workspace-admin denial | Site policy, catalog, preflight, admission, enablement and acquisition route tests; 83 targeted security cases passed |
| Rollout | Stale preview, duplicate start, concurrent admins, write committed before response, setup block, deleted workspace, cancellation, new workspace default, 1,000 targets | `rollout-service`, `rollout-store`, SQLite HTTP integration, browser close/reopen, and anonymous local Convex private-setting CAS |
| Install/update | Consent/setup, session expiry, workspace switch, refresh, failed candidate with current active, scoped setup return | 18 Chromium dashboard journeys, marketplace component/route tests, and actual portable plugin promotion |
| Health | Wrong digest, unopened workspace, timeout, missing required or optional contribution | Lifecycle and Installed tests; actual restored portable dashboard activation in Chrome |
| Rollback | Quarantined previous release, incompatible state in another workspace, enabled set change, missing/disabled dependency or broken dependent, failure before and after pointer commit | Promotion/rollback tests and actual portable 0.3.0 → 0.2.0 Chrome restore receipt |

## Verification receipts

| Gate | Result |
| --- | --- |
| 1,000-workspace SQLite service restart and CAS run | Passed, 40 bounded batches; see `rollout-sqlite.integration.test.ts` |
| Marketplace desktop and mobile browser journeys | 18/18 Chromium journeys passed at one-worker concurrency against a local host with stubbed sessions and marketplace responses; `output/playwright/marketplace-admin/receipt.json` and screenshots. A simultaneous Nuxt build temporarily disrupted the disposable development server; a standalone rerun passed. |
| 1,000-workspace SQLite rollout HTTP route | Passed in 40 batches after provider reconnect; stale revision and unauthorized calls rejected; slow provider write returned pending and then committed under the plugin lock; `output/plugin-rollout-route-qualification.json` |
| 1,000-workspace SQLite deployment permission HTTP route | Passed with bounded 25-write groups, partial failure, and retry; `output/plugin-grants-route-qualification.json` |
| SQLite future-default journal recovery | Saved default survived journal failure and cancellation; `output/plugin-rollout-future-default-recovery.json` |
| SQLite provider admin store | 7/7 passed |
| Convex provider private settings/CAS tests | 19/19 passed with in-process Convex handlers and adapter mocks. A separate anonymous local Convex 1.31.7 deployment exercised the original private setting functions with concurrent enablement and grant-review CAS (one winner each), read-back, and ordinary-identity denial. `output/plugin-convex-local-qualification.json` records the redacted result; the configured endpoint was untouched. |
| Direct-route and security boundary tests | 83/83 passed across site policy, signed authority, local admission, acquisition, enablement, grants, preflight, rollback, and isolation |
| Library entitlement and delegated install tests | 46/46 passed across Library routes, buyer requests, service access, and protected plugin access |
| Workflows actual-plugin Chrome smoke | JSON import, `/` selection, no-model execution, and refresh persistence passed; `output/playwright/workflows-installed/no-model-smoke-receipt.json` |
| Portable actual-plugin Chrome smoke | 0.3.0 promotion, 0.3.0 → 0.2.0 exact impact review and restore, fresh-browser dashboard activation; `output/playwright/portable-admin/portable-restore-receipt.json` and screenshots. The disposable development watcher was frozen after restore so it would not automatically reapply 0.3.0. |
| Connected Nuxt typecheck and build | `bunx nuxi typecheck`, `bunx nuxt build`, and `bun scripts/plugin-runtime/check-production-build.ts --mode ssr` passed after the rollback dependency guard and server shared-module import fixes. |
| Final rollback and Configure regressions | 39/39 targeted Vitest cases and 18/18 Chromium dashboard journeys passed. The exit code review found three issues, now fixed: dependency-safe rollback, exclusion of a disabled admin workspace from the rollback state gate, and clearing stale acquisition context from Installed Configure. A no-enabled-workspace guard also rejects globally incompatible previous releases. |
| Final diff | `git diff --check` passed for the chat repository and both provider README changes. Reviewed the rollback, setup-navigation, browser evidence and administrator documentation changes while leaving unrelated dirty work untouched. |

No qualification here asserts model execution, global browser health, or a
production deployment.
