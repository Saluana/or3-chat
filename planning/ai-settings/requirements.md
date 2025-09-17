# AI Settings – Requirements

artifact_id: 4f22b0a6-1a2f-4a2d-9c15-5e60b4b2f9c9
content_type: text/markdown

## Introduction

The AI Settings page (`AiPage.vue`) provides global AI configuration and must match the layout and retro styling of `ThemePage.vue`.
Core capabilities requested:

-   Master system prompt applied to all chats, in addition to any per-thread prompt chosen in `SystemPromptsModal.vue`.
-   Ability to choose either a fixed default model or use the last selected model as the default.

This document also proposes a few pragmatic, low-risk additional settings that improve usability without over-engineering.

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

### 3. Default generation parameters

As a user, I want to set default generation parameters so that responses match my preferences by default.

Acceptance Criteria:

-   Controls SHALL include: temperature (0.0–2.0), max output tokens (0 = unlimited until model cap), and JSON mode toggle.
-   Inputs SHALL be sanitized (clamped ranges; integers for tokens).
-   Defaults SHALL apply to new chats unless overridden per chat.

### 4. Default streaming toggle

As a user, I want to set whether streaming is enabled by default so that I control response experience.

Acceptance Criteria:

-   A Streaming on/off toggle SHALL be present and persist.
-   New chats SHALL adopt this default unless changed per chat.

### 5. Default tool-use policy

As a user, I want a default policy for tool/function calling so that I can allow/disable/confirm tool usage.

Acceptance Criteria:

-   Options SHALL be: allow, disallow, ask (prompt before first tool call per thread).
-   New chats SHALL adopt this default.

### 6. Persistence and migration

As a user, I want my AI settings to persist across sessions and survive updates.

Acceptance Criteria:

-   Settings SHALL persist in localStorage under a stable, versioned key.
-   On load, settings SHALL be sanitized and migrated if older versions are detected (missing/new fields filled with defaults).

### 7. Styling and accessibility

As a user, I want the AI Settings UI to match Theme Settings and be accessible.

Acceptance Criteria:

-   Section cards, spacing, and retro style SHALL match `ThemePage.vue` (reuse classes where possible).
-   All controls SHALL have labels and keyboard focus states.

### 8. Non-functional

-   Performance: reads/writes are synchronous and fast; avoid heavy reactivity.
-   Reliability: invalid values are sanitized; fallback paths are safe.
-   Compatibility: works with the current Nuxt/Vue stack; no backend dependency.
-   Testability: unit tests cover sanitization, prompt composition, and fallback logic.

## Suggested additional settings (v1)

-   Safety preface toggle: prepend a short safety rule block before the master prompt.
-   Reply length presets: short/medium/long mapping to token presets (optional; can be derived from max tokens).
-   Auto-continue default: if your chat supports continuation, allow a default toggle.

## Out of scope (v1)

-   Cloud sync or multi-profile settings, role-based policies, import/export.
