# Plugin Manifest V2

V2 packages ship `or3.manifest.json` with `manifestVersion: 2`.

Manifest parsing, packing, immutable storage, and promotion primitives are
available. The standard extension install endpoint and production workspace
client do not yet form an end-to-end V2 activation path; see
[Plugin Runtime V2 Overview](./runtime-v2-overview).

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

## Server route authorization

For a selected V2 package, the host checks the workspace enabled list, merges
the manifest `access` policy with workspace overrides, resolves entitlements,
and applies the route permission before importing or invoking its handler.
Package assets use the same enabled-list and access-policy boundary.

After authorization, a route handler can read the immutable request identity
from `event.context.or3PluginRequest`:

```ts
export default defineEventHandler((event) => {
    const request = event.context.or3PluginRequest;
    return {
        pluginId: request.pluginId,
        packageDigest: request.packageDigest,
        workspaceId: request.workspaceId,
        userId: request.userId,
        method: request.method,
        routePath: request.routePath,
    };
});
```

This context is created per request and is not captured in the digest-keyed
module cache. It is available on the selected-package V2 dispatcher; legacy V1
route modules should continue to use the normal host session helpers.
