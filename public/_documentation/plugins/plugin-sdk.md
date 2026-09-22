# `@or3/plugin-sdk`

Stable Plugin Runtime V2 authoring surface. Import only this package (or documented subpaths: `/manifest`, `/host`, `/testing`, `/profile`, `/package-tree`, `/package-archive`, `/state-compatibility`).

The package ships prebuilt ESM and type declarations plus an `or3-plugin` CLI.
It is **not yet published to npm**; install it from a packed tarball (see
[Plugin SDK CLI and Packaging](./plugin-sdk-cli)). The existing release
workflows contain no SDK publication job, so publishing requires adding that
release integration.

The package is currently an authoring and compatibility-test surface. OR3's
production workspace activation path does not yet call a V2 definition's
`setup(context)` method.

## Core exports

- `defineOr3Plugin()` + Manifest V2 types
- Host-created `PluginContext` (identity, generation, grants, logger, hooks, contributions, settings, storage, and typed capability namespaces)
- Result helpers (`pluginOk` / `pluginError`)
- `@or3/plugin-sdk/testing` fake host for local activation/failure tests

`PluginContributionKind` reserves the planned contribution vocabulary. The
command-palette mapping is the production host mapping currently implemented;
other kinds remain compatibility/test contracts until their host adapters and
grants are connected.

Plugin packages must not import OR3 app aliases (`~/`, `~~/`, `#imports`) or rely on Nuxt auto-imports. Validate with:

```sh
bun run plugin-runtime:cli -- validate ./my-plugin
```

Scaffold:

```sh
bun run plugin-runtime:cli -- create --id or3.example --dir ./example --sdk-source ./packages/plugin-sdk
```

The context is intentionally capability-shaped:

```ts
context.ai; context.ui; context.panes; context.commands; context.chat;
context.workspace; context.storage; context.settings; context.secrets;
context.files; context.http; context.network; context.activity; context.events;
```

Each namespace is typed, grant-checked, and host-mediated. A host may expose a
stable namespace while returning `unsupported` until its production adapter is
qualified; adding a grant string alone never enables a method. Storage records
include revisions and byte accounting through `getRecord()`, and writes accept
`ifRevision` for compare-and-set updates. `ifRevision` must be `null`
(create-if-absent) or a non-negative safe integer; anything else is refused
rather than degrading to an unconditional write. Deletes preserve the revision
chain, including after sync snapshots, so a stale pre-delete revision cannot
match a recreated key. `getRecord()` returns that preserved revision even when
the value is absent; it can be used for the next conditional write.
Listings page through an index seek (`listPage()`, at most 200 entries per
page); legacy `list()` is capped at 200 entries. Aggregate quotas of 1000 keys
and 1 MiB per plugin per workspace are enforced atomically with each write
(`quota-exceeded` past the caps). Usage is derived from the local materialized
rows, including imported/synced rows; these are local admission limits, not a
global reservation across offline devices. A separate cap of 10,000 retained
names (live or deleted, including sync tombstones) bounds deletion history.
Deleting releases live-value usage but does not release a retained name;
existing names may still be reused at that cap. Plugin code should not import Dexie,
Vue composables, Nuxt APIs, Pinia stores, database tables, or internal OR3
services.

`context.activity.registerSource()` accepts an owner-scoped source with bounded
run summaries. A source may also expose details, typed live events, and explicit
cancel/retry/approval actions; the host adapts those records into the Activity
center and isolates a failing source from other sources. The production V2
grant remains unqualified until installed-package conformance is complete,
while the trusted host adapter and test harness exercise the same mapping.

Pane registrations and open calls validate opaque ids and restore data before
navigation. Data is limited by serialized bytes, nesting depth, and item
count. File APIs return host-issued metadata handles without filesystem paths;
reads are bounded async byte streams and writes use replacement revisions.
Chat messages validate roles, content, and attachment metadata, and
`requestId` makes a retried append idempotent. Setup descriptors can mark a
field `scope: "workspace"` (the default); `scope: "user"` is reserved and
currently refused during admission and at save time until a per-member store
with matching authorization exists, so personal values are never silently
shared as workspace configuration. A `secret: true` field is never accepted
by ordinary setup settings and must use the secrets client. A required
`secret: true` field blocks setup readiness (and acquisition/update readiness)
until host secret custody can satisfy it, instead of being presented as a
plaintext setting the user could type.
Registering a command does not grant cross-plugin execution: a plugin needs the
reviewed `commands.run.public` grant to invoke a command owned by another
plugin.

`PluginSseDecoder` is available for mediated SSE streams. It handles split
UTF-8 and CRLF chunks, multiline data, event ids, and heartbeat comments within
bounded line and event sizes. Transport admission, destination policy,
reconnect, and lifetime budgets remain host responsibilities.
CR-only terminators dispatch immediately, including at chunk boundaries;
unterminated events are discarded at EOF.

## Host capabilities (portable AI)

The root export also carries typed helpers for the host's governed model
surface, so a package never hand-writes capability method names:

| Helper | Capability | Returns |
|---|---|---|
| `listHostModels(call)` | `ai.models` | The approved models with disclosed per-million prices, `priced` flags and the enforced limits (`configured: false` when the host approves none) |
| `completeWithHostModel(call, { model, prompt, maxOutputTokens? })` | `ai.complete` | One completion with its real usage and plugin-attributed spend |

`call` is a `PortableClient['call']` (from `createPortableClient()`), which the
plugin must also hand to `createPortablePlugin`. Refusals keep their meaning
(`permission-denied`, `quota-exceeded`, `timeout`, …) instead of becoming a
silent empty result.

## Testing a portable package

`@or3/plugin-sdk/testing` exports `createPluginTestHost()` and
`createPortableTestHost()`. The host harness covers activation teardown,
generation-scoped storage CAS, panes, commands, chat, secrets and bounded file
fixtures. The portable host implements the
same `PortableClient` contract the sandbox shim provides — canned capability
answers (including refusals), working settings/storage stores, captured renders,
contributions and events — so a package's own `client.mjs` runs through the real
`createPortablePlugin()` path in `bun test` with no browser and no worker.
The portable host enforces the same settings/storage grant checks, key/value
validation, CAS/conflict semantics, delete/recreate revision continuity and
aggregate quotas (1000 live keys / 1 MiB and 10,000 retained names per plugin
per workspace) as production dispatch. Conformance fixtures run against real
Dexie transactions and the fake, comparing refusals, revision/size metadata,
pagination and capped key ordering. Settings reads and listings return copies.
Storage writes use JSON wire semantics, conflicts include `details.currentRevision`,
and only exact registered method names reach the built-in settings/storage handlers.
Unavailable test-host capabilities return `unsupported`, matching unregistered production methods.
Intentionally uncovered: `emit()` echo, transport
budgets/deadlines, activation lifecycle staleness and synthetic timestamps.

```js
const host = createPortableTestHost({
  approvedGrants: ['network.http', 'settings.read'],
  responses: { 'ai.models': catalog, 'ai.complete': answer },
});
const { definition } = createModelCompare({ client: host.client });
createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap });
await host.invokeRequest('runtime.ui-event', { action: 'compare.run', values: { prompt: '…' } });
```
