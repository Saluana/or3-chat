# Theming System Refactor - Implementation Tasks

This document breaks down the theming system refactor into actionable tasks organized by phase. Each task maps to specific requirements from `requirements.md` and design elements from `design.md`.

---

## Phase 1: Setup & Default Theme Extraction

**Timeline**: Week 1  
**Requirements**: 1.1, 1.2, 5.2, 5.3

### 1. Directory Structure Setup
- [x] 1.1 Create `app/theme/` directory
- [x] 1.2 Create `app/theme/default/` subdirectory
- [x] 1.3 Create `app/theme/_shared/` subdirectory for utilities
- [x] 1.4 Add `.gitkeep` or README.md in each directory
- **Requirements**: 1.1

### 2. Migrate CSS Files to Theme Directory
- [x] 2.1 Move `app/assets/css/light.css` → `app/theme/default/light.css`
- [x] 2.2 Move `app/assets/css/dark.css` → `app/theme/default/dark.css`
- [x] 2.3 Move `app/assets/css/light-hc.css` → `app/theme/default/light-hc.css`
- [x] 2.4 Move `app/assets/css/dark-hc.css` → `app/theme/default/dark-hc.css`
- [x] 2.5 Move `app/assets/css/light-mc.css` → `app/theme/default/light-mc.css`
- [x] 2.6 Move `app/assets/css/dark-mc.css` → `app/theme/default/dark-mc.css`
- [x] 2.7 Keep `nuxt-ui-map.css` in `app/theme/_shared/` (shared across themes)
- **Requirements**: 5.3

### 3. Create Theme Main Stylesheet
- [x] 3.1 Merge `app/assets/css/retro.css` into `app/theme/default/main.css`
- [x] 3.2 Merge `app/assets/css/prose-retro.css` into `app/theme/default/main.css`
- [x] 3.3 Add comments to separate sections (retro utilities, prose, custom)
- [x] 3.4 Test that all utility classes still work
- **Requirements**: 1.3, 5.3

### 4. Update Import Paths in main.css
- [x] 4.1 Update `@import` statements in `app/assets/css/main.css` to reference `~/theme/default/` and `~/theme/_shared/`
- [x] 4.2 Add `@source` directive for `theme.ts` if needed by Tailwind
- [x] 4.3 Verify import order: Tailwind → Nuxt UI → Theme Vars → UI Map → Theme Utils
- [x] 4.4 Test dev server starts without errors
- **Requirements**: 5.3

### 5. Extract Nuxt UI Config to theme.ts
- [x] 5.1 Create `app/theme/default/theme.ts` file
- [x] 5.2 Copy `ui` object from `app.config.ts` to `theme.ts`
- [x] 5.3 Wrap in `defineAppConfig()` export
- [x] 5.4 Remove `ui` object from root `app.config.ts` (keep other settings)
- [x] 5.5 Test that buttons, modals, etc. still render correctly
- **Requirements**: 1.3, 3.1, 5.2

### 6. Create Theme Loader Infrastructure
- [x] 6.1 Create `app/theme/_shared/theme-loader.ts`
- [x] 6.2 Implement `ThemeManifest` interface
- [x] 6.3 Implement `discoverThemes()` function (scans app/theme directory)
- [x] 6.4 Implement `loadTheme(name)` function (loads CSS and config files)
- [x] 6.5 Implement `validateThemeVariables()` function (checks required CSS vars)
- [x] 6.6 Add error/warning types and logging
- **Requirements**: 1.1, 1.2, 6.3

### 7. Create Config Merger Utility
- [x] 7.1 Create `app/theme/_shared/config-merger.ts`
- [x] 7.2 Implement `mergeThemeConfig()` function using `defu`
- [x] 7.3 Add TypeScript types for safe merging
- [x] 7.4 Test deep merge behavior (objects merge, arrays replace)
- **Requirements**: 3.1

