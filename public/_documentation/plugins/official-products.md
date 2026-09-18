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
  clicks. The plugin must hold the workspace-approved `documents.write` grant;
  the host prepares the exact payload, freezes the target document and its
  revision, and executes only that plan. Replacing the selection needs an
  explicit host confirmation, the target is always the document the plugin was
  opened on — never an id the plugin names — and one write runs at a time.
- **First action.** Setup declares the first action and, when the package ships
  one, its sample file (`firstAction.samplePath`). Selected context always wins;
  the sample is only the fallback when no document or message was selected.
  `samplePath` is optional — a package that declares `usesSampleContext: true`
  without one (the pre-sample v1 shape) simply requires a selection. A selected
  handoff is resolved through the server's activation-bound selection handle,
  checked against the activation's `documents.read` grant and a byte bound before
  any content reaches the sandbox.
- **Demand-driven, contained sessions.** A package is started when its surface
  opens, not for every enabled plugin at manifest sync. The containment watchdog
  still ends a session after its wall-clock budget; a stopped package offers a
  restart that keeps the fields already typed in the surface.
- **Persistent plugin storage.** Prompt Workbench presets are stored in the
  workspace/plugin-scoped host storage service. The UI reports a preset as saved
  only after storage confirms the write; a refusal is shown instead of a preset
  that would disappear on reactivation.
- **No accidental spend.** Document Utilities treats choosing a model-backed
  transformation as an explicit state update: the first click renders the model
  selector and its prices, and only the next click dispatches. Each result keeps
  its own transformation, title and source metadata, so a failed run can never
  relabel an older result. Clearing or replacing the context discards any
  in-flight response.
- **Model Compare validates the submitted prompt.** Typing only updates the
  host field store, so the compare button is enabled independently of plugin
  state and the prompt is validated from the submitted values.

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
- On a prebuilt container the entrypoint translates both variables into their
  `NUXT_ADMIN_PLUGIN_ALLOWED_MODELS` / `NUXT_ADMIN_PLUGIN_MODEL_PRICES` runtime
  overrides, so the documented variables configure a running image without a
  rebuild.

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
