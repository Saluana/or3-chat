# Requirements

## Introduction

This plan covers later migrations for interface density, focus-ring thickness,
motion preference, and elevation styling in Theme Studio. The goal is to make
each control truthful: changing it must affect the application broadly and
predictably before it is exposed to users.

## Context

OR3 Chat is a Nuxt/Vue TypeScript application managed with Bun and tested with
Vitest and Playwright. Themes compile authored values into CSS custom
properties, while `useUserThemeOverrides` persists light/dark customization and
`applyMergedTheme` applies it at runtime. Border widths and radii are already
tiered, but control heights and gaps, focus rings, transition durations, and
shadows are still distributed across Tailwind classes, component CSS, Nuxt UI
configuration, and theme-specific overrides; therefore adding editor controls
before migrating consumers would recreate the earlier partial-effect problem.

## Assumptions

- Density and elevation are aesthetic choices and may differ between light and
  dark customization profiles.
- Focus visibility and motion reduction are accessibility preferences and must
  not change when the user switches color mode.
- Existing themes must render identically when new tokens and overrides are
  absent.
- The mobile/coarse-pointer minimum interactive target remains 44px regardless
  of the selected desktop density.
- The first migration targets first-party application and shipped-theme code;
  third-party plugin markup may adopt the tokens later through the public theme
  contract.

## Out of Scope

- Arbitrary per-component spacing, shadow, duration, or focus controls.
- User-authored CSS values or unvalidated free-form token input.
- Changing sidebar width, document canvas width, icon size, z-index, or content
  layout.
- Replacing Nuxt UI, Tailwind, or the existing theme resolver.
- Synchronizing these preferences to an account or cloud service.

## Requirements

### R1: Backward-compatible token contract

**User Story:** As a theme author, I want new shared tokens to inherit existing
theme behavior, so that installed themes do not change merely because the
application gained more customization controls.

**Acceptance Criteria:**
- R1.AC1: WHEN a theme omits every new token THEN the application SHALL render
  density, focus, motion, and elevation using the pre-migration values.
- R1.AC2: WHEN a shipped theme is compiled THEN the compiler SHALL emit every
  explicitly authored new token and SHALL retain documented fallbacks for
  omitted tokens.
- R1.AC3: IF a persisted override contains an unknown enum or an out-of-range
  number THEN the override boundary SHALL reject that value and SHALL use the
  active theme or accessibility default.

### R2: Interface density presets

**User Story:** As a user, I want a small set of density presets, so that I can
make controls more compact or spacious without individually editing dimensions.

**Acceptance Criteria:**
- R2.AC1: WHEN density is set to Theme default, Compact, Comfortable, or
  Spacious THEN the system SHALL apply the corresponding shared control-height,
  internal-gap, and section-gap tiers.
- R2.AC2: WHILE the viewport uses a coarse pointer or is below the established
  mobile breakpoint, interactive targets SHALL remain at least 44px in both
  dimensions regardless of density.
- R2.AC3: WHEN density changes THEN buttons, text inputs, selects, menus,
  navigation rows, toolbars, and Theme Studio controls migrated in this plan
  SHALL update without a reload.
- R2.AC4: WHEN density is not overridden THEN each theme SHALL retain its
  authored component sizing.

### R3: Focus-ring thickness

**User Story:** As a keyboard user, I want a clearly visible focus indicator,
so that I can locate the active control across every theme.

**Acceptance Criteria:**
- R3.AC1: WHEN focus-ring thickness is changed THEN migrated interactive
  controls SHALL use one shared thickness token between 1px and 4px.
- R3.AC2: WHEN a control receives `:focus-visible` THEN its indicator SHALL use
  the shared thickness and SHALL use a theme-authored focus color with visible
  contrast against the adjacent surface.
- R3.AC3: IF a stored focus-ring value is below 1px or above 4px THEN the system
  SHALL clamp it to the nearest valid bound.
- R3.AC4: WHILE the color mode changes, the selected focus-ring thickness SHALL
  remain unchanged.

### R4: Motion preference

**User Story:** As a motion-sensitive user, I want a global motion preference,
so that interface animation respects my comfort without depending on theme or
color mode.

**Acceptance Criteria:**
- R4.AC1: WHEN motion is System THEN the application SHALL use normal authored
  durations unless `prefers-reduced-motion: reduce` is active, in which case it
  SHALL use the Reduced duration tier.
- R4.AC2: WHEN motion is Reduced THEN migrated decorative animations SHALL stop
  and migrated state transitions SHALL complete within 120ms.
- R4.AC3: WHEN motion is Reduced THEN functional progress indicators SHALL
  remain understandable through a still visual state or textual status even
  when their decorative animation is stopped.
- R4.AC4: WHILE the color mode or base theme changes, the selected motion
  preference SHALL remain unchanged.

### R5: Elevation presets

**User Story:** As a user, I want a small set of elevation styles, so that I can
choose a flat or dimensional interface without editing individual shadows.

**Acceptance Criteria:**
- R5.AC1: WHEN elevation is set to Theme default, Flat, Subtle, or Expressive
  THEN migrated components SHALL use the corresponding low, medium, and high
  elevation tokens.
- R5.AC2: WHEN Flat is active THEN migrated shadows SHALL be `none` and borders
  SHALL continue to provide required component boundaries.
- R5.AC3: WHEN a light or dark elevation override is disabled THEN the active
  theme's authored elevation SHALL be restored without losing the saved value.
- R5.AC4: WHEN elevation changes THEN dialogs, popovers, menus, cards, floating
  toolbars, and raised buttons migrated in this plan SHALL update without a
  reload.

### R6: Honest Theme Studio controls

**User Story:** As a user, I want Theme Studio controls to affect the whole
application consistently, so that I can trust what each setting means.

**Acceptance Criteria:**
- R6.AC1: WHEN fewer than 90% of identified first-party consumers for a token
  family have migrated THEN Theme Studio SHALL NOT expose that family.
- R6.AC2: WHEN a token family reaches the migration threshold THEN Theme Studio
  SHALL expose one preset or constrained control with explanatory copy and a
  Theme default option.
- R6.AC3: WHEN a user disables an aesthetic override THEN Theme Studio SHALL
  retain its saved value and SHALL restore the active theme's authored value.
- R6.AC4: WHEN focus or motion is changed THEN the setting SHALL be presented
  under Accessibility and SHALL state that it applies across light and dark
  modes.

### R7: Verification and documentation

**User Story:** As a maintainer, I want measurable migration coverage and tests,
so that new components do not silently return to hardcoded styling.

**Acceptance Criteria:**
- R7.AC1: WHEN the migration is complete THEN a repository audit SHALL report
  each remaining hardcoded density, focus, motion, and elevation value with an
  explicit exemption or follow-up owner.
- R7.AC2: WHEN a token or persisted field is added THEN unit tests SHALL cover
  validation, application, fallback, reset, and legacy saved-data behavior.
- R7.AC3: WHEN Theme Studio exposes a migrated family THEN Playwright coverage
  SHALL verify its visible effect in Blank, Retro, and Cyberpunk in light and
  dark modes at desktop and mobile widths.
- R7.AC4: WHEN the public theme contract changes THEN `app/theme/README.md` and
  `public/_documentation/themes/` SHALL document token names, fallbacks, allowed
  override values, and adoption guidance.
