artifact_id: b71a52de-ff34-4c53-98a7-8e3711d8e0a2
content_type: text/markdown

# requirements.md

## Introduction

The sidebar and main content regions currently ship with hard-coded retro background textures. This plan relocates those visuals into the refined theme system so each theme owns its imagery. The first milestone focuses on moving existing textures into the `retro` theme and allowing future themes to opt into their own backgrounds without bloating runtime logic.

## Requirements

### 1. Theme-driven background layers

**User Story**: As a theme user, I want the active theme to control sidebar and content textures so the visual treatment changes whenever I switch themes.

**Acceptance Criteria**:

-   WHEN `setActiveTheme()` resolves for any compiled theme THEN the system SHALL update `--app-content-bg-1`, `--app-content-bg-2`, `--app-sidebar-bg-1`, header gradient, and bottom-nav gradient CSS variables to the theme-provided values before the next animation frame.
-   WHEN a theme omits a background entry THEN the system SHALL fall back to neutral values (`none` image, current surface color) without leaving stale URLs from the previous theme.
-   WHEN themes are switched repeatedly within a session THEN the system SHALL avoid reallocating duplicate object URLs for identical assets (reuse cache where possible).

### 2. Retro theme owns existing background assets

**User Story**: As the retro theme maintainer, I want the current textures defined inside `app/theme/retro/theme.ts` so no other theme inherits retro-specific styling by default.

**Acceptance Criteria**:

-   WHEN the application loads without an active theme override THEN base CSS files SHALL not reference `/bg-repeat.webp`, `/bg-repeat-2.webp`, `/sidebar-repeater.webp`, or `/gradient-x.webp` directly.
-   WHEN the `retro` theme is active THEN rendered backgrounds SHALL match the current visuals (identical URL, repeat, opacity, and size parameters).
-   IF the `retro` theme file is removed or replaced THEN the global stylesheet SHALL continue to render with neutral backgrounds (e.g., solid surface colors) rather than broken URLs.

### 3. Theme settings remain compatible

**User Story**: As an operator who tweaks background textures via the dashboard settings, I want theme-provided defaults to seed the experience while my overrides still win.

**Acceptance Criteria**:

-   WHEN theme settings apply user-selected textures (`ThemeSettings.contentBg*` or `sidebarBg`) THEN those overrides SHALL layer on top of the theme defaults without double-applying transformation logic.
-   WHEN no user override exists THEN the theme-provided values SHALL be visible in the dashboard UI as the baseline preview.
-   IF `reducePatternsInHighContrast` is enabled THEN the opacity clamp SHALL continue to operate against whichever background source (theme or user override) is active.
