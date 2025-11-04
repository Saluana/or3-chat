# Theming System Refactor - Requirements

## Introduction

This document defines requirements for refactoring the application's theming system to make it dramatically simpler and more accessible for end users to create custom themes. The goal is to achieve WordPress-level simplicity while maintaining the existing retro aesthetic and Material Design integration.

Currently, theming is scattered across multiple locations (app.config.ts, app/assets/css/, theme composables) making it difficult for users to understand and customize. The new system will consolidate theme files into a single `app/theme/` directory with a clear, declarative structure.

---

## Requirements

### 1. Theme Directory Structure

**1.1** Theme Folder Organization
- **User Story**: As a theme developer, I want all theme-related files in one location, so that I can easily manage and version my theme without hunting through the codebase.
- **Acceptance Criteria**:
  - WHEN the application starts THEN it SHALL look for theme files in `app/theme/` directory
  - WHEN `app/theme/` contains `light.css` and `dark.css` THEN these SHALL override default Material Design variables
  - WHEN `app/theme/` contains `main.css` THEN it SHALL be loaded after Tailwind and Nuxt UI imports
  - WHEN `app/theme/` contains `theme.ts` THEN it SHALL override default Nuxt UI component configurations from app.config.ts

**1.2** Required Theme Files
- **User Story**: As a theme developer, I want clear, minimal required files, so that I can get started quickly without understanding the entire codebase.
- **Acceptance Criteria**:
  - WHEN creating a new theme THEN `light.css` SHALL be required for light mode variables
  - WHEN creating a new theme THEN `dark.css` SHALL be required for dark mode variables
  - WHEN creating a new theme THEN `main.css` SHALL be optional for additional global styles
  - WHEN creating a new theme THEN `theme.ts` SHALL be optional for Nuxt UI component overrides
  - WHEN any required file is missing THEN the system SHALL fall back to default theme gracefully

**1.3** Theme File Contents
- **User Story**: As a theme developer, I want each file to have a single, clear purpose, so that I don't need to understand complex CSS cascades or TypeScript configurations.
- **Acceptance Criteria**:
  - WHEN editing `light.css` THEN it SHALL only contain CSS variables for light mode (--md-primary, --md-surface, etc.)
  - WHEN editing `dark.css` THEN it SHALL only contain CSS variables for dark mode
  - WHEN editing `main.css` THEN it SHALL contain utility classes, custom components, and overrides
  - WHEN editing `theme.ts` THEN it SHALL export a partial AppConfig matching app.config.ts structure
  - WHEN `theme.ts` is present THEN it SHALL deep-merge with default app.config.ts (not replace)

---

### 2. CSS Variable System

**2.1** Material Design Variables
- **User Story**: As a theme developer, I want to use simple, well-documented CSS variables, so that I can customize colors without learning the Material Design spec.
- **Acceptance Criteria**:
  - WHEN defining colors in light.css THEN at minimum `--md-primary`, `--md-secondary`, `--md-error`, `--md-surface`, `--md-on-surface` SHALL be defined
  - WHEN defining colors THEN extended color variables (--md-extended-color-success-color, etc.) MAY be defined
  - WHEN a CSS variable is undefined THEN it SHALL fall back to the default theme value
  - WHEN CSS variables are changed THEN Nuxt UI components SHALL automatically update via nuxt-ui-map.css

**2.2** Nuxt UI Token Mapping
- **User Story**: As a theme developer, I want Nuxt UI components to automatically use my theme colors, so that I don't need to manually configure every component.
- **Acceptance Criteria**:
  - WHEN Material Design variables are set THEN `nuxt-ui-map.css` SHALL map them to Nuxt UI tokens (--ui-primary, --ui-bg, etc.)
  - WHEN theme switches between light/dark THEN Nuxt UI tokens SHALL automatically update
  - WHEN high-contrast or medium-contrast modes are active THEN token mappings SHALL respect those variants
  - WHEN custom theme omits a variable THEN the default nuxt-ui-map.css mapping SHALL provide fallback

