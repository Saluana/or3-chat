# Tasks: Dashboard Retro Utility Consolidation

**artifact_id:** c1f58f88-43d7-4fa8-9fa9-c5c973ff1390

## 1. Introduce Shared Retro Stylesheet

-   [ ] Create `app/assets/css/retro.css` with canonical definitions for `.sr-only`, `.retro-chip`, `.retro-input`, `.retro-btn`, `.retro-btn-copy`, and shared motion rules (Requirements: 1, 2, 3)
-   [ ] Import `retro.css` from `app/assets/css/main.css` (Requirements: 1)
-   [ ] Add comments documenting intended usage and extension guidelines (Requirements: 4)

## 2. Refactor Dashboard Components

-   [ ] Update `ThemePage.vue` to remove scoped retro utility definitions and rely on shared classes (Requirements: 1, 2)
-   [ ] Update `AiPage.vue` similarly, keeping only component-specific styles (Requirements: 1, 2)
-   [ ] Update `WorkspaceBackupApp.vue` to consume shared `.sr-only` and retro helpers, pruning duplicates (Requirements: 1, 2)
-   [ ] Search across `app/` for residual `.retro-chip`, `.retro-input`, `.retro-btn`, `.retro-btn-copy`, `.sr-only` definitions and eliminate duplicates (Requirements: 1, 2)
-   [ ] Correct any invalid Tailwind modifiers encountered during cleanup (Requirements: 3)