### 8. Unit Tests for Theme Infrastructure
- [x] 8.1 Create `app/theme/_shared/__tests__/theme-loader.test.ts`
- [x] 8.2 Test `discoverThemes()` finds default theme
- [x] 8.3 Test `loadTheme()` loads valid theme without errors
- [x] 8.4 Test `loadTheme()` handles missing files gracefully
- [x] 8.5 Test `validateThemeVariables()` detects missing CSS variables
- [x] 8.6 Create `app/theme/_shared/__tests__/config-merger.test.ts`
- [x] 8.7 Test deep merge preserves base config
- [x] 8.8 Test override config takes precedence
- [x] 8.9 Test nested objects merge correctly
- [x] 8.10 Test arrays are replaced (not merged)
- **Requirements**: Testing requirements

### 9. Verify No Visual Regression
- [x] 9.1 Take screenshots of app before refactor (light & dark mode)
- [x] 9.2 Take screenshots of app after refactor
- [x] 9.3 Compare screenshots pixel-by-pixel (use Percy, Chromatic, or manual)
- [x] 9.4 Fix any visual differences
- [x] 9.5 Verify all pages load without CSS errors
- **Requirements**: 5.2

---

## Phase 2: Component ID & Class Additions

**Timeline**: Week 2  
**Requirements**: 4.1, 4.2, 4.3

### 10. Add Unique IDs to Singleton Components
- [x] 10.1 Add `id="app-sidebar"` to sidebar in `ResizableSidebarLayout.vue` (`<aside>` element)
- [x] 10.2 Add `id="app-content"` to main content area in `ResizableSidebarLayout.vue` (`<main>` element)
- [x] 10.3 Add `id="app-header"` to header in `SidebarHeader.vue`
- [x] 10.4 Add `id="app-bottom-nav"` to bottom nav in `SideBottomNav.vue`
- [x] 10.5 Add `id="app-chat-container"` to chat container in `ChatContainer.vue` (`<main>` element)
- [x] 10.6 Add `id="app-dashboard-modal"` to dashboard modal in `Dashboard.vue`
- **Requirements**: 4.1

### 11. Add Component Classes to Chat Messages
- [x] 11.1 Add `app-chat-message` class to root element in `ChatMessage.vue`
- [x] 11.2 Add `app-chat-message--user` class when `role === 'user'`
- [x] 11.3 Add `app-chat-message--assistant` class when `role === 'assistant'`
- [x] 11.4 Add `data-message-role` attribute with role value
- [x] 11.5 Test classes don't conflict with existing Tailwind classes
- **Requirements**: 4.2

### 12. Add Classes to Sidebar Components
- [x] 12.1 Add `app-sidebar-item` class to thread list items in `ThreadListItem.vue`
- [x] 12.2 Add `app-sidebar-item--active` class when thread is selected
- [x] 12.3 Add `app-prompt-item` class to prompt items in `PromptsList.vue`
- [x] 12.4 Add `app-document-item` class to document items in `DocumentsList.vue`
- [x] 12.5 Test hover/active states still work
- **Requirements**: 4.2

### 13. Add Classes to Other Components
- [x] 13.1 Add `app-pane` class and `data-pane-id` attribute to panes in `PageShell.vue`
- [x] 13.2 Add `app-model-card` class to model cards in `ModelCatalog.vue`
- [x] 13.3 Add `app-theme-section` class to theme sections in `ThemePage.vue`
- [x] 13.4 Verify classes are applied in DOM (use browser DevTools)
- **Requirements**: 4.2

