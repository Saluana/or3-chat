# Theme Page Modernization Requirements

## Introduction

This document defines the requirements for modernizing the ThemePage.vue component and its underlying theme customization system. The current implementation uses a legacy `ThemeSettings` interface with direct CSS variable manipulation. The goal is to migrate to a system that works with the refined theme DSL (`defineTheme`) while preserving all existing user-facing functionality and improving architectural consistency.

### Scope

- Migrate from `ThemeSettings` → `UserThemeOverrides` (theme.ts-compatible structure)
- Preserve all existing UI controls and UX patterns in ThemePage.vue
- Remove legacy code after successful migration (useThemeSettings, theme-apply.ts, theme-settings.client.ts)
- Maintain backward compatibility for localStorage data (migration path for existing users)

### Goals

- **Architectural Consistency**: Align user customizations with the theme DSL structure
- **Maintainability**: Single source of truth for theme definitions
- **User Experience**: No regressions in functionality or usability
- **Performance**: Maintain or improve theme application performance

---

## Requirements

### 1. User Theme Overrides System

**1.1 Core Data Structure**

**User Story**: As a developer, I want user customizations to follow the theme DSL structure, so that the system is architecturally consistent.

**Acceptance Criteria**:
- WHEN the system stores user customizations, THEN it SHALL use a structure compatible with `ThemeDefinition` (colors, backgrounds, typography)
- WHEN user overrides are applied, THEN they SHALL merge with the active base theme using the same resolver logic as compiled themes
- IF a user override field is `undefined` or `null`, THEN the base theme value SHALL be used (no override)

**1.2 Light/Dark Mode Separation**

**User Story**: As a user, I want separate customization profiles for light and dark modes, so that I can optimize each mode independently.

**Acceptance Criteria**:
- WHEN a user switches between light and dark modes, THEN the system SHALL load the corresponding user override profile
- WHEN a user modifies a setting, THEN only the active mode profile SHALL be updated
- WHEN a user resets a mode, THEN only that mode's overrides SHALL be cleared

**1.3 Persistence**

**User Story**: As a user, I want my theme customizations to persist across sessions, so that I don't lose my work.

**Acceptance Criteria**:
- WHEN a user modifies any theme setting, THEN the system SHALL persist changes to localStorage within 100ms (debounced)
- WHEN the app loads, THEN user overrides SHALL be loaded from localStorage and applied before first paint if possible
- IF localStorage data is corrupted, THEN the system SHALL fall back to default overrides and log a warning

**1.4 Data Migration**

**User Story**: As an existing user with legacy ThemeSettings, I want my customizations to be automatically migrated, so that I don't lose my configuration.

**Acceptance Criteria**:
- WHEN the system detects legacy localStorage keys on first load, THEN it SHALL migrate data to the new format
- WHEN migration completes, THEN legacy keys SHALL be removed to avoid confusion
- IF migration fails for a specific setting, THEN that setting SHALL use the default value and a warning SHALL be logged

### 2. Theme Application System

**2.1 Runtime Merging**

**User Story**: As a developer, I want user overrides to merge seamlessly with base themes, so that the system is predictable.

**Acceptance Criteria**:
- WHEN user overrides are present, THEN they SHALL be merged with the active base theme using a deep merge strategy
- WHEN a user override specifies a color, THEN it SHALL override the corresponding base theme color
- WHEN a user override specifies a background layer, THEN it SHALL override the corresponding base theme layer (by key)

**2.2 CSS Variable Application**

**User Story**: As a developer, I want the merged theme to be applied to CSS variables consistently, so that UI rendering is correct.

**Acceptance Criteria**:
- WHEN the merged theme is computed, THEN all theme colors SHALL be mapped to CSS variables (--md-primary, --md-surface, etc.)
- WHEN background layers are defined, THEN the `applyThemeBackgrounds()` helper SHALL be used to apply them
- WHEN typography overrides are present, THEN font and size CSS variables SHALL be updated

**2.3 Performance**

**User Story**: As a user, I want theme changes to apply instantly, so that the UI feels responsive.

**Acceptance Criteria**:
- WHEN a user adjusts a slider control, THEN visual feedback SHALL update within 50ms (debounced)
- WHEN the merged theme is recomputed, THEN CSS variable updates SHALL batch to minimize reflows
- WHEN background images are resolved, THEN internal-file:// tokens SHALL be cached to avoid redundant blob URL creation

### 3. ThemePage.vue UI Controls

**3.1 Mode Toggle**

**User Story**: As a user, I want to toggle between light and dark modes, so that I can customize each independently.

**Acceptance Criteria**:
- WHEN I click the "Light" button, THEN the active mode SHALL switch to light and light overrides SHALL be displayed
- WHEN I click the "Dark" button, THEN the active mode SHALL switch to dark and dark overrides SHALL be displayed
- WHEN I click "Reset [mode]", THEN only the active mode's overrides SHALL be cleared

**3.2 Color Palette Overrides**

**User Story**: As a user, I want to override Material Design palette colors, so that I can customize the look and feel.

**Acceptance Criteria**:
- WHEN the "Enable palette overrides" checkbox is unchecked, THEN color pickers SHALL be disabled and base theme colors SHALL be shown
- WHEN the checkbox is checked, THEN color pickers SHALL be enabled and user-selected colors SHALL be applied
- WHEN I select a color using the picker, THEN the hex input SHALL update immediately
- WHEN I type a valid hex color, THEN the picker SHALL update to reflect it
- WHEN I click "Copy" for a color, THEN the hex value SHALL be copied to the clipboard

**3.3 Custom Background Colors Toggle**

**User Story**: As a user, I want to toggle custom background colors, so that I can control whether my color overrides apply to backgrounds.

