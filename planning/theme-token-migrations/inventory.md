# Migration Inventory

## Purpose

This inventory identifies the first-party OR3 Chat source areas that must be
reviewed before density, focus, motion, or elevation controls are exposed in
Theme Studio. It is a migration map, not permission to mechanically replace
matching CSS. Every consumer must be classified in its component context and
patched in a small, reviewable batch.

## Safety Rules

- Do not use Python, codemods, global search-and-replace, `sed`, or Perl to
  migrate consumers.
- Patch one component family at a time and inspect the resulting diff before
  moving to the next family.
- Preserve the exact current value as the final CSS fallback until the shipped
  themes explicitly author the new token.
- Preserve mobile/coarse-pointer hit targets of at least 44 by 44 pixels.
- Do not change icon glyph sizes, canvas dimensions, safe-area values, content
  grids, skeleton geometry, or prose spacing as part of density migration.
- Do not classify focus rings, selected-state inset outlines, glows, text
  shadows, blur, or theme-specific press effects as elevation.
- Do not disable progress communication when reducing motion. Replace
  nonessential animation with a still state or text where necessary.
- Never edit generated theme output directly. Change its authored source and
  run the existing theme compiler.

## Audit Summary

| Family | Audited surface | Primary risk |
|---|---:|---|
| Density | 120+ candidate source files | Inflating glyphs instead of hit targets; breaking tab/chrome calculations |
| Focus | 44 files with real focus affordances | Removing the only visible keyboard indicator, especially in Retro |
| Motion | About 100 source files / 206 matches | Treating functional progress like decorative animation |
| Elevation | 57 non-theme product source files | Flattening focus/selection effects or theme-specific Retro depth |

These counts exclude tests, dependencies, `.nuxt`, build output, coverage, and
generated public theme CSS. A match is a review candidate, not automatically a
token consumer.

## Shared Contract and Runtime

These files are migration prerequisites for more than one family:

| Responsibility | Source |
|---|---|
| Persisted override types and defaults | `app/core/theme/user-overrides-types.ts` |
| Load validation and persistence | `app/core/theme/useUserThemeOverrides.ts` |
| Root CSS-variable set/remove behavior | `app/core/theme/apply-merged-theme.ts` |
| Client bootstrap | `app/plugins/theme-overrides.client.ts` |
| Theme author contract | `app/theme/_shared/types.ts` |
| Theme definition and validation | `app/theme/_shared/define-theme.ts`, `app/theme/_shared/validate-theme.ts` |
| CSS generation and compilation | `app/theme/_shared/generate-css-variables.ts`, `app/theme/_shared/compile-theme.ts` |
| Shared Nuxt UI consumers | `app/app.config.ts` |
| Theme Studio UI | `app/components/dashboard/theme/`, `app/components/dashboard/ThemePage.vue` |
| Runtime regression tests | `app/core/theme/__tests__/apply-merged-theme.test.ts`, `app/core/theme/__tests__/user-overrides.test.ts` |

## Source of Truth and Generated Files

- `app/theme/blank/` and `app/theme/retro/` are authored sources.
- `public/themes/blank.css`, `public/themes/retro.css`, and
  `theme-manifest.generated.ts` are generated and must not be hand-edited.
- `app/theme/retro/styles.css` contains intentional hard-offset and pressed
  shadows. `app/theme/blank/styles.css` intentionally removes several shadows
  and uses borders/inset state instead. Both are design behavior, not migration
  noise.
- `app/plugins/workflows/styles/workflow-theme-bridge.css` owns a bounded plugin
  shadow bridge and must be migrated or explicitly exempted as one unit.

## Density Inventory

### Proposed contract

```css
--app-control-height-small
--app-control-height-medium
--app-control-height-large
--app-space-control
--app-space-section
```

Small is compact desktop chrome, Medium is a normal desktop control, and Large
is a composer or primary row. On coarse pointers, independently clickable
wrappers use `max(44px, var(--app-control-height-...))`; visual glyphs do not.

### Migration families

