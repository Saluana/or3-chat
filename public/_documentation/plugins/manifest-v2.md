# Plugin Manifest V2

V2 packages ship `or3.manifest.json` with `manifestVersion: 2`.

The owner-only standard extension install endpoint dispatches a V2 ZIP to the
immutable candidate store. After a canary and explicit promotion, an enabled
server-only package can run authorized routes in an SSR deployment. Client-entry
packages remain intentionally blocked until the host UI ABI qualification is
complete; see [Plugin Runtime V2 Overview](./runtime-v2-overview).

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

For a promoted and selected V2 package, the host checks the workspace enabled list, merges
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

## V1 coexistence

V1 stays on its existing bundled extension lane. A V2 upload is rejected when
its ID belongs to a V1 plugin in `extensions/plugins`; rename the V2 package or
perform a future explicit migration. An older V2 archive already present in the
legacy extension directory is inert and reported as
`legacy-v2-reinstall-required`; re-upload it through the candidate flow. OR3
does not move or delete that legacy artifact automatically.
