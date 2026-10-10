# Startup performance verification — 2026-10-09

This change reduces initial loading work while retaining the existing composer,
editor extensions, animations, workspace boundaries, and settled layout. It does
**not** establish performance above 80 on mobile. No public deployment changed.

## Follow-up implementation and repeated comparison

This section supersedes the single-run candidate measurements below. The control
is the saved production output of `d0127c9cef195775e1f39853c7733e7d507f1fba`;
the candidate includes the subsequent import/catalog/modal changes on this branch.
Both used identical local-only feature flags, fresh Chrome profiles, Lighthouse
13.5.0 standard simulation, and `/chat`. Audits ran sequentially without builds
or tests. Both local HTTP/1.1 proxies gzip HTML and serve the build's Brotli assets.
This is a controlled local comparison, not the public deployment's HTTPS/HTTP2
transport or an authenticated Cloud qualification.

| Three-run result | Control | Candidate |
| --- | ---: | ---: |
| Mobile performance runs | 55, 56, 59 | 61, 59, 59 |
| Mobile performance median | 56 | 59 |
| Desktop performance runs | 93, 93, 94 | 92, 94, 93 |
| Desktop performance median | 93 | 93 |
| Mobile median FCP / Speed Index | 5.427 s | 5.865 s |
| Mobile median LCP | 7.981 s | 7.519 s |
| Mobile median TBT | 276 ms | 152 ms |
| Mobile median CLS | 0.00572 | 0.00572 |
| Desktop median LCP | 1.619 s | 1.486 s |
| Desktop median FCP | 0.942 s | 1.056 s |
| Root JavaScript preloads | 55 | 24 |
| Root preload gzip bytes | 874,407 | 559,236 |
| Full JavaScript raw bytes | 13,475,928 | 13,463,869 |
| Full JavaScript gzip bytes | 4,191,861 | 4,191,230 |
| Precache entries | 428 | 431 |

Startup preloaded JavaScript fell 36.0%, and all existing asset budgets pass without
raising a limit. Startup/chat-shell groups now use a 500,000-byte chunk target to
reduce splitting overhead while preserving execution order. Removing these groups
was rejected: the experiment produced 609 precache entries and 11.22 s mobile LCP.
FCP did not improve consistently, and the score remains below the earlier 81 target.
These changes must not be described as achieving the mobile performance target.
After reviewing these results, the user lowered expectations: 80 is aspirational,
and further score improvements must preserve responsive typing and navigation.

The implementation defers compaction/preview/request execution through existing
async operations; checks captured request/workspace ownership after loading; keeps
document tool definitions immediately available; and loads their handlers on use.
The moved document function bodies and tool definitions were compared against the
control and are unchanged. The host SDK and sync cleanup implementations load only
after their existing feature gates. Enabled plugin initialization remains awaited.

The native TipTap editor, extensions, chat controller, and expanded sidebar remain
eager. Closed settings and sidebar create/add dialogs load on use, and the settings
trigger warms its module on pointer/focus intent. Dialog instances remain mounted
after first activation to retain existing closing transitions. An empty disconnected
composer hydrates cached models/preferences and waits for a key, conversation, or
settings/model-selection intent before fetching a live catalog. Actual send
admission still resolves required model metadata. No auth probes were removed.

Final verification:

- Production build, unchanged asset gate, and documentation checks pass.
- Full Nuxt typecheck passes with published Basic Auth, SQLite/better-sqlite3 and
  filesystem providers and disposable local configuration. A missing template
  callback type in `ChatMemorySettings` was annotated without changing behavior.
- Ten affected Vitest suites pass: 150 tests for requests, model selection,
  compaction, document operations/tools, trusted plugin lifecycle, keys and logout.
- Seven production Chrome E2E cases pass, including the new disconnected-catalog,
  immediate typing, undo/redo and first-settings-opening check. That check failed
  on the original build because it fetched the catalog before settings opened.
- The cold desktop CLS case still fails at **0.04081266672503867** against its 0.03
  limit, identically on this candidate and the saved control. Its threshold remains
  unchanged; both reports/screenshots are retained.
