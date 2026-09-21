# Portable client containment and setup

The portable client profile (`or3-portable-client-v1`) runs publisher code inside
a host-owned sandbox. This page records what the sandbox can and cannot reach, the
recorded budgets, and how setup and permissions are presented.

## Containment

publisher code is data-only in the host realm: the host verifies the exact bytes
it serves, then hands those bytes to a sandbox that imports only that module. The
host window never evaluates publisher code.

The boundary is an **opaque-origin sandboxed frame** (`sandbox="allow-scripts"`,
no `allow-same-origin`) that hosts the plugin worker. The worker inherits the
frame's opaque origin, which is what denies host storage — no CSP directive
covers IndexedDB, so the origin is the boundary. The frame's script is authorised
by an exact CSP hash (an opaque origin makes `'self'` meaningless), and
`connect-src 'none'` removes unmediated network.

Measured in real browsers (Chromium, Firefox, WebKit and mobile Safari) by
loading the production frame and probing the worker. Containment is proved by
comparison rather than by absence: the same probe module runs uncontained in a
control worker on the host origin and must *reach* the same reachable targets
(a live HTTP route and a live WebSocket endpoint), so a denied result in the sandbox
is a policy denial rather than a broken target or a probe that never executed. A
probe that does not answer is reported as unanswered, not as a denial. The raw
per-engine evidence is committed under
`tests/plugin-runtime/evidence/containment-probe-<engine>.json`.

Every attempt below was denied in all four engines:

Denied channels:

* parent/host DOM, `window.top`, `frameElement`
* cookies, `localStorage`, `sessionStorage`, host IndexedDB
* `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`
* `importScripts`, dynamic remote imports, host-internal imports
* nested/shared/service workers (a nested worker inherits the opaque origin and
  the same CSP, so it too reaches no storage and no network)
* frame and top-level navigation, `window.open`
* clipboard, geolocation, notifications
* `eval` and `new Function`

A worker created directly by the host page shares the host origin and *can*
reach IndexedDB; that prototype was measured failing and is not the shipped
transport.

Two capabilities exist **only** through host methods, never as browser APIs:

| Capability | Host method |
|---|---|
| Outbound network | `connections.dispatch` and `ai.complete`, both grant-gated and policy-checked server-side |
| Plugin state | `storage.get` / `storage.getRecord` / `storage.set` / `storage.listPage` |

### Message identity

The host mints a per-sandbox session for the contained worker and an opaque
activation handle for the authenticated capability bridge. The handle is sealed
to the plugin, workspace, acting user, generation, selected immutable package
digest and approved grant review. A forged identity, a stale generation after
disable/update/workspace switch, or an opaque-origin message without the
matching host state is denied **before** any handler runs. `origin === 'null'`
is never treated as identity.

The activation handle is created before the sandbox starts and is the only
identity sent to the capability endpoint. The host revalidates the selected
package and current grant review on every request. Stop, logout, workspace
switch, update, disable and fatal teardown explicitly revoke the handle, while
server expiry remains a bounded fallback; a replacement sandbox therefore
cannot reuse the previous activation's authority.

Admission state (in-flight calls, recent request IDs, cancellation handles)
is keyed by the activation handle and spans HTTP requests: two calls that share
an activation and request ID are a duplicate whether they arrive on one
connection or two, and concurrent calls share one per-activation limit (8).
The same request ID under a different activation is a different call. Pure
reads keep a bounded, expiring window (256 IDs, 5-minute TTL); side-effecting
calls (`ai.complete`, `connections.dispatch`) keep their fingerprints for the
life of the activation (bounded at 1000, matching the per-activation call
budget), and further side effects are refused once that history fills rather
than evicting still-relevant entries. Activation teardown forgets both
histories together.

### Host capabilities

