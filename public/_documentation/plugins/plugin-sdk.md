# `@or3/plugin-sdk`

Stable Plugin Runtime V2 authoring surface. Import only this package (or documented subpaths: `/manifest`, `/host`, `/testing`).

## Core exports

- `defineOr3Plugin()` + Manifest V2 types
- Host-created `PluginContext` (identity, generation, grants, logger, hooks, contributions, settings, storage, http, cleanup)
- Result helpers (`pluginOk` / `pluginError`)
- `@or3/plugin-sdk/testing` fake host for local activation/failure tests

Plugin packages must not import OR3 app aliases (`~/`, `~~/`, `#imports`) or rely on Nuxt auto-imports. Validate with:

```sh
bun run plugin-runtime:cli -- validate ./my-plugin
```

Scaffold:

```sh
bun run plugin-runtime:cli -- create --id or3.example --dir ./example
```
