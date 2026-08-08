# useDocumentAiSettings

Persistence and defaults for Document AI agent preferences. Settings are stored in the Dexie `kv` table and sanitized on every read.

## Purpose

`useDocumentAiSettings()` returns:

-   `settings` — computed `DocumentAiSettingsV1`.
-   `ensureLoaded()` — force-load settings from `kv` (client only).
-   `update(patch)` — merge, sanitize, and persist a patch.
-   `reset()` — restore defaults.

`DocumentAiSettingsV1` includes `maxIterations` (clamped between 2 and 20, default 8), quick actions, and other agent knobs. The module also exports `DEFAULT_DOCUMENT_AI_SETTINGS`, `sanitizeDocumentAiSettings`, and `clampDocumentAiMaxIterations`.

## Usage

```ts
import { useDocumentAiSettings } from '~/composables/documents/useDocumentAiSettings';

const { settings, update, reset } = useDocumentAiSettings();

await update({ maxIterations: 6 });
```

## Notes

-   The storage key is `document_ai_settings.v1` in `kv`.
-   Loading is lazy and singleton across callers.

## Related

-   `useDocumentAiAgent` — the agent that consumes these settings.
-   `~/db/kv` — the backing store.
