# Provider Compatibility Matrix

Compatibility guide for common OR3 Cloud provider combinations.

## Matrix

| Stack | Auth | Sync | Storage | Background Jobs | Limits Store | Status |
|---|---|---|---|---|---|---|
| Local-only | none (`SSR_AUTH_ENABLED=false`) | disabled | disabled | disabled | memory | Supported |
| Legacy cloud | `clerk` | `convex` | `convex` | `convex` or memory | convex or memory | Supported |
| Default SSR stack | `basic-auth` | `sqlite` | `fs` | memory (or sync provider if available) | memory | Supported |
| Mixed: Clerk + SQLite + FS | `clerk` | `sqlite` | `fs` | memory | memory | Supported |
| Mixed: basic-auth + Convex | `basic-auth` | `convex` | `convex` or `s3` | convex or memory | convex or memory | Supported |

## Notes

- Providers are registry-driven. Core only loads packages present in `node_modules`.
- Auth, sync, and storage providers can be mixed as long as each selected provider package is installed and configured.
- Background provider and limits provider are independent knobs.
- Static builds must keep SSR auth disabled.
- The executable source of truth is
  `shared/cloud/provider-compatibility.ts`; the provider contract test verifies
  every row resolves to installed packages with the required role.

## Package Resolution Rules

- Provider IDs map to Nuxt modules as `or3-provider-<id>/nuxt`.
- Local IDs like `custom`, `memory`, `redis`, and `postgres` are intentionally not package-resolved.
- Wizard-generated modules and config-derived modules are merged.

## Standalone Clone Release Blocker

The development manifest currently uses sibling `file:../...` dependencies for
providers, workflows, and `or3-scroll`. A checkout without those siblings
cannot complete `bun install --frozen-lockfile`.

Do not replace those links with the currently published versions merely to make
an isolated install pass. The published workflow packages do not expose the
current execution/run-store/gateway API, the published SQLite provider does not
expose `./webhooks/sqlite-store`, and published provider artifacts predate
current storage/admin contracts.

The safe release sequence is:

1. Build, test, version-bump, and publish the current sibling packages.
2. Pin those new immutable versions in `or3-chat`.
3. Regenerate `bun.lock`.
4. Verify from an empty cache and checkout with no siblings:
   `bun install --frozen-lockfile`, provider compatibility tests, type-check,
   and the production build.

## Related

- [providers](./providers)
- [or3-cloud-wizard](./or3-cloud-wizard)
- [migration-default-stack](./migration-default-stack)
