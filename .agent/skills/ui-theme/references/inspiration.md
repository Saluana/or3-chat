# UI Inspiration References (High-Signal)

Use this file when you need a visual direction, want to sanity-check taste, or need to explain design choices with concrete examples.

## What To Borrow From The Provided Examples

- Retro OR3 layout: strong outlines, clear zones, subtle patterned background, lots of whitespace. Good model for "friendly utility" UIs.
- Notion marketing page: oversized headline, quiet cards, gentle gradients, and calm spacing. Good model for landing/empty-state sections.
- Linear dark UI: premium contrast control, layered depth, and dense-but-readable typography. Good model for high-density panes and inspector panels.

## Product UI (Dense, Premium)

- [Linear](https://linear.app/): density without clutter, crisp hierarchy, subtle depth, strong typography.
- [Raycast](https://www.raycast.com/): tight spacing, predictable interactions, great keyboard-first affordances.
- [Figma](https://www.figma.com/): clear tool hierarchy, panels, and selection states.
- [GitHub](https://github.com/): information-heavy layouts with consistent patterns.

## Marketing UI (Big Type, Airy Layouts)

- [Notion](https://www.notion.so/): generous whitespace, large headlines, simple cards, calm palette.
- [Stripe](https://stripe.com/): strong typography, structured sections, gradients used with restraint.
- [Vercel](https://vercel.com/): modern layout rhythm, purposeful motion, clear CTA hierarchy.

## Design Systems (Rules, Tokens, Accessibility)

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/): hierarchy, clarity, interaction patterns.
- [Material Design 3](https://m3.material.io/): color roles, states, elevation, component guidance.
- [Shopify Polaris](https://polaris.shopify.com/): pragmatic patterns, content hierarchy, component anatomy.
- [Atlassian Design System](https://atlassian.design/): dense enterprise UX patterns, accessibility guidance.
- [GitHub Primer](https://primer.style/): tokens, component patterns, pragmatic UI constraints.

## UX Heuristics (Fast Sanity Checks)

- [Nielsen Norman Group](https://www.nngroup.com/): interaction heuristics, usability patterns, research-backed guidance.
- [Laws of UX](https://lawsofux.com/): quick mental models for layout, hierarchy, and behavior.

## How To Use These References In OR3

1. Pick 1 primary reference for typography and spacing.
2. Pick 1 secondary reference for depth/background.
3. Translate decisions into OR3 primitives:
   - Nuxt UI variants (`app/app.config.ts`)
   - Theme overrides (`app/theme/*/theme.ts`)
   - Theme backgrounds and patterns (keep contrast low)
