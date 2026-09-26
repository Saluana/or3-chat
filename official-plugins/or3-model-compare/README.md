# Model Compare

Send one prompt to several host-provided models, read the answers side by side,
and continue the best one in normal chat or as a new document.

## What it does

- **One prompt, many models.** The same prompt text reaches every selected model,
  so the comparison is fair by construction.
- **Disclosed cost.** Each answer shows the host-attributed provider spend, and
  the total is summarized under the results. OR3 adds no fee; the provider bills
  your account.
- **A chosen answer can continue.** The chosen answer can be written to a new
  document, or opened in a normal chat thread where you keep working.
- **The submitted prompt is the contract.** Typing only updates the host field
  store, so the compare button never depends on plugin state; the prompt is
  validated when Compare is clicked and an empty prompt is refused with the
  reason.
- **Failure keeps what worked.** If one model refuses or times out, the answers
  that arrived stay visible with an actionable reason for the one that did not.

## Limits (deliberate)

- At most four models; the per-answer output ceiling is the lower of the plugin's
  default (512 tokens) and the host's own disclosed limit, and every call counts
  against the host's per-session plugin AI budget. Unpriced models cannot be
  selected.
- No benchmark service, no scoring, no bundled inference: every call goes through
  the host's governed `ai.complete` capability, which holds the credential and
  enforces the allowlist, output ceiling and spend limit.
- No credential is stored, and no provider endpoint is chosen by the plugin.
- The prompt is byte-bounded, and long answers are abbreviated in the display
  (with an explicit marker) so the rendered tree stays inside the host's
  budgets. The full answer is what a document write or chat continuation keeps.

## Host requirements

- An operator-configured model allowlist and prices
  (`OR3_PLUGIN_ALLOWED_MODELS`, `OR3_PLUGIN_MODEL_PRICES`) plus a host model
  provider credential. Without them the plugin explains that no approved model is
  available instead of failing at run time.
- The `network.http` grant (host-mediated model calls), `documents.read` /
  `documents.write` (selection handoff and approved writes), and `settings.read` /
  `settings.write` for its defaults.

## Authoring

```sh
bun .authoring/generate.mjs --check   # descriptors match the authoring config
bun test                              # package tests (bun:test)
or3-plugin validate .
or3-plugin build .
or3-plugin pack . --archive ./or3-model-compare.or3pkg
or3-plugin inspect .
```

`fixtures/sample-prompt.md` is the declared first-action sample
(`or3.setup.json` → `firstAction.samplePath`).

## License

GPL-3.0 (see `LICENSE`). No third-party runtime code; see `THIRD_PARTY_NOTICES`.
