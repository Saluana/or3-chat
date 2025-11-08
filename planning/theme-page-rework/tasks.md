# Theme Page Modernization - Implementation Tasks

This document provides a detailed checklist of tasks required to migrate the ThemePage.vue component and underlying theme customization system from legacy `ThemeSettings` to the new `UserThemeOverrides` system.

---

## Phase 1: Core Infrastructure (3-5 days) ✅ COMPLETED

### 1. Create User Override Types ✅

**Requirements**: 1.1

- [x] 1.1 Create `app/core/theme/user-overrides-types.ts`
  - [x] Define `UserThemeOverrides` interface
  - [x] Define `ThemeBackgroundLayer` interface
  - [x] Export `EMPTY_USER_OVERRIDES` constant
  - [x] Add JSDoc comments for all types

### 2. Implement User Overrides Composable ✅

**Requirements**: 1.1, 1.2, 1.3

- [x] 2.1 Create `app/core/theme/useUserThemeOverrides.ts`
  - [x] Set up HMR-safe singleton store with light/dark refs
  - [x] Implement `detectModeFromHtml()` helper
  - [x] Implement `loadFromStorage()` with error handling
  - [x] Implement `saveToStorage()` with error handling
- [x] 2.2 Implement core composable functions
  - [x] `set()` - deep merge user patches with existing overrides
  - [x] `reset()` - clear overrides for specified mode
  - [x] `resetAll()` - clear overrides for both modes
  - [x] `switchMode()` - toggle between light/dark and apply
  - [x] `reapply()` - force theme reapplication
- [x] 2.3 Set up reactive watchers
  - [x] Watch light overrides and persist on change
  - [x] Watch dark overrides and persist on change
  - [x] Watch html class mutations to detect external mode changes
- [x] 2.4 Implement initialization logic
  - [x] Check for legacy data and migrate if present
  - [x] Load stored overrides from localStorage
  - [x] Detect initial mode from html classes
  - [x] Apply merged theme on first load

### 3. Implement Theme Merging & Application ✅

**Requirements**: 2.1, 2.2, 2.3

- [x] 3.1 Create `app/core/theme/apply-merged-theme.ts`
  - [x] Implement `applyMergedTheme()` main function
  - [x] Apply typography overrides (baseFontPx, useSystemFont)
  - [x] Apply color palette overrides (primary, secondary, error, etc.)
  - [x] Build merged backgrounds from base theme + user overrides
  - [x] Call `applyThemeBackgrounds()` with merged data
  - [x] Apply background color overrides (if enabled)
  - [x] Handle gradient visibility (headerGradient, bottomNavGradient)
  - [x] Implement high-contrast pattern opacity clamping
- [x] 3.2 Implement helper functions
  - [x] `buildMergedBackgrounds()` - merge base theme backgrounds with overrides
  - [x] `convertLayerToThemeFormat()` - convert UserOverrides layer to ThemeBackgrounds format
  - [x] `isHighContrastActive()` - detect high-contrast mode
  - [x] `clampBackgroundOpacities()` - reduce opacity for high-contrast

### 4. Implement Legacy Data Migration ✅

**Requirements**: 1.4

- [x] 4.1 Create `app/core/theme/migrate-legacy-settings.ts`
  - [x] Implement `migrateFromLegacy()` function
  - [x] Check if new format already exists (skip migration)
  - [x] Load legacy data from localStorage (light/dark/combined keys)
  - [x] Implement `convertToOverrides()` - map ThemeSettings → UserThemeOverrides
  - [x] Delete legacy localStorage keys after successful migration
  - [x] Add error handling and logging
- [x] 4.2 Create field mapping
  - [x] Map `paletteEnabled` → `colors.enabled`
  - [x] Map palette colors (primary, secondary, error, surfaceVariant, border, surface)
  - [x] Map `customBgColorsEnabled` → `backgrounds.enabled`
  - [x] Map content background layers (contentBg1/contentBg2 → content.base/overlay)
  - [x] Map sidebar background (sidebarBg → sidebar)
  - [x] Map gradient settings (showHeaderGradient, showBottomBarGradient)
  - [x] Map typography settings (baseFontPx, useSystemFont)
  - [x] Map UI settings (reducePatternsInHighContrast)

