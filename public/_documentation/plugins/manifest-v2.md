# Plugin Manifest V2

V2 packages ship `or3.manifest.json` with `manifestVersion: 2`.

The owner-only standard extension install endpoint dispatches a V2 ZIP to the
immutable candidate store. After grant review, canary, and explicit promotion,
an enabled package can run authorized routes in an SSR deployment. Trusted-host
client entries also require the host Vue ABI/browser proof before activation;
see the [Plugin authoring guide](./plugin-development-v2).

Required concepts:

- `id`, `name`, `version`, `engines.or3`, `engines.pluginApi`
- `runtime.client` / `runtime.server` entrypoints
- `requestedGrants`, `features`, `dependencies`
- `trust` (`trusted-host` | `isolated-client` | `isolated-server`)
- `settings.version`, `stateCompatibility` (`version`, `reads`, `rollback`)

## App icon

A V2 plugin may declare a bundled app icon with a package-relative path:

```json
{
    "icon": "assets/app-icon.webp"
}
```

Icons must be static PNG or WebP files no larger than 128 KiB or 256 × 256
pixels. Packing and host admission inspect the real bytes and reject missing,
malformed, animated, oversized, symlinked, or unsafe paths. The host serves an
accepted icon through the selected package's authorized, digest-addressed asset
route and uses the normal Iconify plugin icon if the browser cannot load it.

Optimize the image before packing it. The host does not rewrite signed package
bytes. SVG, data URLs, and remote image URLs are not accepted as manifest icons.

`requestedGrants` is an authority request, not an enable switch. The host
maintains a qualification registry that ties each grant to concrete mediated
methods/events and a conformance receipt. The current portable host qualifies
the existing dashboard, command-palette, settings, storage, model/connection
and document grants. The trusted-host profile additionally qualifies reviewed
pane, command, workspace, secret, file, HTTP/stream, chat, hook, and activity
adapters used by installed packages. Qualification is method- and runtime-
specific; a package requesting an unsupported grant is blocked at review.

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
