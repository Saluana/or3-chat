# AI Settings – Tasks

Artifact ID: f0fb3d19-2f65-4e31-9b1b-36f1b5a3e9c0

## 1. Composable and data types

-   [x] 1.1 Create `app/composables/useAiSettings.ts` with:
    -   `AiSettingsV1` type with only: `masterSystemPrompt`, `defaultModelMode`, `fixedModelId`.
    -   `DEFAULT_AI_SETTINGS`, storage key, sanitize + migrate helpers.
    -   HMR-safe singleton store with `settings` (Ref), `set`, `reset`, `load`.
    -   Requirements: 1, 2, 3, 4, 5
-   [x] 1.2 Unit tests: `app/composables/__tests__/useAiSettings.test.ts`
    -   Covers migration fill-ins and persistence load errors.
    -   Requirements: 3, 4

## 2. AiPage.vue UI (match ThemePage.vue)

-   [x] 2.1 Scaffold `app/components/modal/dashboard/AiPage.vue`
    -   Use section cards and retro styles (reuse classes from ThemePage.vue).
    -   Requirements: 4, 5
-   [x] 2.2 Master System Prompt section
    -   Large textarea, character count, Save applies `set({ masterSystemPrompt })`.
    -   Requirements: 1, 4, 5
-   [x] 2.3 Model Defaults section
    -   Radio/segmented: Use last selected vs Use fixed model.
    -   Conditional model picker (reuse model store + search from `useModelStore`/`useModelSearch`).
    -   Requirements: 2, 3, 4
-   [x] 2.6 Reset section
    -   Reset to defaults button wired to `reset()`.
    -   Requirements: 4
-   [x] 2.7 Accessibility pass
    -   Labels, aria-describedby for helper text, keyboard focus states.
    -   Requirements: 4

## 3. Integration into AI request pipeline

-   [x] 3.1 Add `composeSystemPrompt(master, thread)` to `app/utils/prompt-utils.ts` (or existing util file)
    -   Exported for reuse; add unit tests.
    -   Requirements: 1
-   [x] 3.2 Wire composition in `useAi.ts` request build path
    -   Pull master from `useAiSettings()` and thread prompt from existing source.
    -   Requirements: 1, 2
-   [x] 3.3 Default model resolver
    -   Implement `resolveDefaultModel(settings, deps)` utility in `utils/models-service.ts` (or adjacent) and use when creating new chats.
    -   Show info toast on fallback.
    -   Requirements: 2, 3, 4
-   [ ] 3.4 (Removed) Apply generation defaults — out of scope

## 4. Tests

-   [x] 4.1 Unit: `composeSystemPrompt` and `resolveDefaultModel` in `app/utils/__tests__/ai-settings-utils.test.ts`
    -   Requirements: 1, 2, 3
-   [ ] 4.2 Integration (light)
    -   Mock request builder to assert model fallback path triggers toast and master prompt composition is used.
    -   Requirements: 1, 2, 3, 4

## 5. Docs

-   [ ] 5.1 Add `docs/UI/ai-settings.md` with screenshots and behavior notes (composition order, fallbacks).
    -   Requirements: 4

## 6. Quality gates

-   [ ] Lint/typecheck pass
-   [ ] Unit tests pass
-   [ ] Manual smoke:
    -   Master prompt composes before thread prompt.
    -   Fixed model selection persists; fallback toast appears when unavailable.
