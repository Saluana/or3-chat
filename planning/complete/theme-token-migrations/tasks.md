# Tasks

## 1. Inventory and token contracts

- [x] 1.1 Build the density consumer inventory by component family
      Requirements: R1.AC1, R2.AC3, R6.AC1, R7.AC1
      Design component: Migration inventory
      Done when: every first-party component family containing fixed control heights or shared control/section gaps is indexed with its migration and exemption rules.

- [x] 1.2 Build the focus, motion, and elevation consumer inventories
      Requirements: R3.AC1, R4.AC2, R4.AC3, R5.AC4, R6.AC1, R7.AC1
      Design component: Migration inventory
      Done when: every first-party component family containing focus, motion, or shadow candidates is indexed with classification and exemption rules; declaration-level closure remains the final audit gate.

- [x] 1.3 Add typed density and elevation fields to the theme and override contracts
      Requirements: R1.AC1, R1.AC2, R1.AC3, R2.AC1, R5.AC1
      Design components: Theme token contract; Per-mode appearance overrides
      Done when: TypeScript types, theme validation, and CSS generation accept only the documented enums and optional authored tokens.

- [x] 1.4 Add the focus, motion, and elevation CSS token fallbacks
      Requirements: R1.AC1, R3.AC1, R3.AC2, R4.AC1, R5.AC1
      Design component: Theme token contract
      Done when: root defaults and documented per-consumer fallback syntax compile without changing computed styles in an override-free baseline.

## 2. Runtime and persistence

- [x] 2.1 Implement pure density and elevation preset mappers
      Requirements: R1.AC3, R2.AC1, R5.AC1, R5.AC2
      Design component: Per-mode appearance overrides
      Done when: unit tests cover every enum, exact emitted token set, Theme default removal, and invalid input.

- [x] 2.2 Apply and remove density overrides through `applyMergedTheme`
      Requirements: R2.AC1, R2.AC3, R2.AC4, R6.AC3
      Design component: Per-mode appearance overrides
      Done when: switching, disabling, resetting, and restoring each per-mode density profile has passing DOM-style tests.

- [x] 2.3 Apply and remove elevation overrides through `applyMergedTheme`
      Requirements: R5.AC1, R5.AC2, R5.AC3, R5.AC4, R6.AC3
      Design component: Per-mode appearance overrides
      Done when: low/medium/high variables update live and disabling removes only owned inline properties.

- [x] 2.4 Implement the versioned global accessibility preference store
      Requirements: R1.AC3, R3.AC3, R3.AC4, R4.AC4, R6.AC4
      Design component: Global accessibility preferences
      Done when: focus and motion load, validate, persist, reset, and survive theme/color-mode changes in unit tests.

- [x] 2.5 Apply focus and motion accessibility preferences to the root element
      Requirements: R3.AC1, R3.AC3, R4.AC1, R4.AC2, R4.AC3
      Design component: Global accessibility preferences
      Done when: root variables and `data-motion` update synchronously and System mode responds to a mocked OS reduced-motion change.

## 3. Density consumer migration

- [x] 3.1 Migrate shared Nuxt UI controls and base application config
      Requirements: R1.AC1, R2.AC1, R2.AC3
      Design component: Token consumer migration
      Done when: button, input, textarea, select, menu, tabs, and modal-control configs consume density tokens with their original values as fallbacks.

- [x] 3.2 Migrate sidebar and workspace navigation controls
      Requirements: R2.AC2, R2.AC3, R2.AC4
      Design component: Token consumer migration
      Done when: expanded/collapsed sidebar rows, bottom navigation, workspace tabs, and switchers pass desktop and 44px mobile target checks.

- [x] 3.3 Migrate chat, document, and workflow toolbars
      Requirements: R2.AC2, R2.AC3
      Design component: Token consumer migration
      Done when: composer controls, document toolbars, workflow controls, and their menus use deliberate small/medium/large tiers without clipping.

- [x] 3.4 Migrate dashboard, admin, wizard, and plugin-facing first-party controls
      Requirements: R2.AC2, R2.AC3, R6.AC1
      Design component: Token consumer migration
      Done when: the density inventory reaches at least 90% migrated coverage and every remaining item has an exemption.

## 4. Focus consumer migration

- [x] 4.1 Migrate base focus-visible rules and Nuxt UI mappings
      Requirements: R3.AC1, R3.AC2, R3.AC3
      Design component: Token consumer migration
      Done when: shared inputs, buttons, tabs, menus, and dialogs consume focus width, offset, and color fallbacks without broad `!important` rules.

- [x] 4.2 Migrate custom interactive components by application area
      Requirements: R3.AC1, R3.AC2, R6.AC1
      Design component: Token consumer migration
      Done when: sidebar, workspace, chat, documents, workflows, dashboard, and admin focus indicators reach 90% inventory coverage.

- [x] 4.3 Verify keyboard focus contrast in every shipped theme
      Requirements: R3.AC2, R3.AC4, R7.AC3
      Design component: Token consumer migration
      Done when: automated keyboard traversal confirms a visible focus indicator in Blank, Retro, and Cyberpunk light/dark modes.

## 5. Motion consumer migration

- [x] 5.1 Separate functional progress animation from decorative motion
      Requirements: R4.AC2, R4.AC3, R7.AC1
      Design component: Migration inventory
      Done when: every animated loader/progress indicator has a documented static or textual fallback and every decorative animation is marked reducible.

- [x] 5.2 Migrate shared transitions and overlays to duration tiers
      Requirements: R4.AC1, R4.AC2, R4.AC3
      Design component: Token consumer migration
      Done when: modal, popover, menu, sidebar, tab, and overlay transitions use fast/medium/slow tokens with original fallbacks.

