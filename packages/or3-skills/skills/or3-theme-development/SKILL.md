---
name: or3-theme-development
description: Create, modify, validate, package, or troubleshoot OR3 Chat themes and supported visual overrides. Use for branding, colors, typography, spacing, icons, backgrounds, visual density, and presentation-only component changes.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout and Bun for the theme commands.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OR3 theme development

## Purpose

Change OR3's visual presentation through the documented theme system while
preserving accessibility, responsive behavior, and component contracts.

## When to use

Use for colors, typography, spacing, icons, backgrounds, visual density, and
presentation-only component changes. Do not use for a new command, pane,
integration, installation, or an unsupported layout contract; route those with
the [extension decision tree](../../shared/extension-decision-tree.md).

## Required first steps

1. Read [repository navigation](../../shared/repository-navigation.md).
2. Read the theme quick start and only the API, component-override, selector,
   or packaging documentation needed by the request.
3. Inspect the target component and its existing `v-theme`, theme identifiers,
   Nuxt UI variant, and visual-state coverage before changing styles.

## Escalation

Use the least invasive supported layer in this order:

1. Theme tokens, fonts, icons, and backgrounds.
2. Existing Nuxt UI or supported component theme configuration.
3. Scoped overrides and documented selectors.
4. Declarative theme package.
5. Documented component override or trusted wrapper.
6. A new core theme contract only when the above cannot express the result.

Do not copy a core component merely to change tokens, spacing, or selectors.
If executable theme code is necessary, identify every executable file and why a
declarative theme cannot satisfy the request.

## Workflow

1. State the requested visual outcome, target surfaces, light/dark behavior,
   breakpoints, and interaction states.
2. Use `bun run theme:create` for a new in-checkout theme when applicable.
   Preserve semantic tokens and component identifiers; do not introduce a
   parallel styling system.
3. Use `v-theme` for DOM decoration and `useThemeOverrides()` for component
   props where the public docs prescribe them. Keep custom stylesheet paths
   local to the theme.
4. Check default, hover, active, focus-visible, disabled, loading, empty, and
   error states in both color modes; verify keyboard focus, contrast, reduced
   motion, mobile touch targets, and 16px editable text on mobile.
5. Run `bun run theme:validate`; additionally run `bun run theme:build-css`
   when changing `cssSelectors` styles. Use the checkout's targeted visual or
   component checks when the change reaches a rendered surface.
6. For a packaged theme, inspect its manifest and archive contents before
   describing it as installable. Report executable code and trust tier.

## Failure handling

If the documented theme API cannot express a required behavioral or layout
change, explain the exact missing contract and route to core development. Do
not use global CSS, brittle selectors, or a component fork as an invisible
substitute for that decision.

## Completion output

Follow the [completion contract](../../shared/completion-contract.md). Include
the theme layer chosen, affected states/modes, executable files or `None`,
validation, package/install status, and the restoration path.

## References to load

- [Quality gates](../../shared/quality-gates.md)
- [Permissions and trust](../../shared/permissions-and-trust.md)
- `public/_documentation/themes/quick-start.md`
- `public/_documentation/themes/api-reference.md`
- `public/_documentation/themes/component-overrides.md`
- `public/_documentation/themes/best-practices.md`
