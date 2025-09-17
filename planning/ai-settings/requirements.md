# AI Settings – Requirements

artifact_id: 4f22b0a6-1a2f-4a2d-9c15-5e60b4b2f9c9
content_type: text/markdown

## Introduction

The AI Settings page (`AiPage.vue`) provides two simple, global options and must match the layout and retro styling of `ThemePage.vue`:

-   Master system prompt applied to all chats, in addition to any per-thread prompt chosen in `SystemPromptsModal.vue`.
-   Default model behavior: choose either a fixed model or use the last selected model for new chats.

All other settings (generation parameters, streaming toggles, tool policies, structured outputs, provider preferences, etc.) are out of scope for now.

## Requirements (User stories with acceptance criteria)

### 1. Master system prompt (global)

As a user, I want to set a global master system prompt so that it always applies in every chat alongside the selected per-thread prompt.

Acceptance Criteria:

-   WHEN the AI Settings page opens, THEN a large input for “Master System Prompt” SHALL be visible (textarea is sufficient).
-   WHEN the user saves or edits this prompt, THEN it SHALL persist locally and apply to subsequent requests across all chats.
-   IF the master prompt is empty, THEN no global text SHALL be injected.
-   WHEN constructing the final system prompt, THEN the master prompt SHALL precede the per-thread prompt and be separated by two newlines.

### 2. Default model or last selected

As a user, I want control over the initial model used for new chats so that my preferred model is used automatically.

Acceptance Criteria:

-   The page SHALL offer two modes: “Use last selected” and “Use fixed model”.
-   WHEN “Use fixed model” is chosen, THEN a model dropdown SHALL be shown to select a model ID from available models.
-   Settings SHALL persist and apply to new chats; existing chats keep their current selection until changed.
-   IF the fixed model is unavailable at time of use, THEN fallback SHALL be: (1) last selected if available → (2) first recommended available. A non-blocking toast SHALL inform the user of the fallback.

### 3. Persistence and migration

As a user, I want my AI settings to persist across sessions and survive updates.

Acceptance Criteria:

-   Settings SHALL persist in localStorage under a stable, versioned key.
-   On load, settings SHALL be sanitized and migrated if older versions are detected (missing/new fields filled with defaults).

### 4. Styling and accessibility

As a user, I want the AI Settings UI to match Theme Settings and be accessible.

Acceptance Criteria:

-   Section cards, spacing, and retro style SHALL match `ThemePage.vue` (reuse classes where possible).
-   All controls SHALL have labels and keyboard focus states.

### 5. Non-functional

-   Performance: reads/writes are synchronous and fast; avoid heavy reactivity.
-   Reliability: invalid values are sanitized; fallback paths are safe.
-   Compatibility: works with the current Nuxt/Vue stack; no backend dependency.
-   Testability: unit tests cover sanitization, prompt composition, and fallback logic.

## Out of scope (now)

-   Any additional controls beyond the two listed options (e.g., temperature, max tokens, streaming, tool-use, structured outputs, provider preferences, safety presets, etc.).
