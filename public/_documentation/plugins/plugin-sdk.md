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
- Host-created `PluginContext` (identity, generation, grants, logger, hooks, contributions, settings, storage, http, cleanup)
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
bun run plugin-runtime:cli -- create --id or3.example --dir ./example
```

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

`@or3/plugin-sdk/testing` exports `createPortableTestHost()`. It implements the
same `PortableClient` contract the sandbox shim provides — canned capability
answers (including refusals), working settings/storage stores, captured renders,
contributions and events — so a package's own `client.mjs` runs through the real
`createPortablePlugin()` path in `bun test` with no browser and no worker:

```js
const host = createPortableTestHost({
  approvedGrants: ['network.http', 'settings.read'],
  responses: { 'ai.models': catalog, 'ai.complete': answer },
});
const { definition } = createModelCompare({ client: host.client });
createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap });
await host.invokeRequest('runtime.ui-event', { action: 'compare.run', values: { prompt: '…' } });
```
