# V1 Support Policy and V2 Migration

## Support window

V1 plugin authoring remains supported through the entire Plugin Runtime V2 line. The earliest removal target is Plugin Runtime V3, only after an announced deprecation window. V2 releases do not remove V1 APIs.

## Migration steps

1. `bun run plugin-runtime:cli -- create --id <id> --dir <path>`
2. Depend on `@or3/plugin-sdk` and call `defineOr3Plugin()`
3. `validate` / `test` / `pack` via `plugin-runtime:cli`
4. Install the digest-addressed package; leave V1 plugins in place until cutover

## Import map

Avoid `~/`, `~~/`, `@/`, `@@/`, `#imports`, `#app`, and Nuxt auto-imports inside V2 packages. Use `@or3/plugin-sdk` context APIs instead. The report-only codemod (`plugin-runtime:v1-imports:warn`) never rewrites files unless you pass `--write`.

## Lifecycle coverage limits

- V1 registrations are immediately visible and may use global side effects (`legacy-global-possible`).
- V2 activation is per process/client generation, not fleet-atomic.
- Disable retains digests, settings, and migrated state.
