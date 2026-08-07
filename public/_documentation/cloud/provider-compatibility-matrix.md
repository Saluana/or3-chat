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

## Standalone Clone Support

The application manifest pins its runtime providers, workflows, Intern client,
and `or3-scroll` to immutable npm releases. A fresh `or3-chat` checkout can
therefore install without sibling repositories. `@or3/plugin-sdk` remains a
small in-repository development dependency and is copied into generated
projects where needed.

Before a release, regenerate `bun.lock` and verify an isolated checkout with
`bun install --frozen-lockfile`, the provider compatibility test, type-check,
and a production build.

## Related

- [providers](./providers)
- [or3-cloud-wizard](./or3-cloud-wizard)
- [migration-default-stack](./migration-default-stack)
