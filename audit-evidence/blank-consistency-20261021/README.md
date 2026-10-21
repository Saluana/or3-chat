# Blank theme consistency pass — before / after

Base: `5421d32d` (untouched Blank). After: the working tree with this change. Both were captured
by the same script (`harness/capture.mjs`) in Chromium at 1440×900 (phone: 390×844, 2× scale)
against the local journey harness with a scripted chat stream, so every frame is reproducible.
The Nuxt DevTools pill and missing Iconify glyphs (offline harness) appear in both sides.

`pairs/` holds 37 side-by-side images (BEFORE left, AFTER right). `measurements.txt` holds the
numbers below plus the computed-style review.

## Root causes (fixed once, not per rule)

1. **Rules that never applied.** The theme stylesheet is attached to `<head>` at activation and
   component-scoped CSS arrives with its chunk, so a bare `[data-theme]` selector *ties* with
   `.component[data-v-…] x`. Blank's code-block header, code size, language label, `--or3-prose-*`
   colours, paragraph line-height, the "+" tab chip and the section-arrow rule all lost that tie.
   The top-level block now hangs off `html[data-theme='blank']` like the theme docs prescribe.
2. **Specs that disagreed with their shell.** `formField` was defined twice (one copy never
   consumed), `ui.modal` described an 18/400 title and a 36px close that `AppModal` overrides,
   the composer buttons were specced 36px but rendered 32px, and the user bubble had two radii.
   Dead copies were removed or aligned to what renders.
3. **No scale.** 20 distinct text sizes, six weights (400/500/550/600/650/700), sub-pixel rems
   from shared pages (`0.78rem`, `0.82rem`, `0.9rem`), and fractional line-heights. The theme now
   declares one ladder as `--blank-*` variables and every rule consumes it.

## The scale

| Axis | Steps |
| --- | --- |
| Type | caption 12 / body 14 / message 16 / title 20 (code 13; prose headings 24 / 20 / 18 / 16) |
| Weight | 400 · 500 · 600 |
| Radius | 6 chips · 8 controls · 10 rail & tabs · 14 cards & dialogs · 20 bubble & empty-state cards · 28 composer; inner radius = outer − gap |
| Controls | 32 · 36 · 44 (density tokens) + the 40px rail slot |
| Sidebar | one 14px content inset: section labels, page-link icons, project and chat row icons share a left edge; rows are exactly 36px |
| Fields | one 12px horizontal inset for input, select, menu and textarea; labels 14/500, help 12 |

## Measured result (24 screens, `measurements.txt`)

| | Before | After |
| --- | --- | --- |
| Distinct text sizes | 20 | 9 (the extras are icon-only buttons and 13px code) |
| Distinct weights | 6 | 3 (400 / 500 / 600) |
| Text runs with fractional line-height | 400 | 27 |
| Sidebar chat row height | 33.5px | 36px |

## Pairs

| Files | What to look at |
| --- | --- |
| `d01` `d02` `e01` `e02` | Message type 16/26 for both speakers, tight 6px list rhythm, neutral quote bar, 20/18 headings, inline-code chip, table cells on 14/20, code block with Blank's own 12px header, 13/21 code and 24px copy buttons, 20px bubble radius |
| `d03` `d22` `d23` `d24` | Sidebar grid, 36px rows, "+ New" at label size, 14/600 page links, section label sentence case |
| `d04` `m06` | Tab titles 14/500; mobile tab switcher title 20/600 and 12px count |
| `d06` `m01` | Empty state: 14/12 card type, 20px cards, concentric panel/card radii on phones |
| `d07` – `d12` | Settings pages: 20/16/14/12 hierarchy, 14px labels over 12px help, one field inset, flat sections with no residual card shadow, 20px Images title, aligned back chevron, tabs on 36px |
| `d13` | Command palette: 14/12 rows, sentence-case section labels |
| `d14` `d19` `d20` | Chat-settings popover on the ladder (no 550/650 weights); model catalog and system prompts use sentence-case labels |
| `d15` `d16` `d21` | Row menu, tooltip (12px), account menu |
| `d17` `d18` | Tool-call card detail on 12px; document editor chrome inside the new sidebar |
| `k01` – `k03` | Dark mode follows the same sizes |
| `m03` – `m05` `m07` | Phone: drawer on the same grid, project and chat rows both 16px, bottom-nav labels 12px with no clipping, More sheet in sentence case, nothing under the 12px floor |

## Behaviour that changed on purpose

* Open sidebar sections show their arrow only on hover or focus (the rule was always in the file).
* The workspace "+" tab is a quiet borderless chip (also an existing rule that never applied).
* The base `.theme-btn` reset no longer overrides a component's explicit border (tab switcher
  "New tab" keeps its outline).

## Verification

* `bunx vitest run app/theme` — 17 files / 124 tests, including the new `design-scale.test.ts`
  guard (no text under 12px, whole-pixel sizes, 400/500/600 only, `html[data-theme]` anchoring).
* `nuxt typecheck` under the CI profile — passes.
* `test:e2e:theme-tokens` — Retro and Cyberpunk unchanged; `public/themes/retro.css` and
  `cyberpunk.css` regenerate byte-identical. Five failures are identical on `5421d32d` (sign-in
  label ×2, composer visual-viewport, theme-icon hydration ×2). Two assertions that pinned the old
  16.25px tab-title line-height now take the expected value per theme.
* `command-palette.spec.ts` — 7/7.
* Computed-style review: every non-typographic, non-geometric difference across 3,095 elements was
  checked (`measurements.txt`); the one regression it found (sidebar rows gaining a transparent
  1px border) was fixed.

## Not rendered here

The agent-connections dialog (`or3-plugin-external-agents`) and the Document AI review hunks need
fixtures this checkout does not have. Their literal values were snapped to the same grid and
ladder without changing selectors or colours, so please eyeball them.

## Reproduce

See the header of `harness/capture.mjs`. Capture the base commit and the change into two folders,
then run `compose.mjs`, `snapshot-diff.mjs` and `summary.mjs`.
