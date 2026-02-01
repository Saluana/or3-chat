---
artifact_id: 8a3ef7f7-3b19-4e40-9dd1-4b6b4f0c6b9f
status: draft
owner: or3-chat
last_updated: 2026-02-01
---

# requirements.md

## Introduction
This plan addresses the issues documented in this folder (theme defaults ambiguity, client/server duplication, unsafe parsing/validation, race conditions, memory leaks/unbounded caches, and type safety gaps) while preserving OR3’s local-first, Nuxt SSR/static boundaries, and existing theme/plugin architecture.

Goals:
- Make default theme behavior predictable and debuggable.
- Remove duplicated client/server theme logic to avoid divergence.
- Eliminate known memory leaks and unbounded caches in hot paths.
- Hardening: safer cookie parsing, safer name/color validation, and safer DOM injection.
- Improve maintainability: shared types/constants, consistent error handling.

Non-goals:
- Redesigning the visual look of themes.
- Changing Nuxt UI variants or introducing a new styling system.

## Requirements

### 1. Default Theme Selection Is Predictable
**1.1 Default selection precedence**
- User Story: As a developer/operator, I want a single, documented precedence order for picking the default theme, so that deployments behave predictably.
- Acceptance Criteria:
  - WHEN the app starts THEN the system SHALL compute a default theme using a documented precedence order.
  - IF `runtimeConfig.public.branding.defaultTheme` is set and valid THEN the system SHALL use it.
  - IF `runtimeConfig.public.branding.defaultTheme` is missing/invalid THEN the system SHALL fall back to the manifest default (`isDefault`).
  - IF no theme is marked `isDefault` THEN the system SHALL fall back to the first manifest entry.
  - IF the manifest is empty THEN the system SHALL use a single constant fallback theme name.

**1.2 Visibility when overrides occur**
- User Story: As a developer, I want dev-mode diagnostics when runtime config overrides manifest defaults, so that confusion is avoided.
- Acceptance Criteria:
  - WHEN in dev mode AND runtime config overrides the manifest default THEN the system SHALL log a single warning describing both values.
  - WHEN in production THEN the system SHALL NOT spam logs for expected configurations.

### 2. Theme Loading Logic Is Shared Between Client and Server
**2.1 Shared loader module**
- User Story: As a maintainer, I want client/server plugins to delegate to shared theme loading utilities, so that behavior stays consistent.
- Acceptance Criteria:
  - WHEN updating theme loading behavior THEN changes SHALL be made in one shared module used by both plugins.
  - IF a shared `loadTheme` exists THEN both plugins SHALL use it (no dead code).

**2.2 SSR/static boundary safety**
- User Story: As a maintainer, I want shared theme code to be safe for SSR and static builds, so that builds don’t regress.
- Acceptance Criteria:
  - WHEN executing on the server THEN shared code SHALL not access `document`/`window`.
  - WHEN executing on the client THEN DOM operations SHALL be guarded and fail gracefully.

### 3. Theme Name and Cookie Handling Are Safe and Correct
**3.1 Theme name normalization**
- User Story: As a developer, I want theme name validation to be consistent with manifest storage, so that valid themes load reliably.
- Acceptance Criteria:
  - WHEN a theme name is provided THEN the system SHALL normalize it to lowercase before lookup.
  - IF the normalized name is not in the available themes set THEN the system SHALL reject it.
  - IF the name does not match a strict pattern (starts with a letter, then `[a-z0-9-]*`) THEN the system SHALL reject it.

**3.2 Cookie parsing safety**
- User Story: As a maintainer, I want cookie reads to be robust and consistent, so that theme persistence is reliable.
- Acceptance Criteria:
  - WHEN reading cookies THEN the system SHALL not build unescaped dynamic RegExp patterns.
  - WHEN reading theme-related cookies THEN both client and server paths SHALL use the same shared cookie parsing utility.

