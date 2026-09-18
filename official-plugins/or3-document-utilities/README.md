# Document Utilities

Transform selected content, preview the result, then create a new document,
replace the selection, or continue in chat.

## What it does

- **Offline outline first.** `Outline (offline)` runs in the plugin worker with no
  model at all, so the plugin is useful before any model is configured.
- **Model transforms with disclosed cost.** Summarize, key points, action items
  and rewrite-for-clarity run through the host's governed `ai.complete`
  capability; the preview shows the model and the attributed spend.
- **No accidental spend.** Choosing a model-backed transformation is an explicit
  state update: the first Transform click shows the model selector and its
  prices, and only the next click dispatches. Each result keeps its own
  transformation, title and source, so a later failed run can never relabel an
  older result, and Clear discards an in-flight response.
- **Nothing is written without a click.** Every write is a host-rendered action
  that requires the workspace-approved `documents.write` grant: the plugin never
  touches a document itself, replacing the selection requires a host confirmation
  of the exact frozen payload and document revision, and the target is always the
  document the plugin was opened on — never an id the plugin names.
- **Bounded input.** Selections are validated in UTF-8 bytes (non-empty, at most
  6,000 bytes) with explicit reasons, so a whole library cannot be pushed through
  one call. A long model result is abbreviated in the preview with an explicit
  marker; the write payload keeps the full text.

## Limits (deliberate)

- No arbitrary filesystem access, no silent overwrite, no PDF extraction or OCR.
- No background processing: one selection, one transformation at a time.

## Host requirements

- Model transforms need the operator model configuration and an approved paid
  model chosen in the form; the offline outline does not need a model. The output
  ceiling is the lower of the plugin's default and the host's disclosed limit.
- Grants: `documents.read` (selection scope), `documents.write` (approved
  writes), `network.http` (model calls), `settings.read`/`settings.write`.

## Authoring

```sh
bun .authoring/generate.mjs --check
bun test
or3-plugin validate .
or3-plugin pack . --archive ./or3-document-utilities.or3pkg
or3-plugin inspect .
```

## License

GPL-3.0 (see `LICENSE`). No third-party runtime code; see `THIRD_PARTY_NOTICES`.