| Order | Family | Main sources and decisions |
|---:|---|---|
| 1 | Shared Nuxt UI | `app/app.config.ts`: tree links, button sizes, input/textarea/select/menu/tabs/modal controls. Keep switch track/thumb and select icons visual-only. |
| 2 | Global layout rhythm | `app/assets/css/main.css`: dashboard/page section gaps and plugin pane header. Exclude prose CSS from the first wave. |
| 3 | Sidebar/navigation | `app/components/sidebar/` (about 29 candidates): project roots, group headers, page/unified rows, desktop bottom nav and mobile bottom nav. Preserve the existing 54px mobile navigation target. |
| 4 | Workspace chrome | `WorkspaceChrome.vue`, `WorkspaceTabBar.vue`, `WorkspaceNewTabControl.vue`, `WorkspaceTabSwitcher.vue`. Preserve clearance variables, `calc()` relationships, and virtual/menu geometry. |
| 5 | Chat/composer | `ChatInputDropper.vue`, `ModelSelect.vue`, `MessageEditor.vue`, `ChatSettingsPopover.vue`, `ChatMessage.vue`, plus prompt, workflow status, reasoning, tool-call, modal, and welcome-card controls. Exclude message and attachment content layout. |
| 6 | Documents | `ToolbarButton.vue`, `DocumentEditorRoot.css`, `DocumentAiPanel.vue` and `.css`, `DocumentAiPromptEditor.vue`, `DocumentTableToolbar.vue`, history, inspector, search, lazy host, and image node. Review `!important` and mobile rules manually. |
| 7 | Search/commands | `CommandPalette.vue`, `CommandPaletteFilters.vue`, `CommandPaletteResultList.vue`, `ActionTray.vue`, and `Preview.vue`. Keep keyboard and virtual-scroll geometry stable. |
| 8 | Theme Studio/dashboard | `Dashboard.vue`, `ThemePage.vue`, `BackgroundLayerEditor.vue`, `AiPage.vue`, and the theme section components. Swatches and previews remain visual unless their wrapper is interactive. |
| 9 | Admin/onboarding | Admin shared components, `pages/admin/`, `layouts/admin.vue`, `pages/connect.vue`, `pages/wizard/`, and `pages/openrouter-callback.vue`. Prefer shared primitive mappings over duplicate leaf edits. |
| 10 | Remaining product surfaces | External agents, activity, notifications, model catalog, images, first-party plugin surfaces, and shipped-theme component overrides. Retro-specific density may need explicit theme values. |

### High-risk density cases

- `DocumentAiPanel.vue` currently forces 28/30px buttons at mobile widths. An
  implementation must enlarge the hit wrapper or explicitly justify an
  accessibility exception; changing the glyph alone is incorrect.
- Workspace tab and chrome heights participate in layout calculations. Update
  the controlling variable and every dependent calculation together.
- Compact command-palette rows affect result count and scrolling. Verify both
  keyboard navigation and virtual list measurements.
- `h-full` children such as `SidebarProjectChild.vue` inherit their target size
  from a parent row and should not receive an independent fixed height.

## Focus Inventory

### Proposed contract

```css
--app-focus-ring-width
--app-focus-ring-offset
--md-focus-ring
```

The theme authors the color; the user may choose only a constrained width. The
offset may be zero or inset for cramped controls rather than globally fixed.

### Migration families

1. Migrate shared configs first: `app/app.config.ts`, Blank and Retro
   `app.config.ts`, and Blank theme definitions.
2. Migrate direct keyboard navigation: admin layout/navigation, sidebar page
   links, mobile bottom navigation, sidebar header controls, external-agent
   navigation, image gallery actions, and admin creation flows.
3. Review container-focus special cases in `ChatComposerShell.vue`,
   `ChatSettingsPopover.vue`, `DocumentImageNode.vue`, and
   `ChatInputDropper.vue`.
4. Keep `outline: none` only where an equivalent `:focus-within` container
   indicator remains visible. Known review sites include
   `DocumentEditorRoot.css`, `MessageEditor.vue`,
   `DocumentAiPromptEditor.vue`, and `ExternalAgentComposer.vue`.
5. Migrate authored Blank/Retro theme sources, then compile generated output.

### Focus verification gates

- Keyboard traversal in Blank, Retro, and Cyberpunk, light and dark.
- Visible indicator at 200% zoom and in high-contrast/forced-color conditions.
- No focus ring clipped by modal, menu, mobile navigation, or scroll containers.
- Retro must receive an equivalent visible treatment where its current config
  suppresses generic rings; suppression alone is not an exemption.

## Motion Inventory

### Proposed contract

```css
--app-motion-duration-fast
--app-motion-duration-medium
--app-motion-duration-slow
--app-motion-easing-standard
```

The initial user preference should be **System** or **Reduced** only. A global
Off mode is deferred because only six source locations currently protect
reduced motion, while several animations communicate progress or state. The OS
reduced-motion preference always wins.

### Existing reduced-motion coverage

- `DocumentEditorRoot.css`
- `DocumentAiPanel.css`
- `ChatComposerShell.vue`
- `LoadingGenerating.vue`
- `WorkspaceTabBar.vue`
- `ChatSettingsPopover.vue`

