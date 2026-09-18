# Document Utilities

Transform selected content, preview the result, then create a new document,
replace the selection, or continue in chat.

## What it does

- **Offline outline first.** `Outline (offline)` runs in the plugin worker with no
  model at all, so the plugin is useful before any model is configured.
- **Model transforms with disclosed cost.** Summarize, key points, action items
  and rewrite-for-clarity run through the host's governed `ai.complete`
  capability; the preview shows the model and the attributed spend.
- **Nothing is written without a click.** Every write is a host-rendered action:
  the plugin never touches a document itself, replacing the selection requires a
  host confirmation, and the target is always the document the plugin was opened
  on — never an id the plugin names.
- **Bounded input.** Selections are validated (non-empty, at most 24,000
  characters) with explicit reasons, so a whole library cannot be pushed through
  one call.

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