- Manual Chrome first-use project/document dialogs open, focus, cancel and restore
  the unchanged 320px sidebar. iPhone 17 / iOS 26.5 Safari loads the final build,
  accepts typing, and keeps the composer above the software keyboard. Settings
  opening preserved the draft during the previous candidate check. Subsequent
  simulator coordinate input stopped resolving its window, so final drawer
  open/close was not requalified; Chrome responsive drawer checks pass.
- Authenticated Cloud/browser streaming journeys and physical-device performance
  were not requalified. Nothing was deployed.

Receipts are local under `output/startup-performance/next-pass/`: `paired-results.json`,
`paired-*.report.json/html`, trace/devtools logs, `assets4/production-build-assets.json`,
`e2e-final/`, `e2e-control/`, and `ios-final-keyboard.png`. The rest of this document
records the earlier pass and its original reproduction instructions.

## Measured results

The final PR candidate is based on `737dba5ee3018b29503f5b41b0b1b8c25daa0204`.
These are actual Nitro production builds, not Nuxt development servers. Lighthouse
13.5.0 used installed Google Chrome, fresh profiles, standard simulated mobile and
desktop presets, and `/chat`. No build or test runner ran during the audits.
Each score is a single run, not a median or a real-device performance claim.

| Final candidate | Mobile | Desktop |
| --- | ---: | ---: |
| Performance | 57 | 91 |
| Accessibility / best practices / SEO | 100 / 100 / 100 | 100 / 100 / 100 |
| First contentful paint | 5.114 s | 1.174 s |
| Largest contentful paint | 8.273 s | 1.640 s |
| Total blocking time | 276 ms | 0 ms |
| Cumulative layout shift | 0.0077 | 0.0255 |

A same-host desktop recheck of the saved pre-round-four build scored 83, with
2.629 s LCP and 0.0387 CLS. The final candidate scored 91 as shown above; it also
includes the newer base commit's changes, so this is not an isolated attribution
of the entire score difference to chunk grouping.

These final scores use direct localhost Nitro serving, without the deployment's
HTML-compressing proxy/CDN. A separate controlled experiment on the earlier
development snapshot used identical gzip-HTML proxies and Brotli assets:

| Controlled mobile comparison | Before import/chunk changes | Grouped candidate |
| --- | ---: | ---: |
| Performance | 62 | 62 |
| First contentful paint | 3.906 s | 3.618 s |
| Largest contentful paint | 11.522 s | 7.983 s |
| Total blocking time | 229 ms | 262 ms |

That comparison demonstrates about 31% earlier LCP, with no overall score gain.
Do not compare its compressed-HTML scores directly with the final raw-Nitro scores.
Lower-priority preload hints were also tried in the proxy, but are not shipped.
The user independently reported faster loading and conversation switching on the
port-4189 production preview; this is useful qualitative feedback, not a measured
thread-switch latency benchmark.

The final `/chat` response preloads **55 JavaScript files / 874,407 gzip bytes**,
versus 198 / 970,930 before the last import/chunk pass: 72% fewer preload requests
and about 10% fewer compressed preload bytes. The asset gate's `/200.html` numbers
describe the fallback shell, not the actual `/chat` route.

The complete final JavaScript output is 13,475,928 raw bytes / 4,191,861 gzip bytes,
with 428 PWA precache entries. Preserving module execution order during grouping
adds wrapper overhead: the raw-JS budget explicitly moves from 13.40 MB to 13.48 MB
(0.6%). The 4.2 MB gzip cap and all other original caps remain unchanged, including
the original 520-file precache cap. This is a documented startup/full-bundle
tradeoff, not a claim that the complete bundle became smaller.

## Implementation and safeguards

- Load disabled Cloud sync/storage and plugin runtime machinery only behind their
  existing gates. Enabled adapters still finish setup before application mounting.
- Keep history-tool registration immediate and load execution on first invocation.
  Capture the request workspace before loading and authorize reads afterward.
