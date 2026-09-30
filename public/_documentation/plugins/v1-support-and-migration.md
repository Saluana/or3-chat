# V1 Support Policy and V2 Migration

New packages use the [single plugin authoring guide](./plugin-development-v2).
This page describes the compatibility window for packages already using V1.

## Support window

V1 plugin authoring remains supported through the entire Plugin Runtime V2 line. The earliest removal target is Plugin Runtime V3, only after an announced deprecation window. V2 releases do not remove V1 APIs.

## Migration steps

1. `bun run plugin-runtime:cli -- create --id <id> --dir <path> --sdk-source ./packages/plugin-sdk`
2. Run `bun install` in the generated directory and call `defineOr3Plugin()`.
3. `validate` / `test` / `build` / `pack` via `plugin-runtime:cli`; packing consumes the build output in `dist`.
4. Upload the ZIP as a V2 candidate, review requested grants, run its browser
   and server canaries where applicable, promote it, and enable it first in a
   canary workspace. Trusted-host client entries run only when the host ABI
   proof and module loader are enabled.

V1 and V2 cannot own the same plugin ID at once. Keep the existing V1 plugin
running while you validate a differently named V2 package, or wait for an
explicit migration operation. OR3 never silently converts, moves, or deletes a
V1 extension.

## Import map

Avoid `~/`, `~~/`, `@/`, `@@/`, `#imports`, `#app`, and Nuxt auto-imports inside V2 packages. Use `@or3/plugin-sdk` context APIs instead. The report-only codemod (`plugin-runtime:v1-imports:warn`) never rewrites files unless you pass `--write`.

## Lifecycle coverage limits

- V1 registrations are immediately visible and may use global side effects (`legacy-global-possible`).
- V2 activation is per process/client generation, not fleet-atomic.
- Disable retains digests, settings, and migrated state.


## Workspace manifest coordination

Bundled V1, trusted V2, and isolated client plugins consume snapshots from one
workspace plugin coordinator. It owns the runtime-manifest request, session and
workspace subscription, focus refresh, and `or3:workspace-plugin-reconcile`
signal. A burst of refresh requests coalesces; superseded requests are aborted
and late responses cannot activate plugins in a different workspace or account.

All adapters complete teardown before the coordinator applies a destination
workspace snapshot. A teardown failure blocks destination activation and is
reported; another refresh retries cleanup. A failed manifest request in the
same workspace preserves healthy plugins. Unchanged descriptor identities keep
their existing registrations.

Execution stays separate: bundled V1 uses its compatibility lifecycle, trusted
V2 runs through the reviewed host context, and isolated clients retain their
containment boundary. Portable plugin code starts only when a surface opens or
the user requests a restart; manifest reconciliation registers availability
without consuming the containment watchdog budget.
