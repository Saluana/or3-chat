# Plugin Runtime V2 Overview

Plugin Runtime V2 adds digest-addressed packages, a frozen V1 compatibility line, `@or3/plugin-sdk` authoring, and optional isolation. Production defaults for V2 manager, hook engine, module loader, and isolation remain **off** until separate reviewed promotions.

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

- Trusted-host is **not** a sandbox.
- Activation is **not** fleet-atomic.
- Disable retains packages and data until explicit deletion.
- Safe mode: `OR3_DISABLE_NON_CORE_PLUGINS=true` + process restart (see [trust and safe mode](/plugins/trust-and-safe-mode)).