- [x] 5.3 Migrate component-specific decorative animations
      Requirements: R4.AC2, R4.AC3, R6.AC1
      Design component: Token consumer migration
      Done when: decorative animations stop in Reduced as specified, functional progress remains understandable, and motion inventory coverage reaches 90%.

## 6. Elevation consumer migration

- [x] 6.1 Migrate dialogs, popovers, menus, and floating panels
      Requirements: R1.AC1, R5.AC1, R5.AC2, R5.AC4
      Design component: Token consumer migration
      Done when: each elevated overlay uses a deliberate medium/high tier, retains its original fallback, and remains bounded in Flat mode.

- [x] 6.2 Migrate cards, toolbars, and raised controls
      Requirements: R5.AC1, R5.AC2, R5.AC4, R6.AC1
      Design component: Token consumer migration
      Done when: first-party low/medium elevation consumers reach 90% inventory coverage with specialty theme effects explicitly exempted.

- [x] 6.3 Author shipped-theme elevation defaults
      Requirements: R1.AC2, R2.AC4, R5.AC3
      Design component: Theme token contract
      Done when: Blank, Retro, and Cyberpunk validate, preserve their intended visual character, and generate documented elevation variables.

## 7. Theme Studio integration

- [x] 7.1 Add density and elevation controls after their coverage gates pass
      Requirements: R2.AC1, R5.AC1, R6.AC1, R6.AC2, R6.AC3
      Design component: Theme Studio controls
      Done when: constrained Theme default/preset controls update live, preserve disabled values, and contain no free-form CSS inputs.

- [x] 7.2 Add focus thickness and motion controls under Accessibility
      Requirements: R3.AC1, R3.AC3, R4.AC1, R4.AC2, R4.AC3, R6.AC4
      Design component: Theme Studio controls
      Done when: the focus control is constrained to 1-4px, motion exposes System/Reduced, and copy states that both apply across color modes.

- [x] 7.3 Audit Theme Studio responsive layout and contrast
      Requirements: R6.AC2, R7.AC3
      Design component: Theme Studio controls
      Done when: controls remain usable at 320px width and every normal, hover, active, disabled, and focus state uses paired theme colors in light/dark modes.

## 8. Verification and documentation

- [x] 8.1 Add unit and integration regression coverage
      Requirements: R1.AC1, R1.AC3, R2.AC4, R3.AC4, R4.AC4, R5.AC3, R7.AC2
      Design components: Per-mode appearance overrides; Global accessibility preferences
      Done when: targeted Vitest suites cover validation, mapping, persistence, application, reset, fallback, and mode/theme switching.

- [x] 8.2 Add the shipped-theme Playwright matrix
      Requirements: R2.AC2, R2.AC3, R3.AC2, R4.AC2, R4.AC3, R5.AC2, R5.AC4, R7.AC3
      Design components: Token consumer migration; Theme Studio controls
      Done when: computed-style assertions pass for three themes, two color modes, and desktop/mobile viewports.

- [x] 8.3 Complete the final migration audit
      Requirements: R6.AC1, R7.AC1
      Design component: Migration inventory
      Done when: each family is at least 90% migrated and every remaining declaration has a reviewed exemption or follow-up owner.

- [x] 8.4 Update author and user documentation
      Requirements: R1.AC2, R6.AC2, R7.AC4
      Design components: Theme token contract; Theme Studio controls
      Done when: `app/theme/README.md`, `public/_documentation/themes/`, and docmap-linked pages describe tokens, fallbacks, presets, persistence scope, and adoption examples.

- [x] 8.5 Run proportionate final verification
      Requirements: R7.AC2, R7.AC3, R7.AC4
      Design components: All
      Done when: theme validation, type-check, affected Vitest projects, Playwright matrix, documentation checks, and `git diff --check` are green.

## Traceability Matrix

| Requirement | Design component | Tasks |
|---|---|---|
| R1 | Theme token contract; Per-mode appearance overrides; Token consumer migration | 1.1-1.4, 2.1, 6.1, 6.3, 8.1, 8.4 |
| R2 | Per-mode appearance overrides; Token consumer migration; Theme Studio controls | 1.1, 1.3-1.4, 2.1-2.2, 3.1-3.4, 7.1, 8.1-8.2 |
| R3 | Global accessibility preferences; Token consumer migration; Theme Studio controls | 1.2, 1.4, 2.4-2.5, 4.1-4.3, 7.2, 8.1-8.2 |
| R4 | Global accessibility preferences; Token consumer migration; Theme Studio controls | 1.2, 1.4, 2.4-2.5, 5.1-5.3, 7.2, 8.1-8.2 |
| R5 | Theme token contract; Per-mode appearance overrides; Token consumer migration; Theme Studio controls | 1.2-1.4, 2.1, 2.3, 6.1-6.3, 7.1, 8.1-8.2 |
| R6 | Migration inventory; Theme Studio controls | 1.1-1.2, 3.4, 4.2, 5.3, 6.2, 7.1-7.3, 8.3-8.4 |
| R7 | Migration inventory; all runtime and UI components | 1.1-1.2, 4.3, 8.1-8.5 |

## Definition of Done

- Every acceptance criterion in `requirements.md` is demonstrably satisfied.
- Every token family meets the 90% migration gate before its editor control is enabled.
- Theme validation, type-check, affected Vitest suites, Playwright theme matrix,
  documentation checks, and `git diff --check` pass.
- Blank, Retro, and Cyberpunk retain their authored appearance when overrides
  are absent.
- The traceability matrix contains no missing requirement, component, or task.
