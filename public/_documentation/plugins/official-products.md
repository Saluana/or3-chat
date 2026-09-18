# Official Products (Model Compare, Prompt Workbench, Document Utilities)

Three first-party plugins ship with OR3 Cloud as **ordinary portable packages**:
they use the same `@or3/plugin-sdk` authoring surface, the same
`or3-portable-client-v1` profile, the same review lane and the same setup flow as
community plugins. Official identity bypasses no rule.

They live in the repository under `official-plugins/`, one standalone package
each, with their own manifest/policy/setup descriptors, tests, fixtures, license
and notices. Their packaged archives are submitted through the publisher lane
(the review identity is the package digest).

| Product | Id | First outcome | Works with no model configured |
|---|---|---|---|
| Model Compare | `or3.model-compare` | One prompt to several host models, side by side, then continue the chosen answer in chat or as a document | Explains that the host has no approved models |
| Prompt Workbench | `or3.prompt-workbench` | Variables → preview → run → versioned presets | Preview and presets |
| Document Utilities | `or3.document-utilities` | Selected content → transform → preview → approved write | Deterministic offline outline |

## How they run

- **Contained.** Each package is an `isolated-client` worker. It renders a
  validated declarative UI tree; the host renders every control.
- **Host-mediated model calls.** `ai.models` (the host's approved model list with
  disclosed prices and limits) and `ai.complete` (one governed completion). The
  plugin never sees a credential, never chooses an endpoint, and every call is
  attributed to the plugin with its real spend. The host enforces the allowlist,
  output ceiling, concurrency and per-activation spend.
- **Host-performed writes.** A result becomes a document, replaces the selected
  document, or continues in a chat only through a host-rendered action the user
  clicks. Replacing the selection needs an explicit host confirmation, and the
  target is always the document the plugin was opened on — never an id the
  plugin names.
- **First action.** Setup declares the first action and, when it runs on a sample,
  the package's own sample file (`firstAction.samplePath`). The host resolves the
  sample or the selected document and hands the content to the plugin; it never
  guesses a filename.

## Host configuration

Model-backed features need operator configuration:

```text
OR3_PLUGIN_ALLOWED_MODELS=openai/gpt-oss-120b,anthropic/claude-3.5-sonnet
OR3_PLUGIN_MODEL_PRICES={"openai/gpt-oss-120b":{"promptPerMillion":0.2,"completionPerMillion":0.6}}
```

- Models without a price are refused (never recorded as free) and are shown as
  unavailable.
- An empty allowlist means no approved models: the plugins say so and the offline
  outline in Document Utilities still works.
- The provider credential stays in the host's own provider configuration. There
  is no central credential proxy.

## Packaging and evidence

```sh
bun packages/plugin-sdk/bin/or3-plugin.mjs validate official-plugins/or3-model-compare
bun packages/plugin-sdk/bin/or3-plugin.mjs test     official-plugins/or3-model-compare
bun packages/plugin-sdk/bin/or3-plugin.mjs pack     official-plugins/or3-model-compare --archive /tmp/or3-model-compare.or3pkg
bun packages/plugin-sdk/bin/or3-plugin.mjs inspect  /tmp/or3-model-compare.or3pkg
```

`docs/phase-9-official-products-evidence.md` records each package's digest,
manifest digest, test result, conformance verdict and license/notice inventory,
and states honestly what was and was not executed.
