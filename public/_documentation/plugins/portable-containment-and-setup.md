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
| Plugin state | `storage.get` / `storage.set` |

### Message identity

The host mints a per-sandbox session (plugin, workspace, generation, source) and
sends it in the bootstrap message. Every request must echo it. A forged plugin or
workspace id, a stale generation after disable/update/workspace switch, or an
opaque-origin message without the matching session is denied **before** any
handler runs. `origin === 'null'` is never treated as identity.

The session is created for every portable activation and bound to the sandbox the
host actually started, so it cannot be supplied or skipped by a caller. The
host-owned frame shim stamps it onto outbound requests, which means plugin code
never handles it — and terminating the activation retires it permanently, so the
same request can never be replayed against a replacement sandbox.

### Host capabilities

The runtime registers host methods for an activation **only when the activation's
approved grants cover them**, and the broker re-checks the grant on every call.
Server-owned capabilities (governed model completions, approved connection
dispatch) are reached through an authenticated host endpoint: it requires an
authenticated session in the workspace with `workspace.write`, a same-origin
mutation with the plugin intent header, an installed and enabled plugin, and then
re-derives plugin, workspace, user, owner and credential from server records.
Nothing the sandbox sends is treated as authority.

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
| AI spend per activation | $1.00 |
| AI output per call | 4096 tokens |

One ledger per activation is owned by the runtime and charged at each boundary:
inbound messages, outbound results/states, admitted calls (host-clamped deadlines)
and UI updates. A UI tree is measured in one bounded pass over *everything the
renderer can show* — text, markdown, captions, table cells, list labels and
descriptions, option labels, placeholders and field values — plus its nodes, depth
and total array entries/object members, so a table full of large cells cannot hide
behind "one node with no text". A host timer ends the activation when its wall-clock budget is
spent, even if the sandbox has gone quiet, and a terminal breach terminates the
worker and cancels its outstanding work instead of only failing one call. These
are host limits, not OS-level memory or CPU isolation.

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
methods and paths, connection scopes, data scopes, trust profile, setup hooks and
dependency metadata, and it is tied to the exact release.

* Adding a hostname, method, path, scope, write, hook or dependency requires fresh
  consent even when no grant string changed.
* Narrowing authority passes technical review without redundant broad consent.
* A change of release or generation makes previous consent stale.
* Switching the connection behind an unchanged destination counts as a change
  (the connection identity participates in the hash), and several destinations on
  one host are compared individually instead of collapsing into one entry.

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
* saved settings live in the workspace settings store. The form hydrates from the
  *validated saved values*, and saving sends a patch of only the fields you
  edited, so a refresh can never replace stored values with defaults you never
  touched;
* required connections must be bound to the slot the package declares, connected
  **and** pass their test. A stored credential satisfies only the slot it was
  created for, and a slot is refused when the registered provider does not
  implement its declared mechanism, scopes or operations;
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
disclosed next to the action, and spend/output/concurrency limits are enforced
per activation:

* the worst-case cost of a call is **reserved before dispatch**, so concurrent
  calls cannot each assume the whole remaining budget, and further calls are
  refused once the activation limit is committed;
* models must have a host-configured price — an unpriced model is refused rather
  than recorded as free;
* a provider response without usable token usage fails closed instead of being
  accounted as zero;
* a failed or cancelled call releases its concurrency slot exactly once, so
  repeated failures cannot exhaust the activation.

Paid completions are not reachable through generic connection dispatch: that
operation is declared as governed by `ai.complete`, so there is only one policy
in front of the provider charge.

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