The runtime registers host methods for an activation **only when the activation's
approved grants cover them**, and the broker re-checks the grant on every call.
Server-owned capabilities (governed model completions, approved connection
dispatch) are reached through an authenticated host endpoint. Before a sandbox
starts, the host mints an opaque activation handle
(`POST /api/plugins/isolation/activation`): the route re-checks the session, the
plugin's installed/enabled/access state, the current selected package digest and
its current approved review, then seals all of it into the record. The capability
endpoint carries only that handle plus the method and parameters — plugin,
workspace, user, generation, digest and grants are read from the record, never
from the request. A handle that is unknown, expired, revoked, used from another
session, or whose selected package changed is refused before any method runs, and
the endpoint dispatches through the same host RPC broker as the in-page bridge,
so grant denial, the host-clamped deadline and cancellation apply identically.
Replay and concurrency are enforced at activation scope across requests (see
above), not per broker. Disconnecting the client aborts the in-flight handler,
and revoking the activation aborts every remaining call. The AI spend governor
is keyed to the acting identity, not the activation, so a new activation cannot
reset a spent budget.

Replay policy is fail-closed for every method: a duplicate request ID within
the replay window is rejected as `replay`, even when the method or params
differ. A pure read (`ai.models`) may be issued again under a new request ID
to recompute safely. A provider call (`ai.complete`) or external write
(`connections.dispatch`) with an uncertain outcome — lost response, timeout,
disconnect, crash — is never auto-retried: the caller surfaces the failure and
waits for an explicit user-driven retry under a new ID. `ai.complete` reserves
worst-case spend in the durable ledger before dispatch (at most 64 in-flight
reservations per budget window) and settles worst-case on crash, so a second
attempt cannot double-spend the same reservation; `connections.dispatch` has no
provider idempotency guarantee, so a lost response is an unknown outcome.

Lifecycle refusals (expired, revoked, stale handles) preserve the server's
`data.code` to the host runtime, which stops only the matching activation
generation — rendered state and typed fields survive — and offers an explicit
restart. Restart refreshes the package source and mints through current
authority checks; the failed operation is never replayed.

### UI events and contributions

Plugins send UI as data: `ui.render` is validated against the primitive schema
and the UI-tree budgets before the host renders it, `ui.contribute` registers a
slot contribution for this activation only, and `ui.withdraw` (or teardown)
removes them. An invalid tree is reported, never rendered. The typed client for
plugins is `createPortableClient` in `@or3/plugin-sdk/portable`.

The portable profile renders dashboard contributions (`ui.dashboard.card`) on the
plugin's own dashboard surface: each registered card is shown with the same
host renderer as `ui.render`, and withdrawing it removes the card. A contribution
is never stored without a place to appear.

### Budgets

| Budget | Value |
|---|---|
| Message size (measured on the value, including nested objects) | 256 KiB, depth 32, 20 000 values |
| Single result | 1 MiB |
| Total output per activation | 4 MiB |
| Calls per activation | 1000 |
| Concurrent calls | 8 |
| Per-call deadline | 10 s |
| Activation wall clock | 120 s |
| UI tree depth / nodes / text / items | 8 / 200 / 16 KiB / 2048 items |
| AI spend per user/workspace/plugin UTC budget window | $1.00 |
| AI output per call | 4096 tokens |

The runtime ledger for each activation is charged at each boundary: inbound
messages, outbound results/states, admitted calls (host-clamped deadlines) and
UI updates. AI spend is also reserved in a durable ledger keyed by the acting
user, workspace, plugin and named UTC budget window, so a new activation or
process does not reset committed spend. A UI tree is measured in one bounded pass over *everything the
renderer can show* — text, markdown, captions, table cells, list labels and
descriptions, option labels, placeholders and field values — plus its nodes, depth
and total array entries/object members, so a table full of large cells cannot hide
behind "one node with no text". A host timer ends the activation when its wall-clock budget is
spent, even if the sandbox has gone quiet, and a terminal breach terminates the
worker and cancels its outstanding work instead of only failing one call. These
are host limits, not OS-level memory or CPU isolation.

Because the budget is finite, activation is demand-driven: a package starts when
its surface opens, not for every enabled plugin during manifest synchronization. A
stopped package offers a restart from its surface, and the last rendered tree plus
the host field store survive the stop so typed values are not lost.

## Grantable UI primitives