---

## Phase 2: ThemePage.vue Refactor (2-3 days)

### 5. Update ThemePage.vue Imports & Setup

**Requirements**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8

- [ ] 5.1 Replace imports
  - [ ] Remove `import { useThemeSettings } from '~/core/theme/useThemeSettings'`
  - [ ] Add `import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides'`
- [ ] 5.2 Update composable usage
  - [ ] Replace `const themeApi = useThemeSettings()` → `useUserThemeOverrides()`
  - [ ] Rename `settings` ref to `overrides`
  - [ ] Update all destructured properties (activeMode, set, reset, etc.)

### 6. Update Reactive State Mapping

**Requirements**: 3.1-3.8

- [ ] 6.1 Update `local` reactive object
  - [ ] Map `baseFontPx` from `overrides.value.typography?.baseFontPx`
  - [ ] Map background opacities from `overrides.value.backgrounds?.content?.base?.opacity` etc.
  - [ ] Map background sizes from `overrides.value.backgrounds?.content?.base?.sizePx` etc.
- [ ] 6.2 Update `localHex` reactive object
  - [ ] Map background colors from `overrides.value.backgrounds?.content?.base?.color` etc.
  - [ ] Map palette colors from `overrides.value.colors?.primary` etc.
- [ ] 6.3 Update computed properties
  - [ ] Update all computed style bindings to use new paths
  - [ ] Verify preview thumbnails work with new structure

### 7. Update Event Handlers

**Requirements**: 3.1-3.8

- [ ] 7.1 Update mode toggle handlers
  - [ ] `switchMode()` calls remain the same (API unchanged)
  - [ ] Verify light/dark button states work correctly
- [ ] 7.2 Update palette override handlers
  - [ ] Update checkbox binding: `overrides.colors?.enabled`
  - [ ] Update color picker handlers: `set({ colors: { primary: '#xxx' } })`
  - [ ] Update hex input handlers to use nested path
  - [ ] Update copy button handlers
- [ ] 7.3 Update background color toggle
  - [ ] Update checkbox binding: `overrides.backgrounds?.enabled`
- [ ] 7.4 Update typography handlers
  - [ ] Update font size slider: `set({ typography: { baseFontPx: n } })`
  - [ ] Update system font checkbox: `set({ typography: { useSystemFont: bool } })`
- [ ] 7.5 Update background layer handlers (content layer 1, 2, sidebar)
  - [ ] Update image upload: `set({ backgrounds: { content: { base: { url: token } } } })`
  - [ ] Update opacity sliders: `set({ backgrounds: { content: { base: { opacity: n } } } })`
  - [ ] Update size sliders: `set({ backgrounds: { content: { base: { sizePx: n } } } })`
  - [ ] Update fit checkboxes: `set({ backgrounds: { content: { base: { fit: bool } } } })`
  - [ ] Update repeat toggles: `set({ backgrounds: { content: { base: { repeat: val } } } })`
  - [ ] Update color pickers: `set({ backgrounds: { content: { base: { color: hex } } } })`
  - [ ] Update preset buttons
  - [ ] Update remove buttons
- [ ] 7.6 Update accessibility handlers
  - [ ] Update high-contrast checkbox: `set({ ui: { reducePatternsInHighContrast: bool } })`
- [ ] 7.7 Update navigation header/footer handlers
  - [ ] Update gradient toggles: `set({ backgrounds: { headerGradient: { enabled: bool } } })`
  - [ ] Update background color pickers
- [ ] 7.8 Update reset handlers
  - [ ] Verify `reset()` and `resetAll()` work with new API
  - [ ] Confirm confirmation dialogs still appear

