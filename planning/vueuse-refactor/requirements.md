---
artifact_id: 6b0c41e9-7fda-4a5b-8975-8cd8b46c17bc
title: VueUse & Nuxt Adoption Plan
owner: frontend
status: draft
---

# Introduction

Goal: replace bespoke browser/DOM utilities with VueUse and Nuxt composables to reduce surface area, improve SSR safety, and keep behavior identical (equal or faster performance, never slower). Scope covers storage, debounce/throttle, scroll lock, clipboard/file flows, responsive breakpoints, observer/event wiring, and data fetching in `or3-chat`.

# Requirements

## 1. Persisted State via VueUse Storage + Nuxt useState

-   **User Story:** As a developer, I want persisted settings to use VueUse storage composables, so that state stays reactive, SSR-safe, and consistent across components.
-   **Acceptance Criteria:**
    -   WHEN any existing key is read or written in `useAiSettings`, `useMultiPane`, `useActiveSidebarPage`, `ResizableSidebarLayout`, or `ChatInputDropper` THEN the value SHALL be stored via `useLocalStorage`/`useStorage` with the same storage keys and defaults.
    -   WHEN running under SSR THEN no direct `localStorage` access SHALL be attempted; hydration SHALL preserve previous client state.
    -   WHEN multiple components access the same key THEN they SHALL share a Nuxt `useState` singleton to avoid desync.

## 2. Debounce/Throttle Helpers via VueUse

-   **User Story:** As a developer, I want debounce/throttle to use VueUse helpers, so that timers clean up automatically and behaviors stay unchanged.
-   **Acceptance Criteria:**
    -   WHEN search/save watchers fire in `useSidebarSearch`, `useThreadSearch`, `useDocumentsStore`, `SearchPanelRoot`, `ThemePage`, or `PromptEditor` THEN `useDebounceFn`/`watchDebounced`/`useThrottleFn` SHALL enforce the same delay values as before.
    -   WHEN components unmount or HMR reloads THEN no dangling timers SHALL remain.

## 3. Scroll Lock via VueUse

-   **User Story:** As a user, I want scroll locking to behave the same without leaving the page stuck, so that modals/panels work reliably.
-   **Acceptance Criteria:**
    -   WHEN `useScrollLock` is consumed THEN it SHALL delegate to VueUse `useScrollLock` targeting `document.body` by default and expose `lock`, `unlock`, and `isLocked` refs.
    -   WHEN scope is disposed THEN body overflow SHALL be restored automatically.

## 4. Clipboard & File Flows via VueUse

-   **User Story:** As a user, I want copy and file attach actions to remain identical while gaining permission/error handling.
-   **Acceptance Criteria:**
    -   WHEN copy is triggered in `ChatMessage`, `WorkflowChatMessage`, or `ThemePage` THEN `useClipboard` SHALL perform the copy and surface success/error state without altering UX.
    -   WHEN file selection/drop occurs in `ChatInputDropper` THEN `useFileDialog` and `useDropZone` (if applicable) SHALL handle inputs with existing validation preserved.

## 5. Responsive Breakpoints via VueUse

-   **User Story:** As a user, I want responsive behavior unchanged while reducing custom media listener code.
-   **Acceptance Criteria:**
    -   WHEN layout responsiveness is computed in `useResponsiveState` or `ResizableSidebarLayout` THEN it SHALL use a shared `useBreakpoints`/`useMediaQuery` instance with existing breakpoint values.
    -   WHEN SSR renders pages THEN default breakpoint assumptions SHALL match current behavior to avoid hydration mismatches.

## 6. Event/Observer Management via VueUse

-   **User Story:** As a developer, I want resize/mutation/window listeners to auto-clean so HMR and navigation don’t leak handlers.
-   **Acceptance Criteria:**
    -   WHEN listeners/observers are needed in `SideBar`, `ResizableSidebarLayout`, `PageShell`, `DocumentationShell`, or `ChatInputDropper` THEN they SHALL be registered via `useEventListener`, `useResizeObserver`, or `useMutationObserver` with identical handler logic.
    -   WHEN components unmount or HMR reloads THEN all observers/listeners SHALL be disposed without leaving duplicates.

## 7. Data Fetching via Nuxt Composables

-   **User Story:** As a user, I want documentation/help data to load the same while benefiting from Nuxt fetch caching and error refs.
-   **Acceptance Criteria:**
    -   WHEN data is loaded in `DocumentationShell`, `HelpChat`, or `useAi` asset fetches THEN it SHALL use `useFetch`/`useAsyncData`/`useLazyAsyncData` with current URLs and parameters unchanged.
    -   WHEN SSR runs THEN fetches SHALL remain SSR-safe and deduped; client-only fetches SHALL stay client-gated.

## 8. Non-Functional (Performance, Parity, Safety)

-   **Acceptance Criteria:**
    -   All changes SHALL maintain identical functional behavior; no slower UX is acceptable (equal or faster only).
    -   Error handling SHALL be at least as robust as current code; new composables SHALL surface errors where previously silent failures existed.
    -   Existing storage keys, query params, and API payloads SHALL remain unchanged to avoid migrations.

# Out of Scope

-   Introducing new product features or UI changes beyond composable swaps.
-   Changing breakpoint definitions, storage key names, or API contract shapes.
