# Plugin Manifest V2

V2 packages ship `or3.manifest.json` with `manifestVersion: 2`.

Required concepts:

- `id`, `name`, `version`, `engines.or3`, `engines.pluginApi`
- `runtime.client` / `runtime.server` entrypoints
- `requestedGrants`, `features`, `dependencies`
- `trust` (`trusted-host` | `isolated-client` | `isolated-server`)
- `settings.version`, `stateCompatibility` (`version`, `reads`, `rollback`)

Parsing dispatches on `manifestVersion ?? 1`. V1 manifests remain valid for legacy workspace packages. V2 validation runs before code import.

Inspect without executing plugin modules:

```sh
bun run plugin-runtime:cli -- inspect ./my-plugin
```

Canonical package digests use the server package-tree hasher (`OR3_PLUGIN_PACKAGE_TREE_V1`). Two unchanged packs must share the same digest.
