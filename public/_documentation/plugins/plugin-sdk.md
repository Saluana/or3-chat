# `@or3/plugin-sdk`

Stable Plugin Runtime V2 authoring surface. Import only this package (or documented subpaths: `/manifest`, `/host`, `/testing`).

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