Plugins describe UI as data; the host renders it with host components (text,
sanitized markdown, links, rows/columns, forms with text/textarea/select/toggle
fields, tables, lists, progress, buttons, results and open-document/open-pane).
Markdown is sanitized by escaping every publisher character before a small
supported subset is emitted. Functions, component handles and unknown node types
are rejected.

Form buttons keep the action they declare: only a button whose action is `submit`
submits the form, and it does so through the form's own submit event so native
`required` validation runs first. Cancel and Delete therefore stay distinguishable
from Save and never submit implicitly. Field values are host-owned: a declarative
update initializes newly introduced fields, leaves what you typed alone, follows
the plugin's value for untouched fields, and drops state only when the field
disappears. The host can replace or reset values explicitly.

## Permissions and consent

Consent is bound to what a release can actually do, not only to its grant
strings. The effective authority hash covers grants, outbound destinations with
methods and paths, connection scopes, data scopes, writes, trust profile, setup
hooks, engines, features and dependency metadata, and it is tied to the exact
release.

* Adding a hostname, method, path, scope, write, hook, engine, feature or
  dependency requires fresh consent even when no grant string changed.
* Narrowing authority passes technical review without redundant broad consent.
* A change of release or generation makes previous consent stale.
* Switching the connection behind an unchanged destination counts as a change
  (the connection identity participates in the hash), and several destinations on
  one host are compared individually instead of collapsing into one entry.

The persisted approval record carries the release id, the reviewed candidate
digest, the signed authority hash and the full declared authority, and its
revision covers all of them. Recording consent requires the reviewer to submit
the candidate digest and authority hash they were shown, so a candidate that is
replaced between displaying permissions and saving the approval is refused
instead of silently approved. Promotion and runtime eligibility evaluate the
same record per enabled workspace, so an instance-wide update that widens any
workspace's authority stays blocked until that workspace approves it. A
registry-only approval (before bytes are staged) carries over only to the exact
same signed authority.

Destructive, external-write, purchase, credential, grant and background actions
always need an approval that only the host UI can mint. An approval-shaped object
arriving from plugin code, model output or tool text is refused as forged, so AI
can never authorize a purchase, a permission or a destructive write.

## Setup

Setup is host-generated from the package's own `or3.setup.json` and
`or3.package-policy.json`:

* required settings without a safe default must be provided. Values are validated
  against the installed package's own field schema on save: unknown keys are
  refused, select values must be one of the declared choices, numbers are
  normalized, and an empty required value does not count as supplied — so the
  plan's "missing" flag and the save endpoint agree;
