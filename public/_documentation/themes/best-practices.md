# Best Practices

Guidance for maintainable, performant themes.

## Naming

- Theme names: kebab-case (`ocean-dark`).
- Identifiers: semantic and scoped (`chat.send`, `sidebar.new-chat`).
- Contexts: reuse known contexts or add `data-context` explicitly.

## Selector strategy

Start broad and only add specificity as needed:

```ts
overrides: {
  button: { variant: 'solid' },
  'button.chat': { variant: 'ghost' },
  'button#chat.send': { color: 'primary' },
}
```

Use attributes or states only when needed. State selectors (`:hover`, `:active`)
only match when you pass `state` to the resolver manually.

## Choose the correct component boundary

Use `useThemeOverrides()` with `v-bind` for Vue component props. Use `v-theme`
for DOM classes, inline style declarations, identifiers, and target annotations.

```vue
<script setup lang="ts">
const sendTheme = useThemeOverrides({
  component: 'button', context: 'chat', identifier: 'chat.send', isNuxtUI: true,
});
</script>
<UButton v-bind="sendTheme" v-theme="'chat.send'">Send</UButton>
```

Keep dynamic props (disabled/loading/etc.) explicit.

## Prefer overrides over inline styles

Inline styles bypass the theme system. Prefer overrides or Tailwind classes
in theme definitions.

## cssSelectors usage

Use `cssSelectors` for:

- third-party widgets (Monaco, TipTap)
- portal/teleport roots (modals, tooltips)
- legacy DOM that cannot be refactored

Prefer `style` (build-time) for static properties and `class` for Tailwind
utilities.

## Performance

- Keep overrides minimal and meaningful.
- Prefer context-level overrides over per-component identifiers.
- Reuse resolver instances via `useThemeResolver`.
- Use `useThemeOverrides` for reactive resolution instead of recomputing.

## Mobile editable controls

Mobile Safari and other touch browsers may zoom focused editable controls when
their computed font size is below `16px`.

- Keep text-like `input`, `textarea`, `select`, and contenteditable surfaces at
  least `16px` on touch devices.
- Theme app-config variants are not sufficient by themselves because raw DOM
  controls, portal content, and third-party editors can bypass them.
- Use a theme-scoped touch media query as the final enforcement layer while
  preserving compact desktop typography.
- Do not disable browser zoom with `maximum-scale` or `user-scalable`; users
  must retain page-zoom accessibility.

## Mobile control sizing

For the built-in touch presentation, use a 44px minimum hit region for buttons,
menu items, tabs, switches, and text-like form controls. This follows Apple's
44×44pt guidance and works because CSS pixels map closely to iOS layout points
in a correctly configured viewport.

- Keep the 44px requirement inside touch/mobile media queries so compact
  desktop layouts remain unchanged.
- A control's visible icon may be smaller than 44px, but its interactive region
  must not be.
- Use 16–17px for primary control and navigation labels, and at least 16px for
  editable text on mobile. Supporting labels may be smaller, but keep ordinary
  supporting copy at or above 12px and use adequate contrast.
- Use 20–24px visible icons inside the larger hit region. Primary navigation
  rows can be 48–56px tall while secondary inline actions stay visually
  compact.
- Preserve at least a small visual gap between adjacent hit regions to reduce
  accidental taps.
- Theme-level rules must cover portal content and raw DOM controls; component
  overrides with fixed `!important` dimensions need their own mobile rule.

## Contexts

Auto-detection only covers `chat`, `sidebar`, `dashboard`, and `header`. For
other areas, add `data-context="..."` on a wrapper element.

## Embedded plugin panes

Use host surface, text, border and primary color tokens for pane controls; keep game-world colors separate from interface colors. Set an explicit `data-context` on custom plugin roots. Prefer container queries for inspector layouts: a wide browser can still contain a narrow split pane.

Give a pane sidebar `min-height: 0` and a dedicated scrolling navigation region when it has a persistent action footer. Verify that the host's overflow boundaries cannot clip lower actions. Canvas containers need a definite height so intrinsic bitmap dimensions do not stretch their surrounding controls. Test both host themes, a narrow pane, keyboard focus and any independently exported shell.

## Responsive chat

Chat uses the same 768px boundary as Tailwind's `md:` utilities: mobile is below
768px, and tablet presentation starts at 768px. Drawers close when entering
mobile presentation, keep focus within the open navigation, and restore focus
to the trigger after dismissal. Closed drawers are inert.

Composer drafts and attachment previews have separate scrolling regions capped
by their chat pane height (`cqh`), with smaller shared limits when both are present
on short panes. The application frame follows the unzoomed visual viewport on
touch devices so Safari keyboard opening and panning do not cover the composer.
Nested page shells inherit that frame height; do not restore `100dvh` on them. Attachment grids size themselves to their pane, and Blank's
compact composer places controls below the editor when its container is narrow.
When the visible application frame is shorter than 140px, the composer uses a
single row with 44px controls and temporarily hides optional chrome and preview
grids. Drafts and attachment selections remain intact. Preserve these bounds
when overriding a composer. Show message actions and
attachment removal on touch devices; hover can remain an enhancement on desktop.

Run `bun run test:e2e:theme-tokens --grep 'chat responsive layout' --reporter=dot`
for the phone, tablet, desktop, landscape, reduced-height and split-pane matrix.
Run `bun run test:e2e:journeys --grep 'responsive messages' --reporter=dot` for
deterministic rich-message rendering and touch editing. Both attach screenshots
to the Playwright results.

## Testing

- Run `bun run theme:validate` to catch schema and selector issues.
- Use visual regression tests for major UI areas.
- Verify dark mode if you ship `colors.dark`.
