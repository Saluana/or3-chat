# Repository navigation

When working in an OR3 Chat checkout, use this order:

1. Read the closest applicable `AGENTS.md`.
2. Read `public/_documentation/docmap.json`.
3. Open only the relevant public documentation pages named by the map.
4. Inspect exported types, SDKs, examples, and tests.
5. Inspect implementation only after the public surface is understood.

Required paths by surface:

| Surface | First paths |
| --- | --- |
| Setup | `public/_documentation/cloud/or3-cloud-wizard.md`, `cloud/or3-config.md`, `scripts/cli/or3-cloud.ts` |
| Plugin | `public/_documentation/plugins/`, `packages/plugin-sdk/`, `examples/plugins/`, `tests/plugin-runtime/` |
| Theme | `public/_documentation/themes/`, `app/theme/`, `scripts/cli/validate-theme.ts` |
| Core | Relevant docmap page, public type, existing extension registry or hook, its canonical test |

Never assume a command, manifest field, contribution kind, or host capability
exists because an older reference mentions it. Confirm it in the checkout and
report an unsupported contract plainly.
