artifact_id: 30c0f83b-4d5b-4c21-96a3-8a5f0bf8997f

# Mobile Optimization Tasks

## 1. Responsive State Utilities

-   [x] Create `useResponsiveState` composable wrapping VueUse breakpoints with strict ≤768px gating (Requirements: 1, 3, 6)
-   [x] Add unit tests covering mobile/desktop breakpoint transitions and ensuring desktop flag stays false above threshold (Requirements: 5, 6)

## 2. Documentation Shell Mobile Layout

-   [x] Introduce mobile-aware header stack and spacing adjustments in `app/components/DocumentationShell.vue` without altering desktop markup (Requirements: 1, 4, 6)
-   [x] Add navigation toggle button with proper `aria` attributes and keyboard support (mobile only) (Requirements: 2, 5, 6)
-   [x] Implement sidebar overlay rendering with transition, focus trap, and scroll lock (mobile only) (Requirements: 1, 2, 5, 6)
-   [x] Ensure sidebar overlay closes on navigation link selection and route change (Requirements: 2)
-   [x] Validate that desktop (>768px) still renders the persistent sidebar with no toggles (Requirements: 6)

## 3. Scroll Lock & Focus Management

-   [x] Implement `useScrollLock` utility with cleanup on unmount (Requirements: 2, 5)
-   [x] Integrate scroll lock into sidebar controller lifecycle (mobile execution only) (Requirements: 2, 5, 6)

## 4. Help Chat Fullscreen Mobile Mode

-   [x] Add responsive layout controller in `app/components/ui/HelpChat.vue` to switch to `fixed inset-0` fullscreen on mobile expand while keeping desktop sizing intact (Requirements: 3, 6)
-   [x] Adjust chat body and input container styling for mobile readability (Requirements: 4)
-   [x] Ensure launcher button positions correctly without overlapping critical UI (Requirements: 3)
-   [x] Confirm desktop chat launcher/panel dimensions remain unchanged (Requirements: 6)

## 5. Testing & QA

-   [ ] Update component tests to cover sidebar overlay and chat fullscreen behavior (Requirements: 1, 2, 3)
-   [ ] Add desktop regression assertions ensuring sidebar visibility and chat sizing parity (Requirements: 6)
-   [ ] Add E2E scenarios for mobile navigation and chat flows (Requirements: 2, 3, 4)
-   [ ] Run Lighthouse/Axe mobile audits and document results (Requirements: 5)
