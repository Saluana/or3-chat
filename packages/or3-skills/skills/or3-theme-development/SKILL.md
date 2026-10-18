---
name: or3-theme-development
description: Create, update, validate, package, or troubleshoot OR3 visual themes and supported component overrides.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout and Bun for the theme commands.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OR3 theme development

Use the least invasive supported theme layer that achieves the requested visual outcome.
Read the relevant theme guide and inspect existing target identifiers and variants through [repository navigation](../../shared/repository-navigation.md).

- Prefer tokens, fonts, icons, backgrounds, Nuxt UI recipes, and scoped overrides before component replacement or core changes.
- Preserve semantic tokens, component identifiers, active-theme appearance, and caller contracts.
- Use `v-theme` for DOM decoration and `useThemeOverrides()` for component props; use current context/selector rules.
- Keep styles/assets local to the theme and avoid global CSS, brittle selectors, or component forks that bypass supported contracts.
- Verify affected light/dark modes, responsive layouts, interaction states, keyboard focus, contrast, reduced motion, and mobile input/touch usability.
- Declarative themes contain no executable code; identify executable files and trust when a trusted-code theme is needed.
- `bun run theme:create` creates a source `theme.ts` scaffold, not a ready declarative package.

Run `bun run theme:validate` and `bun run theme:build-css` when selector styles change.
Use the focused visual/component harness when rendered behavior changes, and inspect manifest/archive contents before claiming package installability.

Use the checkout's `public/_documentation/themes/` guides for API, styling, component overrides, and installation.
An unsupported behavior/layout contract belongs in core development rather than a hidden CSS workaround.

See [quality gates](../../shared/quality-gates.md), [permissions and trust](../../shared/permissions-and-trust.md), and [completion guidance](../../shared/completion-contract.md).
