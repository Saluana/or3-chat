# Manifest reference

`or3.manifest.json` declares an installable workspace plugin's identity,
runtime, permissions, and compatibility. The host validates it before importing
code. The current package format uses `manifestVersion: 2`; the number is a
schema field, not a separate authoring workflow.

Portable starters generate the manifest, package policy, and setup descriptor
from `.authoring/profile.config.mjs`. Keep those files consistent with the
manifest exported by `client.mjs`.

## Complete portable manifest

This is the greeting starter's shape. Replace the identity and version for your
package. Engine ranges below target the current host contract; they are not the
same thing as the application's package version.

```json
{
    "manifestVersion": 2,
    "kind": "plugin",
    "id": "my-tools.greeting",
    "name": "Greeting",
    "version": "0.1.0",
    "description": "A greeting saved in this workspace.",
    "license": "GPL-3.0",
    "engines": { "or3": "^0.3.0", "pluginApi": "^2.0.0" },
    "runtime": {
        "client": { "entry": "client.mjs", "format": "esm", "isolation": "worker" }
    },
    "requestedGrants": ["settings.read", "settings.write", "ui.dashboard.register"],
    "features": { "required": ["or3-portable-client-v1"], "optional": [] },
    "dependencies": { "required": [], "optional": [] },
    "trust": "isolated-client",
    "settings": { "version": 1, "schema": "settings.schema.json" },
    "stateCompatibility": {
        "version": 1,
        "reads": { "minimum": 1, "maximum": 1 },
        "rollback": "safe"
    }
}
```

## Fields

| Field | Contract |
| --- | --- |
| `manifestVersion`, `kind` | `2` and `plugin` for SDK workspace packages |
| `id` | Stable package identity; use a lowercase namespace you own |
| `name`, `description` | Display name and optional description |
| `version` | Semantic release version; a published version's bytes are immutable |
| `license` | Optional bounded SPDX license identifier or expression; declare it for publication |
| `engines.or3`, `engines.pluginApi` | Supported host/API semantic version ranges |
| `runtime.client` | Package-relative JavaScript entry, `format: 'esm'`, and isolation mode |
| `runtime.server` | Optional trusted server entry/routes; forbidden for the portable profile |
| `requestedGrants` | Requested permissions; approval and a qualified host adapter are still required |
| `features.required`, `.optional` | Required host features block unsupported hosts; optional features can be checked at runtime |
| `dependencies.required`, `.optional` | Plugin IDs and version ranges; both arrays must be empty for portable packages |
| `trust` | `isolated-client` for portable workers; `trusted-host` for reviewed host code |
| `settings.version`, `.schema` | Positive settings version and optional package-relative schema path |
| `stateCompatibility` | Written state version, readable minimum/maximum, and rollback policy |
| `icon` | Optional validated package-relative PNG/WebP |
| `integrity.package` | Optional canonical `sha256-…` tree identity managed by packing; do not invent a hash |
| `capabilities` | Optional metadata; not a replacement for `requestedGrants` |

The type vocabulary includes `isolated-server`, but the current production host
does not advertise it. A syntactically valid manifest can still be refused for
unsupported runtime, feature, permission, or browser.

## Generate policy and setup

In the starter's `.authoring/profile.config.mjs`, `authoringConfig` controls the
policy/setup descriptors and `baseManifest` controls package identity and grants.
The existing `buildArtifacts()` calls `defineOr3PortableProfile()` and
`applyPortableProfileToManifest()`. For the greeting app, the configuration is:

```js
export const authoringConfig = Object.freeze({
    profile: 'or3-portable-client-v1',
    destinations: [],
    connections: [],
    dataScopes: ['settings.read'],
    writes: ['settings.write'],
    features: [],
    settingsSchemaPath: 'settings.schema.json',
    fields: [{
        key: 'greeting', label: 'Greeting', kind: 'text',
        required: false, order: 1, default: 'Hello from OR3',
    }],
    testAction: { operationId: 'settings.read', deadlineMs: 5000 },
    firstAction: {
        operationId: 'settings.write', label: 'Save greeting', usesSampleContext: true,
    },
});
```

