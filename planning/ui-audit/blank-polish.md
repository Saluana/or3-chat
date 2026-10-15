# UI audit: Blank theme pre-launch polish

Subtle, token-first polish for the Blank theme. Painted control sizes from the
earlier audit (composer 32px buttons, sidebar rows, mobile tab controls) are
unchanged. Before/after evidence: [audit-evidence/blank-polish-20261014](../../audit-evidence/blank-polish-20261014/README.md).

## Findings and changes

| Criterion | Finding | Change |
| --- | --- | --- |
| Hover and transitions | The composer used 200–250ms transitions with an overshooting send-button hover (`scale(1.08)`), the message action bar used a literal 0.15s fade, and the theme easing was plain `ease`. | All Blank transitions use `--app-motion-duration-fast` (120ms) with `easingStandard: cubic-bezier(0.2, 0, 0, 1)`. Send/stop hovers soften the fill instead of growing. Attach/settings hovers use a translucent on-surface overlay that reads on the pill in both modes. |
| Spacing scale | Off-scale values: user bubble 12/18px, code header 8.8/12px, code body 14.4/16px, section cards 20/16px, sidebar link gap 6.4px, tool summary gap 10px. | Moved to the 4/8/12/16/24 scale. |
| Micro-interactions | Nuxt UI buttons had no press feedback. | Blank buttons scale to 0.98 on press (`scale`, which composes with positioning transforms). It is disabled under OS reduced motion and the in-app Reduced preference. Composer buttons keep their own, slightly deeper press. |
| Alignment | The sidebar search sat 4px left of and 8–12px wider than the list rows (conflicting `#nav-header` rules in `styles.css` and the compiled selectors). Dashboard page headers, landing cards and page frames sat 4–8px off the modal title in every theme. | `#nav-header` has one owner and reserves the list's scrollbar gutter, so its edges match the rows on every OS. Dashboard header, landing grid and `.dashboard-page-frame` use the modal gutter (24px, 16px under 640px). |
| Borders, corners, shadows, surfaces | Every radius tier resolved to 10px, alongside literal 6/8/9/12/14/18px values. Light mode inherited the blue-tinted Material container ladder and `outline-variant`. Dark floating menus used 10% black shadows (invisible on charcoal), and document menus used on-surface shadows that glowed white in dark mode. Table cells drew `currentColor` lines (black/white). | Radius tiers are 8/10/14px (controls inset 6px inside surfaces), and theme literals map to the tiers. Neutral container ladder and `outlineVariant` are theme tokens in both modes. Dark elevation tokens are deeper, and dark `shadow-lg/xl/2xl` retarget `--tw-shadow` only. Theme literal shadows use elevation tokens. Table lines use `--md-border-color` in all themes. |
| Loading states | The pending reply showed a 58px blue scanline banner with "GENERATING" in a pixel font. The sidebar header skeleton was a square 32px bar standing in for a rounded 40px field. | Blank renders three 6px dots in the text column (28px). The skeleton matches the field's height and radius. |
| Typography | Chat/document prose used hard-coded IBM Plex while the rest of Blank used the system stack (and ignored the Theme Studio body font). Code used Courier New. The composer was 15.6px against 16px messages. Tooltips were a fixed 36px/14px box. Sidebar timestamps were 10px proportional digits. | Prose follows `--app-font-sans-current`/`--app-font-heading-current` with -0.01em headings. Code uses a new `fonts.mono` token. The composer is 16px with message letter-spacing. Tooltips are auto-height (28px min) at 13px medium. Timestamps are 11px tabular. |

A theme-independent bug was also fixed: the composer's `prefers-color-scheme:
dark` block restyled the light theme whenever the operating system was dark.
Token-based colors replace it.

## Global changes (all themes benefit)

- `or3-prose.css`: table lines use the theme border token (Retro unchanged visually; Cyberpunk inner lines now match its cyan frame).
- `Dashboard.vue` and `.dashboard-page-frame`: content aligns with the shared AppModal header gutter.
- `SideNavContent.vue`: header skeleton matches the field shape.

## Deliberately unchanged

- AppModal header and 44px close geometry, which is unified across themes by design.
- Composer and sidebar painted sizes, and the composer focus ring.
- Light-mode floating menus keep the stock `shadow-lg` users already see.
- The agent connections modal keeps its bespoke palette; only its radii follow the tiers.

## Verification

- `bunx vitest run app/theme` (18 files, 139 tests) and `bun run test:changed` pass.
- Playwright `theme-token-migrations.spec.ts` against the journey-harness server: 45 of 60 pass across all three themes (UI audit, drafts/split panes, touch controls, focus traps, composer layouts, appearance tokens, icons). The other 15 (`dialogs follow Safari keyboard…`, `dialogs fit phones…`, `image preview…`, `nested prompt confirmation…`) fail identically on the base commit. They wait for a "Create your first project" sidebar button that a fresh workspace doesn't show, or for a command-palette "Result actions" group. This PR refreshes the Theme Studio selectors, which had stopped every appearance-token case and the icon test before their assertions.
- ESLint on the changed TypeScript and `git diff --check` are clean. `bun run theme:build-css` matches the committed `public/themes/blank.css`.