**2.3** Application-Specific Variables
- **User Story**: As a theme developer, I want to customize app-specific elements (backgrounds, patterns, gradients), so that I can fully personalize the UI.
- **Acceptance Criteria**:
  - WHEN defining app variables THEN `--app-content-bg-1`, `--app-content-bg-2`, `--app-sidebar-bg-1` SHALL control background patterns
  - WHEN defining app variables THEN `--app-header-gradient`, `--app-bottomnav-gradient` SHALL control gradient images
  - WHEN defining app variables THEN `--app-font-sans-current`, `--app-font-heading-current` SHALL control font families
  - WHEN app variables are undefined THEN defaults from main.css SHALL apply

---

### 3. Component Configuration (theme.ts)

**3.1** Partial Override System
- **User Story**: As a theme developer, I want to override only specific component styles, so that I don't need to redefine the entire config for one change.
- **Acceptance Criteria**:
  - WHEN theme.ts exports a default object THEN it SHALL be deep-merged with app.config.ts defaults
  - WHEN theme.ts defines `ui.button.variants.color` THEN it SHALL add to or override only those color variants
  - WHEN theme.ts omits a component config THEN the app.config.ts default SHALL be used
  - WHEN theme.ts is invalid or missing THEN the app SHALL load successfully with defaults
  - WHEN theme.ts is updated during development THEN HMR SHALL reload the configuration

**3.2** TypeScript Support
- **User Story**: As a theme developer, I want TypeScript autocomplete and validation, so that I catch errors before runtime.
- **Acceptance Criteria**:
  - WHEN editing theme.ts THEN it SHALL have access to AppConfig type from Nuxt
  - WHEN exporting invalid config keys THEN TypeScript SHALL show errors
  - WHEN accessing ui.button.slots THEN autocomplete SHALL suggest valid slot names
  - WHEN using defineAppConfig THEN it SHALL provide type checking and inference

**3.3** Component Targeting
- **User Story**: As a theme developer, I want examples of common component overrides, so that I can quickly customize buttons, inputs, and modals.
- **Acceptance Criteria**:
  - WHEN documentation provides examples THEN it SHALL include button, input, modal, tooltip overrides
  - WHEN examples are provided THEN they SHALL show both slot-based and variant-based customization
  - WHEN theme.ts overrides Nuxt UI components THEN changes SHALL be reflected app-wide immediately
  - WHEN invalid slot or variant names are used THEN they SHALL be ignored without breaking the app

---

### 4. Unique IDs and Classes for Targeting

**4.1** Element Identification
- **User Story**: As a theme developer, I want unique IDs on major UI elements, so that I can target specific areas with CSS without class conflicts.
- **Acceptance Criteria**:
  - WHEN the sidebar is rendered THEN it SHALL have id="app-sidebar"
  - WHEN the main content area is rendered THEN it SHALL have id="app-content"
  - WHEN the top header is rendered THEN it SHALL have id="app-header"
  - WHEN the bottom navigation (mobile) is rendered THEN it SHALL have id="app-bottom-nav"
  - WHEN chat container is rendered THEN it SHALL have id="app-chat-container"
  - WHEN dashboard modal is rendered THEN it SHALL have id="app-dashboard-modal"

**4.2** Component Classes
- **User Story**: As a theme developer, I want semantic CSS classes on repeated components, so that I can style all instances of buttons, cards, or messages consistently.
- **Acceptance Criteria**:
  - WHEN a chat message is rendered THEN it SHALL have class="app-chat-message"
  - WHEN a user message is rendered THEN it SHALL additionally have class="app-chat-message--user"
  - WHEN an assistant message is rendered THEN it SHALL additionally have class="app-chat-message--assistant"
  - WHEN a sidebar navigation item is rendered THEN it SHALL have class="app-sidebar-item"
  - WHEN a pane is rendered THEN it SHALL have class="app-pane" and data-pane-id attribute
  - WHEN these classes are applied THEN existing Tailwind classes SHALL still take precedence