### Classification

| Class | Treatment | Representative sources |
|---|---|---|
| Functional progress | Preserve understandable status; use a still/text alternative in Reduced | Connect/OpenRouter pages, workflow execution presentation, tool-call indicators, external agents, admin skeletons |
| Functional state transition | Shorten to near-instant rather than remove the state change | Admin drawer/sidebar, document editor and AI panel, model catalog, tabs, documentation navigation, wizard progress |
| Decorative interaction | Use duration tiers and stop/reduce under preference | Gallery, sidebar hover/expand, notifications, catalog cards, scrollbar/sidebar transitions, composer hover |
| Brand/decorative loader | Preserve status copy and stop decorative loops in Reduced | `LoadingGenerating.vue`, reasoning accordion, message editor, tab animations |
| Explicit exemption | Keep local behavior, outside app appearance control | Example Snake game animation |

Avoid migrating `transition-all` as-is. Replace it with the specific animated
properties while touching each component, so unrelated property changes do not
begin animating.

## Elevation Inventory

### Proposed contract

```css
--app-elevation-low
--app-elevation-medium
--app-elevation-high
```

Every consumer retains its literal current shadow as the fallback. Flat removes
generic depth but must retain an opaque surface and visible border for overlays.

### Generic consumers

| Tier | Consumer families |
|---|---|
| Low | Shared tree/select/card/toast config, sidebar links/header input, chat attachments, external-agent cards, wizard cards, document toolbar |
| Medium | Connect/admin elevation consumers, chat composer ambient shadow, mobile FAB, document AI panel/card, ordinary page cards |
| High | System prompt and chat modals, welcome/config cards, mobile sheets, admin drawer, external-agent dialogs, document overflow/selection/slash menus and overlays |

### Elevation exemptions

- Focus rings, selected-state inset borders, resize-handle glows, drag feedback,
  and Theme Studio selection outlines.
- Retro hard-offset/pressed effects and Blank's intentional no-shadow/inset
  treatments.
- Theme-owned workspace tab shadows (`--or3-tab-shadow*`).
- Text shadows, loader glows, filter/backdrop blur, documentation prose chrome,
  demo-plugin effects, and plugin-runtime code whose domain term is “shadow.”
- Decorative lock-page/logo depth unless product design explicitly chooses to
  expose it.

### Elevation risks

- Five current product consumers reference undefined `--md-elevation-*`
  variables. Capture their baseline computed style before mapping them to the
  new tokens; do not infer a one-to-one tier from the old name.
- Tailwind `shadow-*` utilities do not provide the required local fallback.
  Use an explicit arbitrary shadow value only in the manually reviewed
  consumer.
- The workflow bridge contains `!important`; changing only root variables will
  not affect it unless the bridge aliases the generic tokens deliberately.
- Do not replace a `box-shadow` transition with one static elevation value when
  focus, hover, and rest shadows have different semantic jobs.

## Deliberate Implementation Sequence

1. Capture override-free computed-style baselines for representative controls
   in all shipped themes and both color modes.
2. Add typed contracts, validation, root defaults, pure preset mappers, and
   set/remove tests. Do not expose editor controls yet.
3. Migrate `app/app.config.ts` and theme configs because they have the broadest
   leverage.
4. Migrate sidebar and workspace chrome; verify desktop and coarse-pointer
   targets before continuing.
5. Migrate chat and document toolbars, including the high-risk document mobile
   controls.
6. Migrate command palette, Theme Studio, dashboard, admin, wizard, and connect
   flows.
7. Migrate external agents, activity, notifications, model catalog, images,
   and bounded first-party plugin surfaces.
8. Migrate authored Blank/Retro/Cyberpunk sources, preserve recorded theme
   exceptions, and regenerate theme output.
9. Run the shipped-theme desktop/mobile Playwright matrix and keyboard/reduced
   motion checks.
10. Re-run the repository audit. A Theme Studio control may ship only after at
    least 90% of its identified consumers are migrated and every remainder has
    an explicit exemption or follow-up owner.

## Per-Family Patch Checklist

For each implementation batch:

1. Read the component, its parent layout, its theme overrides, and its tests.
2. Classify each candidate as a token consumer, semantic exception, visual-only
   dimension/effect, generated artifact, or third-party boundary.
3. Patch only the reviewed consumers with `apply_patch`.
4. Inspect the diff for accidental changes and unresolved fallback syntax.
5. Run the narrowest related unit/component test.
6. Verify the representative desktop and mobile UI in Blank, Retro, and
   Cyberpunk before starting the next family.