### 14. Document IDs and Classes
- [x] 14.1 Create `docs/UI/component-ids-classes.md`
- [x] 14.2 List all unique IDs with descriptions and file locations
- [x] 14.3 List all component classes with usage examples
- [x] 14.4 Add before/after CSS examples for common customizations
- [x] 14.5 Include section on best practices (don't override Tailwind, use specificity wisely)
- **Requirements**: 4.3

### 15. Integration Tests for IDs and Classes
- [x] 15.1 Create `tests/integration/component-targeting.test.ts`
- [x] 15.2 Test all expected IDs present in DOM after mount
- [x] 15.3 Test component classes applied correctly (user messages vs assistant messages)
- [x] 15.4 Test `data-*` attributes set properly
- [x] 15.5 Test classes don't conflict with Tailwind (specificity issues)
- **Requirements**: Testing requirements

---

## Phase 3: Theme Plugin Enhancement

**Timeline**: Week 3  
**Requirements**: 3.1, 6.1, 6.2, 6.3

### 16. Enhance Theme Plugin with Multi-Theme Support
- [x] 16.1 Modify `app/plugins/theme.client.ts` to add `activeTheme` ref
- [x] 16.2 Read `activeTheme` from localStorage on init (default: 'default')
- [x] 16.3 Call `discoverThemes()` to get list of available themes
- [x] 16.4 Expose `availableThemes` on `$theme` provider
- **Requirements**: 6.1

### 17. Implement Theme Switching API
- [x] 17.1 Implement `switchTheme(themeName)` function in theme plugin
- [x] 17.2 Validate theme exists before switching
- [x] 17.3 Update `activeTheme` ref and localStorage
- [x] 17.4 For now, log message to reload page (dynamic injection is future enhancement)
- [x] 17.5 Implement `reloadTheme()` helper that reloads current theme
- [x] 17.6 Expose both functions on `$theme` provider
- **Requirements**: 6.1

### 18. Add Theme Validation and Error Handling
- [x] 18.1 Call `validateThemeVariables()` when loading theme
- [x] 18.2 Log warnings for missing CSS variables
- [x] 18.3 Fall back to default theme if critical errors occur
- [x] 18.4 Expose theme errors/warnings on `$theme.errors` and `$theme.warnings`
- [x] 18.5 Test error scenarios (missing files, invalid CSS)
- **Requirements**: 6.3

### 19. TypeScript Declarations for Theme API
- [x] 19.1 Update `types/global.d.ts` or create `types/theme.d.ts`
- [x] 19.2 Declare `$theme` with new methods: `switchTheme`, `reloadTheme`, `activeTheme`, `availableThemes`
- [x] 19.3 Add JSDoc comments for IDE autocomplete
- [x] 19.4 Verify autocomplete works in components using `useNuxtApp().$theme`
- **Requirements**: 3.2

### 20. Theme Plugin Tests
- [x] 20.1 Create `app/plugins/__tests__/theme-provider.test.ts`
- [x] 20.2 Test theme mode switching (light/dark/variants)
- [x] 20.3 Test localStorage persistence
- [x] 20.4 Test `switchTheme()` updates `activeTheme` ref
- [x] 20.5 Test invalid theme name falls back gracefully
- [x] 20.6 Test system preference detection
- **Requirements**: Testing requirements

### 21. Optional: Theme Switcher UI in Dashboard
- [x] 21.1 Create `ThemeSelector.vue` component (dropdown or card list)
- [x] 21.2 Fetch `$theme.availableThemes` and display options
- [x] 21.3 Call `$theme.switchTheme(name)` on selection
- [x] 21.4 Show current theme as selected
- [x] 21.5 Add to Dashboard as a new plugin page or section
- **Requirements**: 6.1 (optional for phase 3, can defer)

---

## Phase 4: Documentation & Examples

**Timeline**: Week 4  
**Requirements**: 8.1, 8.2, 8.3

### 22. Write Theming Quick Start Guide
- [ ] 22.1 Create `docs/UI/theming-quickstart.md`
- [ ] 22.2 Section: "Creating Your First Theme" (step-by-step, <10 min)
- [ ] 22.3 Section: "Required Files" (light.css, dark.css, what goes in each)
- [ ] 22.4 Section: "Optional Files" (main.css for utilities, theme.ts for component overrides)
- [ ] 22.5 Section: "Activating Your Theme" (how to test locally)
- [ ] 22.6 Add code snippets and screenshots
- **Requirements**: 8.1, 6.1

### 23. Document CSS Variables Reference
- [ ] 23.1 Create `docs/UI/css-variables-reference.md`
- [ ] 23.2 Table of Material Design core variables (--md-primary, etc.) with descriptions
- [ ] 23.3 Table of application-specific variables (--app-content-bg-1, etc.)
- [ ] 23.4 Table of Nuxt UI token variables (auto-generated, read-only)
- [ ] 23.5 Add usage examples for each variable
- [ ] 23.6 Include light and dark mode default values
- **Requirements**: 8.1, 2.1, 2.3

### 24. Document Component Override System
- [ ] 24.1 Create `docs/UI/component-overrides.md`
- [ ] 24.2 Explain `theme.ts` file structure and purpose
- [ ] 24.3 Show how to override button, input, modal, tooltip with examples
- [ ] 24.4 Explain slot-based vs variant-based customization
- [ ] 24.5 Link to Nuxt UI component docs for full API
- [ ] 24.6 Add troubleshooting section (common errors)
- **Requirements**: 8.1, 3.3

### 25. Create Example Themes
- [ ] 25.1 Create `app/theme/minimal/` theme (black/white, no patterns)
  - [ ] 25.1.1 Write `light.css` (white background, black text)
  - [ ] 25.1.2 Write `dark.css` (black background, white text)
  - [ ] 25.1.3 Write `main.css` (remove patterns, sharp borders)
  - [ ] 25.1.4 Write `theme.ts` (disable transitions)
  - [ ] 25.1.5 Add README.md describing theme
- [ ] 25.2 Create `app/theme/cyberpunk/` theme (neon colors, glow effects)
  - [ ] 25.2.1 Write `light.css` (bright neon accent)
  - [ ] 25.2.2 Write `dark.css` (neon on dark background)
  - [ ] 25.2.3 Write `main.css` (glow box-shadows, futuristic fonts)
  - [ ] 25.2.4 Add README.md
- [ ] 25.3 Create `app/theme/nature/` theme (green/brown, organic)
  - [ ] 25.3.1 Write `light.css` (soft greens, beige)
  - [ ] 25.3.2 Write `dark.css` (dark greens, browns)
  - [ ] 25.3.3 Write `main.css` (rounded corners, leaf patterns)
  - [ ] 25.3.4 Add README.md
- [ ] 25.4 Test all example themes load without errors
- **Requirements**: 8.1

### 26. Write Migration Guide for Contributors
- [ ] 26.1 Create `docs/migration-guides/theming-refactor.md`
- [ ] 26.2 Section: "What Changed" (high-level summary)
- [ ] 26.3 Section: "Breaking Changes" (if any)
- [ ] 26.4 Section: "Migrating Custom Components" (before/after examples)
- [ ] 26.5 Section: "Converting Inline Styles to CSS Variables"
- [ ] 26.6 Section: "Deprecated Patterns" (list old patterns and replacements)
- [ ] 26.7 Add FAQ section
- **Requirements**: 8.2

### 27. Create Theming Video Walkthrough (Optional)
- [ ] 27.1 Record 5-10 minute video creating a simple theme from scratch
- [ ] 27.2 Show file creation, editing CSS variables, testing in browser
- [ ] 27.3 Demonstrate hot-reload during development
- [ ] 27.4 Upload to YouTube or embed in docs
- [ ] 27.5 Link from theming-quickstart.md
- **Requirements**: 6.1 (nice-to-have)

---

## Phase 5: Component Refactoring (Ongoing)

**Timeline**: Ongoing (after Phase 4)  
**Requirements**: 8.3, various

### 28. Audit Components for Hardcoded Styles
- [ ] 28.1 Run `grep -r "bg-\[" app/components/` to find hardcoded background colors
- [ ] 28.2 Run `grep -r "text-\[" app/components/` to find hardcoded text colors
- [ ] 28.3 Run `grep -r "border-\[" app/components/` to find hardcoded border colors
- [ ] 28.4 Create tracking issue with list of files/lines needing refactor
- [ ] 28.5 Prioritize by usage frequency (high = used everywhere)
- **Requirements**: 8.3

### 29. Refactor High Priority Components
**Components with hardcoded colors or heavy inline styles:**

#### 29.1 ChatContainer.vue
- [ ] 29.1.1 Replace hardcoded background colors with CSS variables
- [ ] 29.1.2 Replace inline `style` bindings with CSS classes where possible
- [ ] 29.1.3 Test chat UI renders identically before/after
- **Requirements**: 8.3

#### 29.2 ChatMessage.vue
- [ ] 29.2.1 Replace message background colors with `--app-message-bg-user` and `--app-message-bg-assistant`
- [ ] 29.2.2 Replace text colors with `--app-message-text` variable
- [ ] 29.2.3 Add variables to default theme CSS
- [ ] 29.2.4 Test user and assistant messages render correctly
- **Requirements**: 8.3

#### 29.3 ResizableSidebarLayout.vue
- [ ] 29.3.1 Verify pattern backgrounds use CSS variables (already mostly done)
- [ ] 29.3.2 Replace any remaining hardcoded colors
- [ ] 29.3.3 Test sidebar patterns and colors in light/dark mode
- **Requirements**: 8.3

#### 29.4 SidebarHeader.vue
- [ ] 29.4.1 Verify gradient uses `--app-header-gradient` variable (already done)
- [ ] 29.4.2 Replace any hardcoded title or icon colors
- [ ] 29.4.3 Test header renders correctly
- **Requirements**: 8.3

#### 29.5 SideBottomNav.vue
- [ ] 29.5.1 Verify gradient uses `--app-bottomnav-gradient` variable
- [ ] 29.5.2 Replace hardcoded button colors with variables
- [ ] 29.5.3 Test bottom nav renders correctly on mobile
- **Requirements**: 8.3

### 30. Refactor Medium Priority Components
- [ ] 30.1 ModelCatalog.vue - Replace hardcoded card backgrounds and borders
- [ ] 30.2 ThemePage.vue - Already uses variables, verify completeness
- [ ] 30.3 Dashboard.vue - Replace hardcoded section backgrounds
- [ ] 30.4 PromptEditor.vue - Replace editor background/border colors
- [ ] 30.5 DocumentEditor.vue - Replace editor chrome colors
- **Requirements**: 8.3

### 31. Refactor Low Priority Components
- [ ] 31.1 Plugin example components (PagesDemoOverview.vue, etc.)
- [ ] 31.2 Test fixtures and stubs
- [ ] 31.3 One-off pages (openrouter-callback, etc.)
- **Requirements**: 8.3

### 32. Update Component Refactor Checklist
- [ ] 32.1 Mark each component as done in tracking issue
- [ ] 32.2 Add notes for any tricky refactors
- [ ] 32.3 Link to PRs or commits for each component
- [ ] 32.4 Celebrate when all components refactored! 🎉
- **Requirements**: 8.3

---

## Phase 6: Testing & Validation

**Timeline**: Throughout all phases  
**Requirements**: Testing requirements, 7.1, 7.2

### 33. Performance Testing
- [ ] 33.1 Measure theme load time before refactor (baseline)
- [ ] 33.2 Measure theme load time after refactor
- [ ] 33.3 Ensure load time increase is <50ms (requirement 7.1)
- [ ] 33.4 Measure light/dark mode switch time (<16ms, requirement 7.2)
- [ ] 33.5 Profile with Chrome DevTools Performance tab
- [ ] 33.6 Check for forced layout recalculations on theme switch
- **Requirements**: 7.1, 7.2

### 34. Integration Testing
- [ ] 34.1 Create `tests/integration/theming.test.ts`
- [ ] 34.2 Test custom theme CSS variables applied to :root
- [ ] 34.3 Test Nuxt UI components reflect theme colors
- [ ] 34.4 Test useThemeSettings overrides layer correctly on top of theme
- [ ] 34.5 Test light/dark mode toggle updates all components
- [ ] 34.6 Test high-contrast mode works with custom themes
- **Requirements**: Testing requirements

### 35. End-to-End Testing
- [ ] 35.1 Create `tests/e2e/theme-switching.spec.ts`
- [ ] 35.2 E2E: User opens app, default theme loads
- [ ] 35.3 E2E: User switches to dark mode, variables update
- [ ] 35.4 E2E: User opens theme settings, changes primary color
- [ ] 35.5 E2E: User reloads page, customizations persist
- [ ] 35.6 E2E: User switches to custom theme (when implemented), layout updates
- **Requirements**: Testing requirements

### 36. Error Recovery Testing
- [ ] 36.1 Create `tests/e2e/theme-errors.spec.ts`
- [ ] 36.2 E2E: Custom theme with missing light.css → falls back to default
- [ ] 36.3 E2E: Custom theme with invalid CSS → logs errors, continues
- [ ] 36.4 E2E: theme.ts with syntax error → logs error, uses default config
- [ ] 36.5 E2E: Missing CSS variables → warnings logged, app functional
- **Requirements**: Testing requirements, 6.3

### 37. Visual Regression Testing
- [ ] 37.1 Set up visual regression tool (Percy, Chromatic, or Playwright screenshots)
- [ ] 37.2 Capture screenshots of all major pages in light mode
- [ ] 37.3 Capture screenshots of all major pages in dark mode
- [ ] 37.4 Capture screenshots with high-contrast mode
- [ ] 37.5 Run visual regression tests in CI pipeline
- [ ] 37.6 Review and approve any intentional visual changes
- **Requirements**: Testing requirements

---

## Phase 7: Launch & Polish

**Timeline**: After all previous phases  
**Requirements**: Success criteria

### 38. Pre-Launch Checklist
- [ ] 38.1 All unit tests passing
- [ ] 38.2 All integration tests passing
- [ ] 38.3 All E2E tests passing
- [ ] 38.4 Visual regression tests show no unintended changes
- [ ] 38.5 Performance benchmarks meet targets
- [ ] 38.6 Documentation complete and reviewed
- [ ] 38.7 Example themes tested and working
- [ ] 38.8 Migration guide reviewed by team
- [ ] 38.9 Backward compatibility verified (existing user settings work)

### 39. Soft Launch (Beta Testing)
- [ ] 39.1 Create feature flag for new theming system (optional)
- [ ] 39.2 Enable for beta testers or small user group
- [ ] 39.3 Monitor for errors or performance issues
- [ ] 39.4 Gather feedback on theming workflow
- [ ] 39.5 Fix any critical issues before full launch

### 40. Full Launch
- [ ] 40.1 Merge theming refactor PR to main branch
- [ ] 40.2 Deploy to production
- [ ] 40.3 Announce theming system in release notes
- [ ] 40.4 Share theming guide on social media, forums, Discord
- [ ] 40.5 Monitor GitHub issues for theme-related questions
- [ ] 40.6 Update README.md with link to theming docs

### 41. Post-Launch Monitoring
- [ ] 41.1 Track theme switching analytics (if applicable)
- [ ] 41.2 Monitor error logs for theme-related issues
- [ ] 41.3 Survey users on theming experience
- [ ] 41.4 Count community themes created (success metric: 2+ in 1 month)
- [ ] 41.5 Iterate on documentation based on common questions

### 42. Future Enhancements Backlog
- [ ] 42.1 Dynamic theme switching without page reload
- [ ] 42.2 Theme marketplace/gallery
- [ ] 42.3 Visual theme editor UI
- [ ] 42.4 Per-pane themes
- [ ] 42.5 Theme import/export as ZIP files
- [ ] 42.6 Theme sharing via URL

---

## Component Refactor Priority List

Based on analysis, these components need the most refactoring for hardcoded styles:

### High Priority (Used Everywhere)
1. **ChatContainer.vue** - Main chat UI, many inline styles
2. **ChatMessage.vue** - Message rendering, hardcoded role-based colors
3. **ResizableSidebarLayout.vue** - Sidebar chrome, mostly done but verify
4. **SidebarHeader.vue** - Header styles, verify gradient usage
5. **SideBottomNav.vue** - Mobile nav, some hardcoded colors

### Medium Priority (Frequently Used)
6. **ModelCatalog.vue** - Model selection cards, hardcoded backgrounds
7. **ThemePage.vue** - Theme settings UI, already uses many variables
8. **Dashboard.vue** - Dashboard layout, section backgrounds
9. **PromptEditor.vue** - Prompt editing, editor chrome
10. **DocumentEditor.vue** - Document editing, toolbar styles

### Low Priority (Edge Cases)
11. Plugin example components (PagesDemoOverview.vue, PagesDemoDetails.vue)
12. Test fixtures and stubs
13. One-off pages (openrouter-callback.vue, etc.)

### Already Good (Minimal Refactor Needed)
- Most UI components that already use `var(--md-*)` variables
- Components using Nuxt UI components with proper theming
- Simple layout components without custom colors

---

## Notes

- Tasks can be worked in parallel where dependencies allow
- Each task should have a linked PR or commit for tracking
- Update this document as tasks are completed (change `[ ]` to `[x]`)
- Add sub-tasks if a task is more complex than expected
- Celebrate small wins along the way! 🎉

---

**Legend**:
- `[ ]` = Not started
- `[x]` = Completed
- Tasks numbered for easy reference in PRs and discussions