- Defer document conversion, uncached catalog SDK loading, and trusted SDK clients.
  Recheck workspace/authorization after added asynchronous boundaries.
- Publish validated theme profile metadata without loading inactive theme code.
- Start independent welcome-state reads together; share only overlapping reads for
  the same credential generation, workspace generation, and database.
- Mount mobile drawer content on first opening and retain it. Reject invalid saved
  widths and reserve existing sidebar spacing during startup.
- Group only the existing client entry and chat-shell dependency trees. Preserve
  execution order and clone client configuration so the SSR output is unaffected.

## Verification and limits

- Final production build and bundled-plugin output check: pass.
- Full Nuxt typecheck using the production comparison profile: pass.
- Focused auth, sync, workspace/logout, theme, history, conversion, plugin lifecycle,
  model readiness, and sidebar checks: **214 passed, 1 existing optional skip**.
- Documentation checks and final asset budgets: pass. Final diff checked.
- Installed-Chrome production E2E: **6 pass, 1 unresolved cold-CLS failure**. Fresh
  and invalid saved sidebar widths, responsive transitions, palette pointer/focus,
  mobile overflow, and stale search results pass. The cold test records CLS
  0.0408126667 against its 0.03 threshold. The identical value reproduced on the
  saved pre-round-four build before the final import/chunk changes. Its artifact
  attributes most of the shift to empty-state/theme sizing; it is not waived.
- Chrome manual verification covered composer typing/undo/redo, settings, and mobile
  drawer behavior. The preview user's existing conversation remained accessible.
- iPhone 17 Simulator, iOS 26.5 Safari: production page rendered; onboarding dismissal,
  typing, undo/redo, software-keyboard positioning, and drawer open/close verified.
  The unsent test draft was cleared. This does not substitute for physical-device
  performance, authenticated Cloud, streaming, or persistence qualification.

The remaining mobile bottleneck is cold first paint and meaningful content waiting
for the startup graph. Further work should separate first-screen readiness from chat
execution without removing editor capabilities or delaying interactive controls.
Authenticated Cloud startup and its repeated session refreshes need a separate
controlled comparison; anonymous and authenticated performance are different cases.

## Reproduction

Use installed dependencies with local aliases disabled. This is performance
qualification, not the clean fixed-profile release gate.

```sh
SSR_AUTH_ENABLED=false OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false \
OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false \
OR3_BACKGROUND_STREAMING_ENABLED=false OR3_USE_LOCAL_PACKAGES=false \
OR3_LOCAL_PROVIDERS=false OR3_PRODUCTION_JOURNEY_TEST_HARNESS=false bun run build

PORT=4195 HOST=127.0.0.1 SSR_AUTH_ENABLED=false bun .output/server/index.mjs
```

In a separate terminal, use Lighthouse 13.5.0 with installed Chrome against
`http://127.0.0.1:4195/chat`, standard mobile simulation, then `--preset=desktop`.
Audit sequentially without competing builds/tests. Save JSON/HTML and trace assets.

```sh
OR3_PERF_OUTPUT_DIR=output/startup-performance/assets bun run performance:production-build:check
bun run check:docs

OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true \
PW_PORT=4195 PW_CHANNEL=chrome bun node_modules/@playwright/test/cli.js test \
tests/e2e/production-chat-journey.spec.ts tests/e2e/command-palette.spec.ts \
--grep 'cold desktop startup|desktop startup reserves|opens globally|requires two clicks|fits the mobile viewport|typing a new query' \
--workers=1 --reporter=line --output=output/startup-performance/e2e
```

These selected browser cases exercise real `/chat` and `/` routes. They do not need
the separate journey fixture compiled into the audited production bundle. Browser
tests emit screenshots and JSON layout proof, including the unresolved CLS case.
Full audit JSON, HTML, traces, screenshots, and command logs are retained locally
under `output/startup-performance/` in the PR worktree; earlier controlled comparison
artifacts remain under the original performance worktree's `round-four/` folder.
