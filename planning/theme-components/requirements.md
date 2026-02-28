# Requirements: Theme Custom Components

## Introduction 
The OR3 Chat theme system currently allows for robust styling, color modifications, and CSS CSS variable injection. To make the entire site deeply customizable, we need to allow theme authors to override core UI components. By mapping a component key to a custom Vue file inside the theme directory, users can entirely replace core workflows, navigational structures, and visualizations while retaining the underlying data state.

## Core Objective
Enable the dynamic mapping and lazy-loading of custom Vue `.vue` components specified in a theme's `theme.ts` manifest, overriding the application's default core components comprehensively. This must be done with **Absolute Zero per-component reactivity overhead** to win on performance.

---

## 1. Feature Requirements

### 1.1 Custom Component Manifest & Strict Typing
- **As a** theme author, 
- **I want** strict TypeScript autocompletion when declaring a `customComponents` dictionary in my `theme.ts`
- **so that** I know exactly which keys I am allowed to override without looking up documentation.
- **Acceptance Criteria**:
  - `ThemeDefinition` and `CompiledTheme` types must accept a `customComponents: Partial<Record<AppThemeComponent, string>>` property.
  - Paths provided must be correctly resolved relative to the theme's root directory (e.g., `./components/MySidebar.vue`).

### 1.2 Overridable Component Registry
- **As a** system architect,
- **I want** to track a specific set of highly visible "core" application components whose overrides are supported out-of-the-box.
- **so that** users know exactly which keys they can hook into.
- **Acceptance Criteria**:
  - The system SHALL define `AppThemeComponent` with the following strict values:
    - `'sidebar'`: The expanded desktop side navigation.
    - `'sidebar-collapsed'`: The shrunken side navigation for mobile/compact views.
    - `'chat-page'`: The top-level threaded chat orchestration container.
    - `'chat-message'`: The individual message rendering block.
    - `'chat-input'`: The chat input dropper/composer text area.
    - `'document-editor'`: The document text editor pane.
    - `'dashboard-modal'`: The application dashboard/settings modal.
    - `'model-selector'`: The primary model selection dropdown element.
    - `'system-prompts-modal'`: The system prompts modal content (`SystemPromptsModal.vue`).
    - `'model-catalog-modal'`: The model catalog selection modal content (`ModelCatalog.vue`).
    - `'sidebar-auth-button'`: The profile/auth section of the sidebar (`SidebarAuthButton.vue`).
    - `'documentation-shell'`: The layout wrapper for all doc pages (`DocumentationShell.vue`).
    - `'workflow-status'`: The visualizer for agentic task trees (`WorkflowExecutionStatus.vue`).

### 1.3 Safe Dynamic Import mechanism & SSR Support
- **As a** frontend client,
- **I want** custom component modules to be picked up by Vite at build time via dynamic imports
- **so that** I don't download unneeded `.vue` code for inactive themes, while maintaining SSR render safety.
- **Acceptance Criteria**:
  - `import.meta.glob('../**/*.vue')` MUST be utilized in a shared manifestation registry without `eager: true`.
  - The fallback default components MUST be used immediately if a theme lacks an override or provides a broken path.

### 1.4 Global $O(1)$ Component Swapping (Performance Winning Move)
- **As a** Vue application rendering hundreds of chat messages,
- **I want** the dynamic components to be evaluated ONCE globally per theme-switch, rather than calculating per-instance
- **so that** arrays like `ChatMessage` arrays don't exponentially increase memory usage with Vue `computed()` or watchers.
- **Acceptance Criteria**:
  - The theme store SHALL maintain a single `ShallowRef<Record<AppThemeComponent, Component>>`.
  - Components consuming these overrides SHALL extract them directly from the `ShallowRef` without introducing intermediary local state.
  - Changing themes swaps the entire map simultaneously.

---

## 2. Non-Functional Requirements

### 2.1 Performance (The #1 Priority)
- **Requirement:** Resolution of an overridden component must be $O(1)$ map lookup. We strictly forbid the use of local `computed(() => ...)` wrappers for repetitive components like `ChatMessage`.

### 2.2 Developer Experience (DX)
- **Requirement:** By defining `type AppThemeComponent`, the authoring experience is fortified by IDE intellisense in `theme.ts`.
