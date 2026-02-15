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

## Package Resolution Rules

- Provider IDs map to Nuxt modules as `or3-provider-<id>/nuxt`.
- Local IDs like `custom`, `memory`, `redis`, and `postgres` are intentionally not package-resolved.
- Wizard-generated modules and config-derived modules are merged.

## Related

- [providers](./providers)
- [or3-cloud-wizard](./or3-cloud-wizard)
- [migration-default-stack](./migration-default-stack)