**4.3** Documentation of IDs and Classes
- **User Story**: As a theme developer, I want a reference guide of all available IDs and classes, so that I know what I can target without inspecting the DOM.
- **Acceptance Criteria**:
  - WHEN documentation is created THEN it SHALL list all unique IDs with descriptions
  - WHEN documentation is created THEN it SHALL list all component classes with usage examples
  - WHEN documentation is created THEN it SHALL include before/after examples of common customizations
  - WHEN new IDs or classes are added THEN documentation SHALL be updated

---

### 5. Migration and Backward Compatibility

**5.1** Existing Theme Settings
- **User Story**: As an existing user, I want my custom theme settings preserved after the refactor, so that my app doesn't suddenly look different.
- **Acceptance Criteria**:
  - WHEN the app loads after refactor THEN existing useThemeSettings localStorage data SHALL still work
  - WHEN the app loads THEN theme settings (font size, backgrounds, palette) SHALL be applied on top of theme.ts
  - WHEN user has custom backgrounds or colors THEN they SHALL layer correctly over new CSS variable system
  - WHEN migration is complete THEN old inline styles SHALL be replaced with CSS variable references where possible

**5.2** Default Theme Extraction
- **User Story**: As a developer, I want the current default theme extracted to the new theme structure, so that I have a reference implementation.
- **Acceptance Criteria**:
  - WHEN refactor is complete THEN `app/theme/default/` SHALL contain extracted light.css, dark.css, main.css
  - WHEN refactor is complete THEN `app/theme/default/theme.ts` SHALL contain current app.config.ts UI overrides
  - WHEN new theme system is active THEN app SHALL look identical to current implementation
  - WHEN default theme files are modified THEN changes SHALL be reflected immediately

**5.3** CSS Asset Migration
- **User Story**: As a developer, I want existing CSS assets moved to the theme directory, so that everything is organized and discoverable.
- **Acceptance Criteria**:
  - WHEN migration occurs THEN `app/assets/css/light.css` SHALL move to `app/theme/default/light.css`
  - WHEN migration occurs THEN `app/assets/css/dark.css` SHALL move to `app/theme/default/dark.css`
  - WHEN migration occurs THEN `retro.css` and `prose-retro.css` SHALL move to `app/theme/default/main.css` or remain as shared utilities
  - WHEN migration occurs THEN `nuxt-ui-map.css` SHALL remain in a shared location as it bridges MD and Nuxt UI
  - WHEN migration occurs THEN import paths in main entry SHALL be updated

---

### 6. Developer Experience

**6.1** Theme Creation Workflow
- **User Story**: As a new theme developer, I want step-by-step instructions to create my first theme, so that I can get started in under 10 minutes.
- **Acceptance Criteria**:
  - WHEN documentation provides quickstart THEN it SHALL list exact files to create
  - WHEN quickstart is followed THEN a basic working theme SHALL be created in under 10 minutes
  - WHEN theme developer makes an error THEN clear error messages SHALL guide them to the fix
  - WHEN theme is created THEN a "theme preview" mode SHALL let developer see changes without affecting production

**6.2** Hot Module Replacement
- **User Story**: As a theme developer, I want instant feedback when editing theme files, so that I can iterate quickly without restarting the dev server.
- **Acceptance Criteria**:
  - WHEN editing light.css or dark.css THEN CSS SHALL hot-reload within 100ms
  - WHEN editing main.css THEN utility classes SHALL update without page refresh
  - WHEN editing theme.ts THEN Nuxt config SHALL reload and components SHALL update
  - WHEN HMR fails THEN a clear error message SHALL indicate which file and line caused the issue

