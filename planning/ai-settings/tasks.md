# AI Settings – Tasks

Artifact ID: f0fb3d19-2f65-4e31-9b1b-36f1b5a3e9c0

## 1. Composable and data types

-   [x] 1.1 Create `app/composables/useAiSettings.ts` with:
    -   `AiSettingsV1` type, `ToolPolicy` enum-like union.
    -   `DEFAULT_AI_SETTINGS`, storage key, sanitize + migrate helpers.
    -   HMR-safe singleton store with `settings` (Ref), `set`, `reset`, `load`.
    -   Requirements: 1, 2, 3, 4, 5, 6, 7, 8
-   [x] 1.2 Unit tests: `app/composables/__tests__/useAiSettings.test.ts`
    -   Covers sanitize ranges, migration fill-ins, persistence load errors.
    -   Requirements: 3, 6, 7, 9

## 2. AiPage.vue UI (match ThemePage.vue)

-   [ ] 2.1 Scaffold `app/components/modal/dashboard/AiPage.vue`
    -   Use section cards and retro styles (reuse classes from ThemePage.vue).
    -   Requirements: 7, 8
-   [ ] 2.2 Master System Prompt section
    -   Large textarea, character count, Save applies `set({ masterSystemPrompt })`.
    -   Requirements: 1, 7, 8
-   [ ] 2.3 Model Defaults section
    -   Radio/segmented: Use last selected vs Use fixed model.
    -   Conditional model picker (reuse model store + search from `useModelStore`/`useModelSearch`).
    -   Streaming default toggle.
    -   Requirements: 2, 4, 7, 8
-   [ ] 2.4 Generation Defaults section
    -   Temperature slider (0–2), Max tokens input (int, nullable), JSON mode toggle.
    -   Requirements: 3, 7, 8
-   [ ] 2.5 Tool Use Policy section
    -   Segmented: allow / disallow / ask.
    -   Requirements: 5, 7, 8
-   [ ] 2.6 Reset section
    -   Reset to defaults button wired to `reset()`.
    -   Requirements: 7
-   [ ] 2.7 Accessibility pass
    -   Labels, aria-describedby for helper text, keyboard focus states.
    -   Requirements: 8

## 3. Integration into AI request pipeline

-   [ ] 3.1 Add `composeSystemPrompt(master, thread)` to `app/utils/prompt-utils.ts` (or existing util file)
    -   Exported for reuse; add unit tests.
    -   Requirements: 1, 9
-   [ ] 3.2 Wire composition in `useAi.ts` request build path
    -   Pull master from `useAiSettings()` and thread prompt from existing source.
    -   Requirements: 1, 2, 3, 4, 5
-   [ ] 3.3 Default model resolver
    -   Implement `resolveDefaultModel(settings, deps)` utility in `utils/models-service.ts` (or adjacent) and use when creating new chats.
    -   Show info toast on fallback.
    -   Requirements: 2, 6, 8, 9
-   [ ] 3.4 Apply generation defaults
    -   If chat/session has no explicit overrides, apply temperature, max tokens, JSON mode, streaming, and tool policy from settings.
    -   Requirements: 3, 4, 5

## 4. Tests

-   [ ] 4.1 Unit: `composeSystemPrompt` and `resolveDefaultModel` in `app/utils/__tests__/ai-settings-utils.test.ts`
    -   Requirements: 1, 2, 6, 9
-   [ ] 4.2 Integration (light)
    -   Mock request builder to assert defaults are applied and fallback path triggers toast.
    -   Requirements: 2, 3, 4, 5, 6, 9

## 5. Docs

-   [ ] 5.1 Add `docs/UI/ai-settings.md` with screenshots and behavior notes (composition order, fallbacks).
    -   Requirements: 8, 9

## 6. Quality gates

-   [ ] Lint/typecheck pass
-   [ ] Unit tests pass
-   [ ] Manual smoke:
    -   Master prompt composes before thread prompt.
    -   Fixed model selection persists; fallback toast appears when unavailable.
    -   Generation defaults and streaming/tool policy applied on new chats.