### 8. Update Template Bindings

**Requirements**: 3.1-3.8

- [ ] 8.1 Update all `v-model` and `:value` bindings
  - [ ] Replace `settings.paletteEnabled` → `overrides.colors?.enabled`
  - [ ] Replace `settings.palettePrimary` → `overrides.colors?.primary`
  - [ ] Replace all background layer bindings to use nested paths
  - [ ] Replace typography bindings
- [ ] 8.2 Update all conditional rendering (`:disabled`, `v-if`, `:class`)
  - [ ] Verify color pickers disable when `!overrides.colors?.enabled`
  - [ ] Verify background color pickers disable when `!overrides.backgrounds?.enabled`
- [ ] 8.3 Update all display text bindings
  - [ ] Verify gradient status text shows correct state
  - [ ] Verify mode indicator shows correct mode

---

## Phase 3: Testing (2-3 days)

### 9. Unit Tests for New Composables

**Requirements**: 5.2

- [ ] 9.1 Create `app/core/theme/__tests__/user-overrides.test.ts`
  - [ ] Test: initialization with empty overrides
  - [ ] Test: `set()` merges partial updates correctly
  - [ ] Test: `set()` persists to localStorage
  - [ ] Test: overrides load from localStorage on init
  - [ ] Test: `switchMode()` toggles between light/dark
  - [ ] Test: separate light/dark profiles maintained
  - [ ] Test: `reset()` clears only active mode
  - [ ] Test: `resetAll()` clears both modes
  - [ ] Test: deep merge preserves unmodified sections
- [ ] 9.2 Create `app/core/theme/__tests__/migrate-legacy.test.ts`
  - [ ] Test: migration converts ThemeSettings → UserThemeOverrides
  - [ ] Test: migration deletes legacy keys after success
  - [ ] Test: migration skips if new format exists
  - [ ] Test: migration handles missing legacy keys gracefully
  - [ ] Test: all field mappings convert correctly
- [ ] 9.3 Create `app/core/theme/__tests__/apply-merged-theme.test.ts`
  - [ ] Test: typography overrides applied to CSS variables
  - [ ] Test: color palette overrides applied when enabled
  - [ ] Test: color palette removed when disabled
  - [ ] Test: background layers merge correctly
  - [ ] Test: high-contrast clamping works
  - [ ] Test: gradient visibility toggles work

### 10. Integration Tests

**Requirements**: 5.2

- [ ] 10.1 Create/update `tests/e2e/theme-page.spec.ts`
  - [ ] Test: switch between light and dark modes
  - [ ] Test: adjust base font size slider
  - [ ] Test: enable palette overrides and change primary color
  - [ ] Test: upload background image via file input
  - [ ] Test: upload background image via drag-and-drop
  - [ ] Test: adjust opacity slider for background layer
  - [ ] Test: toggle repeat for background layer
  - [ ] Test: toggle fit for background layer
  - [ ] Test: apply preset background
  - [ ] Test: remove background layer
  - [ ] Test: settings persist across page reloads
  - [ ] Test: reset current mode clears only active mode
  - [ ] Test: reset all clears both modes

### 11. Manual QA Testing

**Requirements**: All

- [ ] 11.1 Fresh install testing
  - [ ] Load app with no localStorage data
  - [ ] Verify default theme loads correctly
  - [ ] Make customizations and verify they persist
  - [ ] Reload and verify customizations restored
- [ ] 11.2 Migration testing
  - [ ] Set up legacy localStorage data manually
  - [ ] Load app and verify migration runs
  - [ ] Verify all settings migrated correctly
  - [ ] Verify legacy keys removed
  - [ ] Verify customizations work after migration
- [ ] 11.3 Edge case testing
  - [ ] Test with corrupted localStorage data
  - [ ] Test with quota exceeded error (simulate)
  - [ ] Test image upload with invalid file type
  - [ ] Test image upload with file >2MB
  - [ ] Test with high-contrast mode enabled
