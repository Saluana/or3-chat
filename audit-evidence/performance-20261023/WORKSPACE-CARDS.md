# Workspace-switch card lifecycle audit

October 24, 2026. See [current status and remaining evaluations](STABILITY-STATUS.md).

## Investigated and fixed

Mounted tool cards captured their originating database and workspace generation.
The chat bridge already rejected stale actions, and its transaction guard ran
after asynchronous preparation hooks. That protected writes. However, a card's
Dexie subscription and plugin abort signal remained active until Vue unmounted
the host. Workspace switching can begin before that teardown completes.

Two mounted-owner regressions reproduce the gap using real workspace changes,
real Dexie rows, the actual card slot/context and its page renderer. They keep
the old host mounted while changing workspaces and mount a current host with the
same message/call IDs. One stays in the other workspace; the other returns to
the original database with a new generation.

Before the fix, the departing signal remained live and later call arguments
were still parsed. Three subsequent writes caused **three reads by the retired
host** when away. On return, the old and new hosts caused **six reads instead
of the current host's three**. Existing generation guards prevented these reads
from publishing later persisted values; this finding is unnecessary retained
work, not a demonstrated cross-workspace write or disclosure.

`ToolCardSlot` now owns a subscription to the existing workspace-change service.
A change immediately stops its state subscription, lazy-mount, visibility and
theme observers, removes the workspace subscription and aborts the public card
signal. A context captured before mounting is also checked before resources
start. A queued lazy-mount callback cannot mount an aborted card. The context
ignores state/call snapshots after disposal, so later projections do not parse
arguments/results or mutate its retired snapshot.

With the fix, the two regressions show zero departed-host reads when away and
only the three current-host reads on return. The old signal aborts once before
Vue unmount; the new context continues rendering all three stored values and
the changed arguments. Stale saves remain rejected. Both renderer cleanup
functions still run exactly once on actual unmount.

The resize observer remains until actual host teardown to retain existing
layout measurement. Plugin-owned asynchronous work must honor the abort signal,
as documented. This round does not claim that arbitrary plugin resources are
forcibly collectible before unmount, or qualify portable frame ports/budgets.

There are no template, CSS, theme, geometry, provider, schema, dependency-version
or live-data changes. The new lifecycle uses existing ownership and workspace
notification APIs; it adds no registry or authority store. Pending save ordering
and flush rules are unchanged. The public guide/docmap describe retirement.

## Validation

- Before repair, the [switch-away case](card-workspace-before.txt) and
  [return case](card-workspace-return-before.txt) each fail on the intended
  abort/snapshot/read assertions. They were run separately because the normal
  runner stops after its first failed case.
- [Focused cases](card-workspace-focused.txt): **2/2 pass** after repair.
- [Owner and sibling suites](card-workspace-after.txt): **69/69 pass** in three
  files: message transactions, mounted workspace thumbnail consumers and
  ChatContainer. These include the earlier failed-renderer, notification-batch,
  admitted-save ordering and reference-branch state contracts.
- [Existing Chromium journeys](card-workspace-browser.txt): **4/4 pass** for
  attributed quiz reply/state reload, crash fallback/timer isolation, trusted
  Vue activation teardown, and lazy mounting without tool reruns. The
  [receipt](card-workspace-browser.json) records the actual selected command and
  harness settings. Its supplemental 30-card scroll entry is not a fifth test
  or a memory/performance improvement claim. These journeys provide surrounding
  browser controls; the new workspace-switch behavior is proved by the mounted
  owner tests.
- [Supported Nuxt typecheck](card-workspace-typecheck.txt), targeted lint,
  [documentation checks](card-workspace-docs.txt) and final diff checks pass.
  Existing duplicate-import warnings remain. The first sandboxed typecheck
  could not open tsx's local IPC pipe; the unchanged supported command passed
  with permission to create that pipe.

The authoring gate for the new table is the independent mounted-resource
contract across an actual workspace generation change. Existing bridge-only
stale-action coverage never keeps a rendered host alive through that change.
No production test interface or copied dispatcher was introduced. The fixture
uses the suite's existing DB-selector/hook stubs, real workspace notifications,
real Dexie storage and actual card components; browser I/O and native observer
scheduling are not claimed by those owner tests.

## State and remaining evaluation

Fresh `origin/or3-cloud` fetch: upstream `25c758b2`; local `a996424a`, zero behind
and one ahead. The earlier image batch is committed. These workspace repairs
and preceding card/scroll repairs remain uncommitted. No push, PR or deployment
occurred. The existing production `.output` predates this repair; source tests,
typecheck and the development browser harness validate it. This round did not
repeat a production build or full repository suite.

Still open: sustained heap growth and repeated real account/workspace switching,
large workspaces and long tool arguments/results, portable frame teardown
qualification, rich-stream layout/worker cost, rapid large-wheel reversal,
physical Safari/iOS/Android behavior, private WebKit Blob storage, and the other
surfaces/provider combinations listed in the current report. The selected
resource regression closes one lifecycle defect rather than the entire audit.

## Reproduce

```sh
bun run test --project=core-app app/db/__tests__/messages-transactions.test.ts -t 'retires a mounted card'
bun run test --project=core-app app/db/__tests__/messages-transactions.test.ts app/components/chat/__tests__/workspace-thumbnails.test.ts app/components/chat/__tests__/ChatContainer.test.ts
```

For the browser controls, run the existing development harness on loopback
port 3116 with `OR3_TOOL_CARDS_TEST_HARNESS=true`,
`OR3_PLUGIN_CONTRIBUTION_V2_SURFACES=chat-tool-cards`, installed provider packages
selected and Cloud services disabled, then:

```sh
PW_SKIP_WEB_SERVER=true PW_PORT=3116 bunx playwright test tests/e2e/tool-cards.spec.ts --grep 'quiz executes inline|legacy placement, crashing card fallback|trusted Vue card uses|lazy cards mount' --workers=1 --reporter=line
```
