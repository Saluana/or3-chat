## Overview

The codebase currently exposes two competing mechanisms for responsive breakpoint state:

1. **Legacy global ref** – `app/state/global.ts` exports `isMobile = ref(false)` which is mutated inside `PageShell.vue` using `window.matchMedia('(max-width: 640px)')`. Many chat-centric components import this ref directly to adjust layout, keyboard shortcuts, and plugin behaviour.
2. **New composable** – `useResponsiveState()` (introduced for the documentation shell work) uses VueUse breakpoints with a 768px threshold and is SSR-safe by returning static refs when `window` is unavailable. Newer UI like `DocumentationShell` and `HelpChat` consume this composable.

These two sources disagree on the breakpoint (640px vs 768px), are updated in different places, and are not kept in sync. Removing the legacy ref without a plan would break multiple chat flows.

## Current Behaviour Audit

### How the global `isMobile` ref is updated

| Location                       | Behaviour                                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/state/global.ts`          | Defines `export const isMobile = ref<boolean>(false);` alongside `state` (OpenRouter key). No logic lives here.                                                                                                                    |
| `app/components/PageShell.vue` | On client mount, registers `window.matchMedia('(max-width: 640px)')` listener. Sets `isMobile.value = mq.matches` during mount and on change. `PageShell` also consumes `isMobile` for header actions and top-offset calculations. |

### Global `isMobile` consumers

| File                                                | Usage summary                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/components/PageShell.vue`                      | Uses the ref for header action context, toggling sidebar behaviour, and computing top offsets. Also the sole writer of the value (via matchMedia). |
| `app/components/chat/ChatContainer.vue`             | Adjusts bottom padding, layout classes, and safe-area handling for the chat input wrapper.                                                         |
| `app/components/chat/ChatInputDropper.vue`          | Disables “Enter to send” on mobile, tweaks focus/scroll helpers, and exposes mobile state in bridge payloads.                                      |
| `app/components/chat/ModelSelect.vue`               | Controls autofocus behaviour based on mobile state.                                                                                                |
| `app/components/chat/SystemPromptsModal.vue`        | Chooses larger `UInput` size on mobile.                                                                                                            |
| `app/components/sidebar/SidebarProjectTree.vue`     | Imports the ref (currently unused; likely a leftover).                                                                                             |
| `app/plugins/EditorAutocomplete/TiptapExtension.ts` | Renders an inline “accept” button for mobile users when showing autocomplete suggestions.                                                          |

### `useResponsiveState` consumers

| File                                                        | Usage summary                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `app/components/DocumentationShell.vue`                     | Drives sidebar overlay, scroll lock, and header layout tweaks.                             |
| `app/components/ui/HelpChat.vue`                            | Switches between floating and fullscreen presentation, safe-area padding, and form layout. |
| `app/composables/core/__tests__/useResponsiveState.test.ts` | Unit tests ensuring breakpoint logic (≤768px) works and remains SSR-safe.                  |

## Code Change Notes

-   **Global ref definition** – `app/state/global.ts`: locate the exported `isMobile` ref near the top of the file. The compatibility bridge will write to this ref until consumers migrate.
-   **MatchMedia writer** – `app/components/PageShell.vue`: in the `<script setup>` block, search for `matchMedia('(max-width: 640px)')` and the `mq.addEventListener('change', ...)` call. This is where the new shared composable should be consumed instead of bespoke listeners.
-   **Chat layout consumers** – `app/components/chat/ChatContainer.vue`, `ChatInputDropper.vue`, `ModelSelect.vue`, `SystemPromptsModal.vue`: each imports `{ isMobile }` from `~/state/global`. The imports sit in the `<script setup>` sections at the top; replace them with the shared composable helper when migrating.
-   **Sidebar leftover** – `app/components/sidebar/SidebarProjectTree.vue`: the unused `isMobile` import appears in the `<script setup>` header and can be dropped once the bridge lands.
-   **Autocomplete plugin** – `app/plugins/EditorAutocomplete/TiptapExtension.ts`: search for `isMobile.value` inside `addKeyboardShortcuts`. Swap this dependency to the shared responsive helper (likely by passing the ref in via plugin setup).
-   **New responsive entry point** – `app/composables/core/useResponsiveState.ts`: contains the SSR guard (`if (typeof window === 'undefined')`) and VueUse breakpoint map. This is the single place to expose shared refs and emit updates for the bridge.

### Mismatch risks

-   **Breakpoint difference**: Legacy uses 640px, new composable uses 768px. Behaviour differences already exist (e.g., chat input may treat 700px-wide viewport as desktop while docs shell treats it as mobile).
-   **Update timing**: Global ref updates only inside `PageShell`. Components that mount outside of `PageShell` (future contexts, tests, or storybook) may never see updates.
-   **SSR safety**: The new composable is defensive (`typeof window === 'undefined'`), while the legacy ref relies on `process.client` checks in `PageShell`. Mixing them requires careful hydration handling.

## Proposed Direction

1. **Single breakpoint authority via the composable**

    - Convert `useResponsiveState` into a shared singleton (e.g., via `createSharedComposable` or module-level refs) so multiple callers receive the same reactive refs.
    - Use the composable to drive the legacy global ref, ensuring both legacy imports and new consumers read consistent values.

2. **Align breakpoint definition**

    - Decide on the canonical threshold (likely 768px to match Tailwind `md`) and document the change.
    - Provide migration notes for areas previously tuned for 640px (e.g., chat layout padding). Add TODOs/tests if behavioural adjustments are needed.

3. **Bridge layer for gradual migration**

    - Introduce a lightweight bridge (e.g., a client plugin or helper inside `useResponsiveState`) that syncs the composable’s `isMobile` ref into `app/state/global.ts`.
    - Ensure the bridge runs on both initial mount and subsequent breakpoint changes.
    - Keep the bridge opt-in until all consumers migrate, then deprecate the global ref.

4. **Refactor consumers incrementally**

    - Prioritise critical chat components (`ChatContainer`, `ChatInputDropper`, plugins) to read from the composable directly.
    - Replace ad-hoc matchMedia checks (e.g., `PageShell`) with the shared composable or its bridge to avoid divergence.
    - Remove unused imports (e.g., `SidebarProjectTree.vue`).

5. **Testing strategy**
    - Keep the focused unit test (`bunx vitest useResponsiveState`) and expand coverage if we add bridge logic.
    - Add integration-style tests or component tests where breakpoint-dependent behaviour is critical (chat input keyboard handling, documentation shell overlay).
    - Document manual QA steps (resize viewport, mobile devtools, verify autocomplete accept button).

## Open Questions / Follow-ups

-   Should we maintain dual thresholds temporarily (640px for chat, 768px elsewhere) or align immediately and adjust spacing to compensate?
-   Where should the bridge live? Options include a dedicated client plugin, enhancing `useResponsiveState`, or refactoring `PageShell` to consume the composable and update the global ref.
-   Are there any external plugins/extensions that import `~/state/global` directly (outside this repo)? If so, we may need a longer deprecation window.

## Next Steps

-   Gather stakeholder input on the target breakpoint and migration timeline.
-   Once agreed, implement the bridge and start refactoring consumers as outlined in the task plan.
