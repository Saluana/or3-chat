# V1 support policy, V2 migration, and lifecycle-coverage limits

## V1 support policy

- Bundled and workspace **V1** plugins remain supported for the entire Plugin Runtime **V2** line.
- Public V1 APIs (hooks, registries, Nuxt auto-imports, `_diagnostics`, workspace plugin packaging under `extensions/plugins`) stay frozen; see the Compatibility Ledger.
- Earliest removal of V1 plugin authoring is **Plugin Runtime V3**, and only after a separate deprecation window announced in release notes. No V1 removal lands inside V2.

## Migrating to V2 packages

1. Scaffold with `bun run plugin-runtime:cli -- create --id <plugin.id> --dir <path>`.
2. Author against `@or3/plugin-sdk` only (`defineOr3Plugin`, host-created `PluginContext`).
3. Run `bun run plugin-runtime:cli -- validate <path>` (stable conformance codes).
4. Pack with `bun run plugin-runtime:cli -- pack <path>` and install the digest-addressed tree.
5. Keep V1 plugins unchanged until you intentionally cut over; dual presence is allowed while flags stay off by default.

### Import replacements

| Avoid (V1 app-private) | Use (V2 SDK) |
|---|---|
| `~/`, `~~/`, `@/`, `@@/` | `@or3/plugin-sdk` contracts/clients |
| `#imports`, `#app`, `#build` | `PluginContext` hooks/settings/storage/http |
| Nuxt auto-imports (`useHooks`, `$fetch`, …) | `context.hooks`, `context.http`, … |

Report-only scanner: `bun run plugin-runtime:v1-imports:warn -- <path>`. It never rewrites source unless you pass `--write`.

## Lifecycle-coverage limitations (plain language)

- **Immediate / non-atomic legacy behavior:** V1 workspace API registrations remain immediately visible; cleanup is FIFO with concurrent thenable settlement. Coverage label: `legacy-global-possible`.
- **Not fleet-atomic:** Promoting or activating a package updates this process’s selected pointer/generation. Other clients and server processes keep prior generations until they reconcile or restart.
- **Trusted-host is not a sandbox:** `trust: "trusted-host"` runs in the host JS realm with reviewed grants. It is not an iframe/worker sandbox.
- **Disable retains data:** Disable and package uninstall do **not** delete immutable digests, settings, or migrated state. Data deletion and GC are separate confirmed operations.
- **Code rollback ≠ state restore:** Rolling a package pointer back never claims incompatible migrated state was restored. State preflight may block rollback (`migration-required` / `unsupported`).