```sh
bun run profile:generate
bun run profile:check
```

`or3.package-policy.json` records destinations, connections, data scopes, writes,
and required features. `or3.setup.json` records fields, required connections,
setup tests, and the first action. Descriptor generation is deterministic.
Do not import `@or3/plugin-sdk/profile` from shipped runtime code; keep it in
`.authoring/`, which is excluded from the runtime package.

This configuration needs no external provider. A custom connection provider
must be implemented and registered by the host before a package can use it;
declaring a provider name does not create it. See [Connections](/documentation/plugins/connections).

## Portable restrictions

| Area | Requirement |
| --- | --- |
| Runtime | `isolated-client`; relative `.js`/`.mjs` entry; client isolation `worker` or `iframe`, never `host` |
| Server code | No `runtime.server` |
| Dependencies | No other plugin dependencies; runtime package dependencies limited to the SDK (`vue` peer allowed) |
| Install scripts | No `preinstall`, `install`, `postinstall`, or `prepare` lifecycle scripts |
| State | `rollback: 'safe'`; ordered readable range that includes the written state version |
| Permissions | Policy data scopes/writes must appear in `requestedGrants`; connections/destinations require `network.http` |
| Setup | Connection IDs and test/first-action operations must agree with policy declarations |
| Fields | Workspace-scoped values; `scope: 'user'` is currently refused |
| Secrets | Never ordinary setting values; a required secret field blocks readiness until supported custody satisfies it |

The generator adds `or3-portable-client-v1` to required features and aligns
`settings.schema` with the descriptor. Add `or3-portable-workspace-v1` when your
package relies on navigation and workspace layout features.

### First-action samples

A first action can declare `samplePath`, a bounded package-relative text file
used when no document/message context was selected. Selected context wins.
`samplePath` requires `usesSampleContext: true`; a missing or unsafe sample is
refused. Without a sample, a context-dependent action needs a selection.
See the [document recipe](/documentation/plugins/add-features#work-with-a-document).

## App icons

Declare `"icon": "assets/app-icon.webp"`. Accepted icons are static PNG or WebP,
at most 128 KiB and 256 × 256 pixels. Packing and admission inspect the actual
bytes. SVG, remote URLs, data URLs, animation, unsafe paths, and symlinks are
refused. Optimize before packing; the host does not rewrite signed bytes. The
host serves the accepted icon from the authorized digest-addressed package
and falls back to its normal icon if loading fails.

## Trusted server routes

A trusted-host package can declare routes under its plugin API prefix:

```json
{
    "runtime": {
        "client": { "entry": "client.mjs", "format": "esm", "isolation": "host" },
        "server": {
            "routes": [{
                "method": "GET",
                "path": "status",
                "handler": "server/status.mjs",
                "permission": "workspace.read"
            }]
        }
    },
    "trust": "trusted-host"
}
```

This is a fragment to merge into a complete manifest. Paths are relative to
`/api/plugins/<pluginId>/`, without a leading slash. Use `workspace.read` for reads or `workspace.write` for writes. Method defaults
apply when omitted; a write method cannot be weakened to read permission. The host checks workspace
session, enablement, access, entitlements, and permission before import/invocation.
The per-request immutable identity is available at
`event.context.or3PluginRequest` (`pluginId`, `packageDigest`, `workspaceId`,
`userId`, `method`, and `routePath`). SDK packaging bundles route-local imports;
server code must not assume the author's dependencies remain installed on the host.

## Validate and inspect

```sh
./node_modules/.bin/or3-plugin validate .
./node_modules/.bin/or3-plugin build .
./node_modules/.bin/or3-plugin pack . --archive ../plugin.or3pkg
./node_modules/.bin/or3-plugin inspect ../plugin.or3pkg
```

Inspection reports identity, imports, requested access, state compatibility,
and conformance without executing plugin code. Use the [CLI reference](/documentation/plugins/plugin-sdk-cli)
for candidate commands and [SDK reference](/documentation/plugins/plugin-sdk) for method permissions.
