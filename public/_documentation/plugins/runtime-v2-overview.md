# Plugin Runtime V2 Overview

Plugin Runtime V2 adds digest-addressed packages, a frozen V1 compatibility
line, `@or3/plugin-sdk` authoring, and optional isolation. The generation-safe
manager is promoted by default, but it currently manages bundled V1
descriptors. The V2 hook engine, digest module loader, and isolation remain off
by default.

> **Integration status:** Manifest V2 ZIP uploads now enter the immutable
> candidate → canary → promotion flow and promoted **server-only** packages can
> serve authorized workspace routes in an SSR deployment. The browser continues
> to activate only V1 descriptors. V2 packages with a client entry are reported
> as `trusted-host-ui-abi-unproven` until the host ESM facade, Vue/SDK singleton,
> and CSP qualification suite passes.

## What stays the same (V1)

- Bundled `.client.ts` plugins and workspace packages under `extensions/plugins`
- Hook/`useHooks` signatures, registries, and Nuxt auto-imports
- Immediate V1 registration visibility (`legacy-global-possible`)

See [V1 support and migration](/plugins/v1-support-and-migration).

## What V2 adds

- Manifest V2 + canonical package digests
- Host-created `PluginContext` via `@or3/plugin-sdk`
- Manager records, quarantine/retry, package promote/rollback, Runtime Inspector controls
- Optional isolated client/server execution (not silent fallback to trusted-host)

## Server-only package rollout

V2 is disabled by default and is selected only at process startup. Keep the
first canary to one or a few workspace IDs:

```bash
OR3_PLUGIN_MODULE_LOADER_V2_ENABLED=true
OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS=workspace-canary-1
```

The initial supported profile is `trusted-host`, server routes only, with no
requested grants or optional features. A package requesting client code,
isolation, a grant, or an unsupported feature remains a stored but blocked
candidate; it is not downgraded to a different execution mode.

1. Upload a Manifest V2 ZIP to `POST /api/admin/extensions/install`. A valid
   upload returns an inactive candidate digest; it does not enable the plugin.
2. Run `POST /api/admin/plugins/packages/:pluginId/canary`, then promote that
   digest with `POST /api/admin/plugins/packages/:pluginId/promote`.
3. Enable the plugin in the target workspace with the existing workspace-plugin
   control. Only then can declared server routes run for authorized users.
4. Roll back with `POST /api/admin/plugins/packages/:pluginId/rollback`, or
   disable it with the workspace-plugin control. Both retain package bytes,
   settings, and state. A rollback commits the verified previous target; if the
   current version no longer verifies, its broken reference is removed instead
   of being retained, so recovery completes and the pointer keeps verifying.
5. Cancel a staged acquisition before it promotes with
   `POST /api/admin/plugins/acquisitions/:operationId/cancel`. Cancellation
   releases that operation's candidate pointer under the lifecycle lease while
   preserving current/previous and their saved configuration, so setup and
   connections resolve the running version again instead of a dead candidate. A
   later retry restages the cancelled candidate from its retained staging
   bytes.

Promotion and rollback decide from the verified running selection, not raw
pointer slots: with an unreadable current the runtime runs the previous, so that
previous becomes the retained rollback target and the configuration-inheritance
base for the promoted version. A promotion that drops an unreadable current is
still an update, so it never flips a workspace's enablement as if it were a
first install.

A recorded V2 pointer owns the plugin identity. When it selects nothing
(candidate-only or cleared), is blocked, or the V2 loader is disabled, the id
stays unavailable: it is never served by a legacy V1 extension directory with
the same id. Only a plugin with no V2 pointer at all can resolve as a legacy
extension.

For an immediate startup rollback, set
`OR3_PLUGIN_MODULE_LOADER_V2_ENABLED=false` and restart the server. This makes
all V2 package code inactive without changing candidate/current/previous
pointers or deleting package data. `OR3_PLUGIN_RUNTIME_V2_ENABLED` and
`OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS` are separate controls for the V1
generation-safe manager; they do not enable V2 packages.

## Tooling

```sh
bun run plugin-runtime:cli -- create --id or3.my-plugin --dir ./my-plugin
bun run plugin-runtime:cli -- validate ./my-plugin
bun run plugin-runtime:cli -- test ./my-plugin
bun run plugin-runtime:cli -- build ./my-plugin
bun run plugin-runtime:cli -- pack ./my-plugin
bun run plugin-runtime:cli -- inspect ./my-plugin
```

Report-only V1 private-import warnings:

```sh
bun run plugin-runtime:v1-imports:warn -- app/plugins/examples
```

## Operator notes

- Startup surface selection: `OR3_PLUGIN_CONTRIBUTION_V2_SURFACES` is a
  comma-separated list of V2 contribution surfaces (`command-palette`,
  `client-tools`, `server-tools`, `admin-extensions`). Selected registries run
  through the V2 contribution kernel. The setting is startup-only; restart to
  change it.
- Promotion and rollback revoke live activation handles for the plugin, so a
  handle minted for the previous selection cannot keep invoking capabilities or
  saving runtime settings after the selected version changes.
- Trusted-host is **not** a sandbox.
- Activation is **not** fleet-atomic.
- Disable retains packages and data until explicit deletion.
- Safe mode: `OR3_DISABLE_NON_CORE_PLUGINS=true` + process restart (see [trust and safe mode](/plugins/trust-and-safe-mode)).
