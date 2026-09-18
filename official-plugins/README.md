# Official plugins (phase 3)

Three first-party products built with `@or3/plugin-sdk` on the
`or3-portable-client-v1` profile, packaged and reviewed through the ordinary
publisher lane — official identity bypasses no rule.

| Package | Id | First outcome | Offline behavior |
|---|---|---|---|
| [`or3-model-compare`](./or3-model-compare) | `or3.model-compare` | One prompt to several host models, side-by-side, then continue the chosen answer in chat | Explains that no approved model is available |
| [`or3-prompt-workbench`](./or3-prompt-workbench) | `or3.prompt-workbench` | Reusable prompt variables → preview → run → versioned presets | Preview and presets work without a model |
| [`or3-document-utilities`](./or3-document-utilities) | `or3.document-utilities` | Selected content → transform → preview → approved write | Deterministic offline outline |

Each package is standalone: its own manifest/policy/setup descriptors, tests,
fixtures, license and notices, and an `.authoring/` generator that regenerates
the descriptors deterministically (`--check` fails on drift).

## Publishing

```sh
bun packages/plugin-sdk/bin/or3-plugin.mjs validate official-plugins/<name>
bun packages/plugin-sdk/bin/or3-plugin.mjs test     official-plugins/<name>
bun packages/plugin-sdk/bin/or3-plugin.mjs pack     official-plugins/<name> --archive /tmp/<name>.or3pkg
bun packages/plugin-sdk/bin/or3-plugin.mjs inspect  /tmp/<name>.or3pkg
```

The packed `.or3pkg` archives are what the publisher lane uploads; the digests
recorded in `docs/phase-9-official-products-evidence.md` are the review identity.