### 4. Theme Activation Is Robust Under Failure
**4.1 No unhandled rejections**
- User Story: As a user, I want theme switching to never crash the app, so that UI remains usable.
- Acceptance Criteria:
  - WHEN loading a requested theme fails THEN the system SHALL fall back to a safe theme.
  - IF fallback loading also fails THEN the system SHALL return a failure result (boolean or structured) and keep the previous theme.
  - THEN the system SHALL not produce unhandled promise rejections.

**4.2 Consistent error handling**
- User Story: As a maintainer, I want theme manifest loading to surface aggregated failures in dev mode, so that missing themes are diagnosable.
- Acceptance Criteria:
  - WHEN some theme modules fail to load THEN the manifest loader SHALL return valid entries and an error list.
  - WHEN all theme modules fail THEN the system SHALL log a single aggregated error (dev) and activate a safe fallback theme.

### 5. DOM/CSS Injection and Stylesheet Loading Are Safe
**5.1 CSS variable injection guarded**
- User Story: As a maintainer, I want CSS variable injection to be defensive, so that tests and edge environments don’t crash.
- Acceptance Criteria:
  - WHEN injecting theme CSS THEN the system SHALL guard against missing `document.head`.
  - WHEN injection fails THEN the system SHALL handle the error and keep the app running.

**5.2 Stylesheet deduplication**
- User Story: As a user, I want rapid theme switching not to create duplicate stylesheets or extra network requests.
- Acceptance Criteria:
  - WHEN multiple concurrent loads request the same theme stylesheet THEN the system SHALL dedupe using an in-flight promise cache.
  - WHEN a stylesheet link already exists THEN the system SHALL not append a duplicate.

### 6. Memory Usage Remains Bounded Over Long Sessions
**6.1 useThemeOverrides cache bounded**
- User Story: As a user, I want long-running sessions to stay responsive, so that memory doesn’t grow without bound.
- Acceptance Criteria:
  - WHEN resolving overrides per-component THEN the per-component cache SHALL have a maximum size and evict old entries.
  - WHEN the active theme changes THEN the cache SHALL reset for that component.

**6.2 Hook registration cleanup**
- User Story: As a developer, I want HMR/navigation hooks not to leak across reloads, so that dev sessions remain stable.
- Acceptance Criteria:
  - WHEN registering a Nuxt hook THEN the system SHALL unregister it during cleanup.
  - WHEN cleanup runs THEN any pending timeouts SHALL be cleared.

**6.3 Icon registry cleanup**
- User Story: As a user, I want switching themes not to accumulate unused icon maps.
- Acceptance Criteria:
  - WHEN themes are unloaded THEN the icon registry SHALL drop the corresponding theme icons.
  - WHEN switching themes on SSR servers THEN inactive themes SHALL be cleaned up similarly to the client.

**6.4 Cache policies documented**
- User Story: As a maintainer, I want cache growth decisions to be explicit, so that “unbounded” caches are intentional.
- Acceptance Criteria:
  - IF a cache remains unbounded (e.g., finite token set) THEN the code SHALL document why it’s safe.
  - IF a cache can grow with runtime identifiers/selectors THEN it SHALL be bounded (LRU or capped).

### 7. Type Safety and Code Organization Improve Without Breaking API
**7.1 RuntimeResolver typing**
- User Story: As a developer, I want resolved override props to be typed correctly, so that consumers don’t rely on `unknown`.
- Acceptance Criteria:
  - WHEN `RuntimeResolver.resolve()` returns props THEN TypeScript types SHALL include known fields and debug fields (optional).

**7.2 Shared constants/types location**
- User Story: As a maintainer, I want theme constants and plugin types in shared modules, so that imports are stable.
- Acceptance Criteria:
  - THEN the fallback theme name SHALL be defined in a single shared constants module.
  - THEN `ThemePlugin` type SHALL live in a shared theme types module (not inside a plugin file).

### 8. Validation Uses Correct Mechanisms Where Available
**8.1 Color validation correctness**
- User Story: As a theme author, I want color validation to accept valid CSS and reject invalid CSS.
- Acceptance Criteria:
  - WHEN `CSS.supports('color', value)` is available THEN validation SHALL use it.
  - WHEN it is unavailable THEN the system SHALL use stricter, well-scoped regex patterns (not overly permissive ones).
