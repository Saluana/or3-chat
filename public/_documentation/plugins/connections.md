# Connections reference

A connection lets a plugin use an external service while the local OR3 server
holds the credential. The plugin receives an opaque reference and can request
only the operations approved for its release and the registered provider.

The local host receives and encrypts the credential. Plugin code and the central
OR3 marketplace do not receive it. There is no central credential proxy.

## Supported provider

| Provider | Mechanism | Operation | Behavior |
| --- | --- | --- | --- |
| `openrouter` | Server | `models.list` | Read-only model listing; used for setup tests |
| `openrouter` | Server | `chat.completions.create` | Governed by `ai.complete`; generic connection dispatch refuses it |

Browser-held connection credentials, OAuth callbacks, webhooks, and streaming
connection responses are currently unsupported. OpenRouter model usage is billed
to the configured account; OR3 adds no connection fee. The ordinary Chat key
flow is separate from this plugin connection contract.

A package can describe another provider, but the operator must implement and
register a corresponding connection provider first. A fictional provider name
or a browser mechanism does not become supported by declaring it in a profile.

## Declare a connection slot

Use `.authoring/profile.config.mjs` to describe the destination and connection.
This fragment uses the actual built-in OpenRouter model-listing operation:

```js
destinations: [{
    id: 'openrouter',
    methods: ['GET'],
    hosts: ['openrouter.ai'],
    scopes: ['models:read'],
}],
connections: [{
    id: 'models',
    label: 'OpenRouter models',
    provider: 'openrouter',
    required: true,
    mechanism: 'server',
    scopes: ['models:read'],
    operations: ['models.list'],
}],
testAction: { operationId: 'models.list', deadlineMs: 5000 },
```

Merge it into a complete authoring configuration and add `network.http` to the
manifest permissions. Keep the first action consistent with declared operations.
Regenerate and validate descriptors before admitting the package. This connection
can list models; it does not grant paid completions or raw network access.

## Configure and test

1. Open **Configure** from the plugin's Marketplace detail or Installed page.
2. Enter the credential for the declared slot. The host uses the verified
   package's provider, scopes, and operations, rather than accepting arbitrary
   browser-supplied policy.
3. Use **Test connection**. Required connections need both a stored credential
   and a passing test before setup is ready.
4. Continue the installation or update. Open the running plugin to perform its
   first action.

Configure saves settings, binds/tests connections, and prepares a first-action
handoff. The running portable surface handles `host.first-action.run` through
`runtime.ui-event`; see [Add features](/documentation/plugins/add-features#work-with-a-document).

Tests perform only a read-only, idempotent operation with a deadline. A passing
test is tied to the connection revision. Rotating credentials invalidates it and
requires another test. Network errors, bad credentials, missing scopes, rate
limits, outages, and timeouts are reported separately.

## Ownership and storage

Connections are owner-scoped and additionally bound to workspace, plugin,
provider, and slot. Members do not inherit another user's connection. The
reference alone is not authority. Rotation changes its revision/reference;
store only that reference in plugin state, never the credential.

`OR3_PLUGIN_CONNECTION_SECRET` encrypts credentials with AES-256-GCM. Keep this
strong secret outside the database and preserve it across restarts. Containers
map it to `NUXT_ADMIN_PLUGIN_CONNECTION_SECRET` at startup. Rotating the key
makes old ciphertext unusable and requires users to reconnect. Without a key,
Configure explains that storing credentials is unavailable.

Durable connection storage comes from the selected provider registration.
Providers without it use explicitly reported memory storage; credentials will
not survive a process restart. A configured durable store is never silently
replaced with memory after a failure.

A staged update binds setup to its exact candidate digest and acquisition
operation. Reopen Configure after cancellation, promotion, or a workspace change
if the old link conflicts. A busy package lifecycle may answer
`setup-package-busy`; refresh or retry once the operation settles.

## Dispatch policy

The host checks the acting user, workspace, plugin, selected release, connection
revision, approved operation, scopes, exact HTTPS origin, segment-bounded path,
HTTP method, and header/response policies before injecting the credential.
The provider allowlist and release policy must both permit the operation.

External writes, commercial, destructive, and access-changing operations need
an approval minted by the host UI for that exact action. A plugin-supplied or
model-generated approval object is refused. Paid model calls use the separate
governed AI capability, so a connection cannot bypass prices and spending limits.

Redirects are not followed. Responses are read under a byte ceiling, projected
onto approved fields, and checked for credential exposure. Credential-bearing
headers and secret-shaped nested keys are withheld/refused. Plugins cannot set
`Authorization`, `Cookie`, `Host`, forwarded headers, or their own credential header.

| Refusal code | Meaning |
| --- | --- |
| `connection-foreign` | Acting user does not own the connection |
| `operation-unknown` / `operation-not-approved` | Provider or release does not allow this operation, or it is governed elsewhere |
| `scope-missing` | Required scope is absent |
| `destination-mismatch` / `path-not-approved` / `method-not-approved` | Request is outside the reviewed destination policy |
| `approval-required` | A host-issued approval is needed |
| `forbidden-header` / `excluded-endpoint` | Request could bypass custody or expose credentials |
| `setup-operation-conflict` / `setup-package-conflict` | Setup link names a stale or unrelated candidate |

## Browser mutation contract

Connection create/rotate/delete/test and setup saves require a live authenticated
workspace session, same-origin `Origin`/`Referer`, JSON content type, and
`x-or3-plugin-intent: plugin`. Use the host Configure UI for normal setup.
These checks do not substitute for operation permissions or live package identity.

Provider declarations live in `server/utils/plugins/connections/providers/` and
are registered by `server/plugins/15.connection-providers.ts`. Custody and dispatch
live under `server/utils/plugins/connections/`. Consult those contracts when
building a host provider integration; portable publisher code cannot register
one by itself.
