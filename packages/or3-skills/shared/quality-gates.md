# Quality gates

Run the smallest relevant checks after a coherent implementation batch. Inspect
the final diff in every case.

| Surface | Required evidence | Typical checkout command |
| --- | --- | --- |
| Setup | Redacted config validation and health/doctor result | `bun run or3-cloud:validate`; `bun run doctor` |
| V1 plugin | Public/internal surface confirmed, cleanup, targeted test | Canonical affected test plus `bun run type-check` when types change |
| V2 plugin artifact | Manifest, grants, SDK-only imports, test/build/pack/inspect | `bun run plugin-runtime:cli -- validate|test|build|pack|inspect <dir>` |
| Theme | Schema, light/dark, responsive and interaction states | `bun run theme:validate`; `bun run theme:build-css` when selector CSS changes |
| Core | Existing callers, types, targeted tests, docs/docmap | Canonical test plus `bun run type-check` when public types change |

Use commands that exist in the target checkout. Do not run broad paid-network,
credential-writing, stress, or visual suites by default. Treat a changed or
missing command as a compatibility finding, not an invitation to improvise one.
