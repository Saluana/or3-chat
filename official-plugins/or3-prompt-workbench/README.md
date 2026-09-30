# Prompt Workbench

Build reusable prompts with variables, preview exactly what will run, run it on a
host model, and keep versioned presets.

## What it does

- **Variables, not code.** `{{name}}` placeholders are substituted literally; the
  preview and the executed prompt come from the same render function, so they
  cannot disagree.
- **Honest validation.** Missing values and malformed placeholders are reported
  before anything runs; a prompt that would execute with a blank hole is refused.
- **Versioned presets.** Presets are data with a version. An older store is
  migrated (or reported as reset) instead of being guessed at, and preset counts
  and names are bounded. Identities are unique: a different name that normalizes
  to an existing preset's identity is refused instead of silently overwriting it.
- **First action.** Opening the plugin on a selection fills a `selection`
  variable and previews a reusable summarization template. The package sample is
  only the fallback when no document or message was selected.
- **A result can continue.** The answer can become a new document or a chat
  thread through the host's approved write actions.
- **Presets that persist.** Presets live in the workspace/plugin-scoped host
  storage. A preset is shown as saved only after storage confirms the write, and
  a refusal is reported instead of a preset that would vanish on reactivation.

## Limits (deliberate)

- No workflow engine, no scheduling, no background runs: one preview, one run.
- No expressions, includes, loops or remote templates.
- Model calls go through the host's governed `ai.complete` capability; the plugin
  never holds a credential or picks an endpoint. The output ceiling is the lower
  of the plugin's default and the host's disclosed limit, and each run counts
  against the host's per-session budget.
- Template, variable and expanded-prompt bounds are measured in UTF-8 bytes and
  sized to the host renderer's budgets. An oversized value is refused with the
  variable name; nothing is silently truncated before a model sees it.

## Host requirements

- The same operator model configuration as Model Compare.
- `documents.read`/`documents.write` (selection handoff and approved writes),
  `network.http`, `settings.read`/`settings.write` and `storage.read`/
  `storage.write` (presets live in the plugin's own storage).

## Authoring

```sh
bun .authoring/generate.mjs --check
bun test
or3-plugin validate .
or3-plugin pack . --archive ./or3-prompt-workbench.or3pkg
or3-plugin inspect .
```

## License

GPL-3.0 (see `LICENSE`). No third-party runtime code; see `THIRD_PARTY_NOTICES`.
