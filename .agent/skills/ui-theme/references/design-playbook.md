# OR3 UI Design Playbook (Pro, Retro-Compatible)

Use this file when the task is "make this UI look pro", you are designing a new surface, or you need a critique checklist before shipping.

## 1) The Loop (Do This Every Time)

1. Define the job:
   - Who is this for? What's the primary action?
   - What "done" looks like (speed, calmness, delight, density).
2. Enumerate states:
   - Default, hover/active, focus-visible, disabled.
   - Loading, empty, error, success.
3. Pick a density:
   - Compact: power-user lists, heavy scanning.
   - Normal: default OR3 feel.
   - Cozy: onboarding, sparse dashboards, marketing-like screens.
4. Design in grayscale first:
   - Layout and hierarchy should work without color.
   - If it needs color to be understandable, hierarchy is missing.
5. Commit to a type scale:
   - Use fewer sizes; make size jumps meaningful.
   - Use weight and opacity as secondary hierarchy tools.
6. Commit to a spacing system:
   - Use consistent increments (4/8/12/16/24/32).
   - Increase whitespace before adding borders and chrome.
7. Apply OR3 theming primitives:
   - Prefer Nuxt UI variants (`app/app.config.ts`) and theme-level `ui` patches.
   - Use `v-theme` + identifiers so styles stay themeable.
8. Polish and QA:
   - Keyboard and focus rings, contrast, truncation, scroll behavior.
   - Subtle motion only where it clarifies change (respect reduced motion).

## 2) Visual Direction: Borrow From References Without Copying

When given screenshots (like the examples uploaded), extract 3-5 transferable decisions:

- Typography: size jump, weight, letter spacing, line height, casing.
- Layout: margins, grid, alignment, content width, rhythm.
- Depth: borders vs shadows, softness, layering, glass/blur.
- Background: flat vs pattern vs gradient, contrast level.
- Interaction: hover affordance, selection state, "clickability".

Then translate those into OR3-compatible primitives (tokens, variants, overrides).

## 3) OR3 Retro Taste Rules (So It Doesn't Get Generic)

- Prefer hard borders + restrained shadows over soft "SaaS blur everywhere".
- Keep backgrounds subtle; patterns should be low-contrast and never compete with content.
- Make "icon-only" actions square and perfectly centered.
- Avoid accidental "default Tailwind app" vibes:
  - Too many grays with no accent plan
  - Inconsistent radius and shadow language
  - Random gaps between siblings

## 4) Micro-Checklist (Before You Call It Done)

- One clear primary action per surface.
- Titles are bigger than body copy (and actually look like titles).
- Spacing aligns to a simple scale (no 13px, 19px, 27px chaos).
- Hover/active/focus-visible are all present and consistent.
- Selected state is obvious (not just a 1px color shift).
- Empty states give a next action, not just "nothing here".
- Loading states don't jump layout (reserve space).
- Contrast is readable in both light/dark and with patterns enabled.

## 5) Practical Mapping Into Theme System

When a change should be themeable, prefer:

1. Nuxt UI variant config (`app/app.config.ts`) for shared component styling.
2. Theme `overrides` with selectors (`button.chat`, `button#chat.send`).
3. Theme `cssSelectors` for third-party DOM roots (Monaco, TipTap, portals).
4. Only then: component-local classes (keep them structural, not "brand").