* optional settings are configurable from the same form (under "Optional
  settings"); they are deferrable, not hidden;
* saved settings live in the workspace settings store, scoped to the exact
  package digest they were written for. The form hydrates from the *validated
  saved values*, and saving sends a patch of only the fields you edited, so a
  refresh can never replace stored values with defaults you never touched. A
  save carries the revision the form loaded; a concurrent save is refused with
  `setup-values-conflict` instead of overwritten. Patch-style writes without a
  form revision (a plugin setting one key while you edit another) retry inside
  the store's compare-and-set loop, so both edits land. The plan returns the
  values and the revision from one settings read, so a concurrent write can
  never pair stale values with a newer revision;
* every setup consumer resolves the same verified package selection. A pointer
  that recovered to `previous` selects that verified version everywhere; a
  blocked pointer (corrupt pointer file, or an unavailable current version with
  no usable previous) is reported as blocked and is never silently replaced by
  a legacy extension directory with the same id. Only a plugin with no V2
  pointer at all resolves as a legacy extension. A recorded candidate that no
  longer verifies is a blocker, not a reason to silently configure the running
  version;
* a setup save runs under the same per-plugin lifecycle lease as promotion and
  rollback: the package selection, acquisition binding and settings write are
  revalidated while the lease is held, so a successful save cannot be lost to a
  promotion that copies the candidate overlay and swaps the pointer. A save
  that arrives after promotion conflicts (`setup-operation-conflict`) instead of
  writing into a document the promotion already committed;
* preparing an update writes the candidate's configuration under the
  candidate's digest, never the running version's document. A canceled, failed
  or crashed update therefore leaves live configuration untouched, and
  promotion commits the pair by swapping the pointer. Values saved before
  digest scoping, or an update that never saved its own, are inherited through
  the unscoped document for the first read only; a scoped document, once it
  exists, is authoritative — corrupt included. A reinstall inherits the
  retained record for the exact package digest, and its first patch merges
  against those values rather than replacing them;
* the running plugin reads and writes its own version: runtime settings
  requests resolve `current` (never a candidate) and must present both the
  exact package digest their activation executes and the host activation handle
  that sealed it. The handle's user, workspace, plugin, digest, enablement,
  access policy and approved grants are re-checked live, so a write from a
  revoked, expired, disabled or superseded activation is refused instead of
  landing after disable or rollback. Activation validity is checked again inside
  the settings commit guard — on every compare-and-set attempt and after the
  write, with the previous document restored if a revocation landed while the
  write was in flight — so revoking during a descriptor or settings read cannot
  be outrun. The setup page and the acquisition readiness check resolve the
  candidate while one is pending;
* a plugin that only saves settings (no AI or connection calls) gets the same
  lifecycle handling as remote capabilities: a refused settings write stops the
  matching activation through the epoch/generation-scoped stale handler, keeps
  the rendered view and typed values, and requires an explicit restart. The
  failed write is never replayed;
* capability preparation is raced against the call deadline and client
  disconnect: a stalled budget read no longer retains an admission slot, and an
  abandoned preparation cannot dispatch after the request fails closed;
* required connections must be bound to the slot the package declares, connected
  **and** pass their test. A stored credential satisfies only the slot it was
  created for, and a slot is refused when the registered provider does not
  implement its declared mechanism, scopes or operations. Credentials stay
  scoped to the acting local user, workspace, plugin and slot; another member
  never inherits the installer's connection;
* a connection created for a pending candidate is bound to the acquisition
  operation that recorded that exact digest. A candidate whose operation is
  missing, replaced, ambiguous or belongs to another workspace is refused with
  `setup-operation-conflict`; a runtime connection request that names a stale
  operation is refused the same way, and a stale setup page that names a
  different package digest is refused with `setup-package-conflict`. The
  connection **test** applies the same binding, so an orphaned or
  foreign-workspace candidate can never drive a test with your credentials.
  Both creation and testing hold the per-plugin lifecycle lease across
  selection, binding and the credential write/dispatch, so a promotion,
  rollback or cancellation cannot replace the candidate between the decision
  and the action; a busy lifecycle answers `setup-package-busy`;
* a setup plan for a candidate whose owning operation is missing or ambiguous is
  refused with `setup-operation-conflict` rather than rendered with an empty
  operation, and a plan whose package identity changes while it is built is
  retried once and then refused with `setup-package-conflict`;
* the setup page can connect the account: it stores the credential for a declared
  slot (the provider and scopes come from the package policy, not the request) and
  then tests it. When the host has no encryption key, the page says so and
  disables connecting instead of failing silently;
* the setup test's operation and URL are resolved on the server from the
  provider's approved operation and the release policy for the bound slot; the
  page never constructs a privileged dispatch target;
* readiness and the first-action handoff are built from the same server state, so
  a plan cannot report `Ready` while the handoff refuses;
* `Needs setup` is never reported as `Ready`, and an unsupported mechanism is
  reported as blocked rather than attempted;
* the first action runs on your selection or on the package sample — never with a
  `.env` file, a terminal command or a manual archive extraction. A selection is
  carried into the setup page by the host UI, and a handle is minted only into a
  live activation's own generation; with no live activation the host reports the
  handoff as pending instead of returning a handle nothing could resolve.

## Provider costs

Plugin-attributed AI calls use your configured model provider credential, which
stays on the host. Usage is attributed to the plugin, the provider's charge is
disclosed next to the action, and spend/output/concurrency limits are enforced.
The durable spend limit belongs to the user, workspace, plugin and current UTC
budget window, while output and concurrency remain activation-local:

* the worst-case cost of a call is **reserved before dispatch**, so concurrent
  calls cannot each assume the whole remaining budget, and further calls are
  refused once the budget-window limit is committed;
* models must have a host-configured price — an unpriced model is refused rather
  than recorded as free;
* a provider response without usable token usage fails closed instead of being
  accounted as zero;
* a failed or cancelled call releases its concurrency slot exactly once, so
  repeated failures cannot exhaust the activation;
* a refusal keeps the server's own structured code end to end — an exhausted
  budget arrives as `budget-exceeded`, a provider outage as `unavailable`, an
  internal failure as `internal` — instead of every non-2xx becoming a
  permission problem.

Paid completions are not reachable through generic connection dispatch: that
operation is declared as governed by `ai.complete`, so there is only one policy
in front of the provider charge.

## Activation renewal and restart behavior

Stale calls fail closed: an unknown, expired or revoked handle is refused
before any method runs, and a replacement activation is minted only after the
current installed/enabled/access/package/review checks pass. The last rendered
tree plus the host field store survive a stop so typed values are not lost, but
uncertain external writes are never auto-replayed.

| Event | Behavior |
|---|---|
| Activation expiry while the tab remains open | In-flight calls run to their deadline; the next call is refused as `activation-expired` and the surface offers a restart, which mints a fresh handle after the current authority checks. |
| Server restart | Handles and admission state are process-local and forgotten together; every old handle is refused as `activation-unknown` and the surface must remint. Committed AI spend survives in the durable ledger; in-flight reservations recover as worst-case spend after their TTL. |
| Capacity eviction (512 activations) | The oldest handle is dropped and its in-flight calls aborted; the next call on it is refused as `activation-unknown` and must remint. |
| Plugin/package update (promotion) or rollback | The promotion service revokes live handles at its shared commit point and aborts their in-flight calls; further calls are refused and the surface restarts on the newly selected package after fresh consent when authority widened. |
| Disable | Live handles for that plugin and workspace are revoked proactively and their in-flight calls aborted; data and acquired versions remain. |
| Logout | Basic-auth sign-out revokes the user's handles at the sign-out route while the session is still valid. The client also stops every runtime and attempts teardown; teardown accepts a same-user handle from any workspace, so post-transition cleanup succeeds. Clerk sign-out has no server signal in-repo: local runtimes stop in every tab and handles expire within 30 minutes; every call re-validates live authority, so a handle reused after re-login grants nothing beyond current authorization. |
| Workspace switch | The server revokes the switching user's handles in the workspace being left when the switch commits (never workspace-wide, so other users are unaffected); the client stops its runtimes and its teardown DELETE succeeds cross-workspace for the same user. |
| Multi-process routing | Not supported at launch. The qualified topology is a single Node process per host; handles must not be shared across replicas, and a load balancer must provide session affinity or, preferably, a single instance. |

## Qualifying containment

`bun run plugin-runtime:containment:qualify` runs the suite in Chromium, Firefox,
WebKit and mobile Safari, records each engine in
`tests/plugin-runtime/evidence/containment-qualification.json`, and additionally
qualifies teardown through the **real startup API** with a live worker, an
outstanding call and a registered contribution: the call settles as cancelled,
contributions are withdrawn, the frame is removed, and the host page stays
usable. The probe routes and the harness that exposes the startup API to a
qualification page exist only while `OR3_CONTAINMENT_PROBE_ENABLED=true`; no
normal profile sets it.

### Qualified browsers

Containment is *measured* in Chromium, Firefox, WebKit and mobile Safari, but a
measured probe is not a qualified runtime. An engine is only enabled for the
portable client profile once the containment suite and the lifecycle
qualification above both pass for it; today that is Chromium only. The host's
structured client-profile declaration lists exactly the qualified engines, the
marketplace preflight reports `client-engine-unsupported` for any other engine
(including an unrecognized user agent), and the install action is replaced with
an explicit unsupported-browser state, read-only discovery and a copyable plugin
link. The runtime repeats the same check through `assessPortableHost` before it
fetches a single byte, so an unqualified engine is refused structurally rather
than by convention.