**Acceptance Criteria**:
- WHEN the "Enable custom background color overrides" checkbox is unchecked, THEN background color pickers SHALL be disabled
- WHEN the checkbox is checked, THEN background color pickers SHALL be enabled and user colors SHALL be applied

**3.4 Typography Controls**

**User Story**: As a user, I want to adjust base font size and choose between theme fonts and system fonts.

**Acceptance Criteria**:
- WHEN I adjust the "Base Font" slider, THEN the font size SHALL update with debounced feedback (70ms)
- WHEN I check "Use system font", THEN the app SHALL use system fonts instead of theme fonts (VT323, Press Start 2P)

**3.5 Background Layer Controls (Content Layer 1, Content Layer 2, Sidebar)**

**User Story**: As a user, I want to upload and configure background images for different UI regions.

**Acceptance Criteria**:
- WHEN I click a pattern thumbnail, THEN a file picker dialog SHALL open
- WHEN I drag-and-drop an image onto a thumbnail, THEN it SHALL upload and apply
- WHEN I click a preset button, THEN the corresponding image and opacity SHALL be applied
- WHEN I click "Remove", THEN the layer SHALL be cleared and opacity set to 0
- WHEN I adjust the "Opacity" slider, THEN the layer opacity SHALL update with debounced feedback (70ms)
- WHEN I adjust the "Size" slider, THEN the background size SHALL update with debounced feedback (70ms)
- WHEN I check "Fit", THEN the size slider SHALL be disabled and `background-size: cover` SHALL be applied
- WHEN I toggle "Repeat", THEN the background-repeat property SHALL toggle between `repeat` and `no-repeat`
- WHEN I select a fallback color, THEN it SHALL be applied when customBgColorsEnabled is true

**3.6 Accessibility Controls**

**User Story**: As a user with high-contrast mode enabled, I want pattern opacity to be reduced automatically, so that text remains readable.

**Acceptance Criteria**:
- WHEN I check "Reduce pattern opacity in high contrast modes", THEN background opacities SHALL be clamped to 0.04 when high-contrast mode is detected

**3.7 Navigation Header & Footer Controls**

**User Story**: As a user, I want to control gradient visibility and background colors for the header and footer.

**Acceptance Criteria**:
- WHEN I click "Default" for a gradient, THEN the gradient SHALL be shown
- WHEN I click "Remove" for a gradient, THEN the gradient SHALL be hidden
- WHEN I select a background color, THEN it SHALL apply if customBgColorsEnabled is true

**3.8 Reset Controls**

**User Story**: As a user, I want to reset my customizations to defaults.

**Acceptance Criteria**:
- WHEN I click "Reset [mode]", THEN the active mode's overrides SHALL be cleared with confirmation
- WHEN I click "Reset All", THEN both light and dark overrides SHALL be cleared with confirmation

### 4. Image Upload & Storage

**4.1 File Upload**

**User Story**: As a user, I want to upload images for background layers, so that I can personalize the UI.

**Acceptance Criteria**:
- WHEN I upload an image, THEN it SHALL be validated (image MIME type, max 2MB)
- WHEN validation passes, THEN the image SHALL be stored using `createOrRefFile()` (content-addressed storage)
- WHEN storage succeeds, THEN an `internal-file://[hash]` token SHALL be stored in user overrides

**4.2 Image Resolution**

**User Story**: As a developer, I want internal-file:// tokens to resolve to blob URLs at runtime, so that images display correctly.

**Acceptance Criteria**:
- WHEN a background layer references an `internal-file://` token, THEN the system SHALL resolve it to a blob URL
- WHEN a blob URL is created, THEN it SHALL be cached to avoid redundant DB queries
- WHEN the component unmounts, THEN all blob URLs SHALL be revoked to prevent memory leaks

### 5. Code Cleanup

**5.1 Legacy Code Removal**

**User Story**: As a developer, I want legacy code removed after migration, so that the codebase stays maintainable.

**Acceptance Criteria**:
- WHEN the new system is complete and tested, THEN `app/core/theme/useThemeSettings.ts` SHALL be deleted
- WHEN the new system is complete and tested, THEN `app/core/theme/theme-apply.ts` SHALL be deleted
- WHEN the new system is complete and tested, THEN `app/plugins/theme-settings.client.ts` SHALL be deleted
- WHEN the new system is complete and tested, THEN `app/core/theme/theme-defaults.ts` SHALL be reviewed for removal (keep only if shared)
- WHEN the new system is complete and tested, THEN `app/core/theme/theme-types.ts` SHALL be reviewed for removal (keep only if shared)

**5.2 Test Coverage**

**User Story**: As a developer, I want comprehensive tests for the new system, so that regressions are caught early.

**Acceptance Criteria**:
- WHEN unit tests are written, THEN they SHALL cover: override merging, localStorage persistence, data migration, CSS variable application
- WHEN integration tests are written, THEN they SHALL verify: mode switching, image upload flow, reset functionality
- WHEN tests run, THEN coverage SHALL be ≥80% for new composables and helpers

---

## Non-Functional Requirements

### Performance

- Theme application SHALL complete within 100ms on average hardware
- Slider adjustments SHALL provide visual feedback within 50ms (debounced)
- Background image resolution SHALL be cached to avoid redundant DB access

### Accessibility

- All controls SHALL be keyboard-accessible with visible focus indicators
- Color pickers and sliders SHALL have ARIA labels
- Live status updates SHALL be announced to screen readers

### Browser Compatibility

- The system SHALL work on modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- LocalStorage fallback SHALL handle quota exceeded errors gracefully

### Security

- Uploaded images SHALL be validated (MIME type, size limit) to prevent abuse
- Blob URLs SHALL be scoped to the session and revoked on cleanup to prevent memory leaks