- [ ] 11.4 Visual regression testing
  - [ ] Compare UI screenshots before/after refactor
  - [ ] Verify all controls render correctly
  - [ ] Verify drag-drop zones work
  - [ ] Verify color pickers work
  - [ ] Verify all theme changes apply visually

---

## Phase 4: Deployment & Monitoring (1 day)

### 12. Pre-Deployment Preparation

**Requirements**: All

- [ ] 12.1 Code review
  - [ ] Review all new files for code quality
  - [ ] Review all changes to ThemePage.vue
  - [ ] Verify no console errors in dev tools
  - [ ] Run type checking (`npm run typecheck` or equivalent)
- [ ] 12.2 Documentation updates
  - [ ] Update any theme customization docs if needed
  - [ ] Add migration notes to changelog
- [ ] 12.3 Prepare rollback plan
  - [ ] Document revert steps
  - [ ] Tag current production version for easy rollback

### 13. Deployment

**Requirements**: All

- [ ] 13.1 Deploy to staging/preview environment
  - [ ] Verify functionality in staging
  - [ ] Run smoke tests
- [ ] 13.2 Deploy to production
  - [ ] Deploy new code
  - [ ] Monitor error logs for migration failures
  - [ ] Monitor error logs for localStorage errors
  - [ ] Monitor performance metrics

### 14. Post-Deployment Monitoring

**Requirements**: All

- [ ] 14.1 Monitor for 48 hours
  - [ ] Check error rates (target: <0.1% increase)
  - [ ] Check user feedback channels
  - [ ] Verify theme customizations working for users
- [ ] 14.2 Resolve any issues
  - [ ] Fix critical bugs immediately
  - [ ] Triage non-critical issues for future sprints
  - [ ] Update documentation if needed

---

## Phase 5: Legacy Code Cleanup (1 day, after 2 weeks stability)

### 15. Remove Legacy Code

**Requirements**: 5.1

- [ ] 15.1 Delete legacy files
  - [ ] Delete `app/core/theme/useThemeSettings.ts`
  - [ ] Delete `app/core/theme/theme-apply.ts`
  - [ ] Delete `app/plugins/theme-settings.client.ts`
- [ ] 15.2 Review and clean up legacy types
  - [ ] Check `app/core/theme/theme-types.ts` for unused exports
  - [ ] Delete `ThemeSettings` interface if unused elsewhere
  - [ ] Check `app/core/theme/theme-defaults.ts` for unused exports
  - [ ] Delete legacy default constants if unused
- [ ] 15.3 Remove legacy tests
  - [ ] Delete `app/composables/__tests__/themeSettings.unit.test.ts` (if exists)
  - [ ] Remove any legacy test utilities
- [ ] 15.4 Update imports across codebase
  - [ ] Search for any remaining imports of deleted files
  - [ ] Update or remove as appropriate
- [ ] 15.5 Final verification
  - [ ] Run full test suite
  - [ ] Run type checking
  - [ ] Build production bundle and verify no errors
  - [ ] Deploy cleanup changes

---

## Success Criteria

- [ ] All unit tests passing (≥80% coverage for new code)
- [ ] All integration tests passing
- [ ] Manual QA sign-off
- [ ] Zero regressions in theme customization functionality
- [ ] Migration tested with real legacy data
- [ ] Performance metrics maintained or improved
- [ ] No increase in error rates post-deployment
- [ ] Legacy code removed after 2 weeks of stability

---

## Estimated Timeline

- **Phase 1 (Core Infrastructure)**: 3-5 days
- **Phase 2 (ThemePage Refactor)**: 2-3 days
- **Phase 3 (Testing)**: 2-3 days
- **Phase 4 (Deployment)**: 1 day
- **Phase 5 (Cleanup)**: 1 day (after 2 week soak period)

**Total Development Time**: 8-12 days  
**Total Calendar Time**: ~4 weeks (including soak period)
