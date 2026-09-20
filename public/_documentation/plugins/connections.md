# Plugin connections

A plugin connection lets a plugin use an external service without ever holding
your credential. OR3 stores the credential encrypted, gives the plugin an opaque
reference, and performs only the operations the provider declares.

This page describes what exists today, what it refuses, and what is not
supported yet.

## How it works

1. You open the plugin's setup page (`/plugins/<pluginId>/setup`) and enter the
   provider credential once, against the connection slot the package declares.
   The binding is explicit: the provider, scopes and operations come from the
   package policy and are validated against the registered provider, so a stored
   credential only satisfies the slot it was created for. The package is the
   verified selection (a pending candidate during setup, the running version
   otherwise); a candidate is bound to the acquisition operation that recorded
   its exact digest, and a setup page that names a different package is refused
   instead of storing a credential against the wrong release. Creating and
   testing a connection hold the per-plugin lifecycle lease across selection,
   binding and the credential write or test dispatch, so a promotion, rollback
   or cancellation cannot replace the candidate mid-decision; a busy lifecycle
   answers `setup-package-busy`. Cancelling a staged update releases its
   candidate pointer, so the setup page resolves the running version again.
2. OR3 encrypts it (AES-256-GCM) with a key held **outside** the database
   (`OR3_PLUGIN_CONNECTION_SECRET`) and stores only the ciphertext. The key is
   never a build default: a prebuilt container reads it at startup, where
   `OR3_PLUGIN_CONNECTION_SECRET` is translated into
   `NUXT_ADMIN_PLUGIN_CONNECTION_SECRET`. Changing the key makes existing
   ciphertexts undecryptable, so credentials must be entered again afterwards;
   keep the key in the deployment's secret store so it survives restarts.
3. The plugin receives an opaque reference such as `orc_ab12_r1`. It never
   receives the secret, and the reference alone grants nothing.
4. When the plugin asks to run an operation, the host checks the acting owner,
   the workspace, the plugin, the release's approved operations and
   destinations, the connection's scopes, the declared operation, the exact
   origin, the path, the method, the header policy and the response size — and
   only then attaches the credential.
5. Operations the provider classifies as external, commercial, destructive or
   access-changing additionally need an approval the **host UI** minted for that
   exact plugin, workspace, generation and operation. An approval that arrives
   with the request (for example from plugin code or model output) is treated as
   forged and refused before the credential is decrypted.

## What a connection can do

A provider declares an allowlist. Anything not on it is refused:

| Check | Refusal |
|---|---|
| Operation declared by the provider | `operation-unknown` |
| Operation approved by the release (`or3.package-policy.json`) | `operation-not-approved` |
| Capability-governed operations (for example paid completions) | `operation-not-approved` |
| Exact HTTPS origin — hostname **and** port | `destination-mismatch` |
| Destination host/method declared by the release | `destination-mismatch` / `method-not-approved` |
| Approved path prefix, segment-bounded (`/api/v1/models` never matches `/api/v1/models-x`) | `path-not-approved` |
| Approved method | `method-not-approved` |
| Scopes recorded on the connection and approved by the release | `scope-missing` |
| Header policy | `forbidden-header` |
| Host-minted approval for risky operations | `approval-required` |
| Credential/debug/echo endpoints | `excluded-endpoint` |
| Acting owner matches the stored connection | `connection-foreign` |

"Provider supports this operation" is never enough: the release has to approve
it too. A paid model completion is deliberately **not** reachable through this
path — it is routed to the governed `ai.complete` capability, so the model
allowlist, output ceiling and spend accounting always apply.

After dispatch:

* Redirects are not followed, so the credential never crosses to another origin.
* The response is read through a byte ceiling: an oversized or endless body is
  cancelled mid-stream instead of being buffered first.
* `Set-Cookie`, `Authorization`, `WWW-Authenticate`, `x-auth-token`-style headers
  are dropped, unmatched `x-*` diagnostic headers are withheld, and the body is
  projected onto the fields the operation declares.
* Secret-shaped keys are refused **at any depth**, including inside arrays, and
  any occurrence of the live credential in a body or header is scrubbed.

A plugin can never set `Authorization`, `Cookie`, `Host`, `Forwarded`,
`X-Forwarded-*` or a plugin-chosen credential header: those are host-controlled.

## Who owns a connection

Connections are **owner-scoped**, not workspace-scoped. Listing resolves and
tests only ever see the acting user's own connections, even in a shared
workspace, and another member's reference is refused (`connection-foreign`).
There is no connection sharing today; if shared workspace connections are wanted
later they need an explicit sharing model rather than treating workspace
membership as ownership.

## Requests the browser makes

Creating, rotating, deleting, testing and saving setup values are browser
mutations. They require an authenticated session in the workspace, a
same-origin `Origin`/`Referer`, JSON content type, and the intent header
`x-or3-plugin-intent: plugin`. A same-site sibling origin cannot drive them with
a simple form post.

## What the plugin stores

Only the reference. Rotating the credential increments the connection revision,
which changes the reference, invalidates any previous successful test and
returns the plugin to **Needs setup**.

## Setup tests

`Test connection` runs one **read-only, idempotent** operation with a deadline.
Non-idempotent or write operations are refused as tests, so a test can never
perform a real write. Failures are reported distinctly:

* bad credentials
* insufficient scope
* network failure
* rate limit
* provider outage
* deadline exceeded

A pass is bound to the connection revision; changing the credential clears it.

## Supported providers

| Provider | Mechanism | Operations | External cost |
|---|---|---|---|
| `openrouter` | server-side | `models.list` (setup test), `chat.completions.create` | Your own OpenRouter account is billed per token; OR3 adds no fee and never sees your key |

OpenRouter callbacks, browser-held provider keys, webhooks and streaming
responses are **not** supported, and are declared as such rather than silently
degraded.

There is **no central OR3 credential proxy**: the host instance calls the
provider directly with your credential.

## Not available yet

* Installing marketplace packages and running their first action end to end is
  the installer/lifecycle track; today the setup page renders the plan, saves
  settings, tests connections and reports what the first action needs.
* Connections need `OR3_PLUGIN_CONNECTION_SECRET` (or the runtime override
  `NUXT_ADMIN_PLUGIN_CONNECTION_SECRET`) to be configured. Without it, the setup
  page explains that credentials cannot be stored instead of storing them in
  plaintext.
* Connection ids are random and creation is insert-only: a collision fails and is
  retried with a fresh id, and an update can never change a record's owner,
  workspace, plugin, provider or slot. Credential rotation uses a revision
  compare-and-swap, and test evidence is stored only for the connection's current
  revision, so two rotations cannot share a revision and a late test cannot
  reinstate an old result.
* On a provider without durable storage (for example Cloudflare D1), connections
  are held in memory for the session and the setup page says so.