**6.3** Theme Validation
- **User Story**: As a theme developer, I want automatic validation of my theme files, so that I catch common mistakes early.
- **Acceptance Criteria**:
  - WHEN theme files are loaded THEN required CSS variables SHALL be validated
  - WHEN CSS variable is missing THEN a warning SHALL appear in console with fallback value used
  - WHEN theme.ts has invalid structure THEN TypeScript SHALL show errors in IDE
  - WHEN theme.ts uses invalid Nuxt UI slot names THEN a runtime warning SHALL appear
  - WHEN validation errors exist THEN app SHALL still load with defaults (fail gracefully)

---

### 7. Performance

**7.1** Load Time
- **User Story**: As a user, I want custom themes to load instantly, so that app startup isn't slowed down.
- **Acceptance Criteria**:
  - WHEN custom theme is active THEN initial page load SHALL not increase by more than 50ms
  - WHEN theme.ts is large THEN it SHALL be code-split and lazy-loaded
  - WHEN theme CSS is large THEN critical path CSS SHALL be inlined, rest deferred
  - WHEN theme uses custom fonts THEN they SHALL be preloaded with font-display: swap

**7.2** Runtime Performance
- **User Story**: As a user, I want theme switches to be instant, so that light/dark mode toggle feels responsive.
- **Acceptance Criteria**:
  - WHEN toggling light/dark mode THEN CSS class change SHALL apply within one frame (16ms)
  - WHEN CSS variables update THEN no forced layout recalculation SHALL occur
  - WHEN theme applies THEN no component re-render storms SHALL occur
  - WHEN theme uses custom backgrounds THEN image loading SHALL not block UI thread

---

### 8. Documentation

**8.1** Theming Guide
- **User Story**: As a theme developer, I want comprehensive documentation with examples, so that I can learn advanced techniques.
- **Acceptance Criteria**:
  - WHEN theming guide exists THEN it SHALL have "Quick Start", "CSS Variables Reference", "Component Overrides", "Examples" sections
  - WHEN CSS variables are documented THEN each SHALL have description, default value, and usage example
  - WHEN component overrides are documented THEN Nuxt UI component structure SHALL be explained
  - WHEN examples are provided THEN they SHALL include "retro", "minimal", "glassmorphism" theme demos

**8.2** Migration Guide
- **User Story**: As an existing contributor, I want a migration guide, so that I can update my custom components to use the new theming system.
- **Acceptance Criteria**:
  - WHEN migration guide exists THEN it SHALL document breaking changes
  - WHEN migration guide exists THEN it SHALL provide before/after code examples
  - WHEN migration guide exists THEN it SHALL explain how to convert inline styles to CSS variables
  - WHEN migration guide exists THEN it SHALL list all deprecated patterns and their replacements

**8.3** Component Refactor Checklist
- **User Story**: As a developer, I want a checklist of components that need refactoring, so that I can track progress and contribute.
- **Acceptance Criteria**:
  - WHEN checklist exists THEN it SHALL prioritize components by impact (high = used everywhere)
  - WHEN checklist exists THEN it SHALL note which components have hardcoded colors or styles
  - WHEN checklist exists THEN it SHALL link to specific files and line numbers
  - WHEN component is refactored THEN checklist SHALL be updated

---

## Non-Functional Requirements

### Accessibility
- Theme system SHALL maintain WCAG AA contrast ratios in default themes
- Custom themes SHALL receive warnings if contrast ratios are insufficient
- High-contrast mode overrides SHALL remain available

### Browser Compatibility
- Theme system SHALL work in all browsers supporting CSS custom properties (Chrome 49+, Firefox 31+, Safari 9.1+)
- Fallbacks SHALL be provided for older browsers if application supports them

### Testing
- Unit tests SHALL validate CSS variable presence and fallback behavior
- Integration tests SHALL verify theme switching works across all routes
- Visual regression tests SHALL catch unintended style changes

---

## Success Criteria

The theming refactor is considered successful when:
1. A new user can create a basic custom theme in under 10 minutes
2. All current functionality works identically with new theme system
3. Zero performance regression in theme switching or app load time
4. Documentation receives positive feedback from 3+ external theme developers
5. At least 2 community themes are created within 1 month of release

