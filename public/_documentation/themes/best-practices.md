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
- Use 16px for editable and control text on mobile. Supporting labels may be
  smaller, but keep them at or above 12px and use adequate contrast.
- Preserve at least a small visual gap between adjacent hit regions to reduce
  accidental taps.
- Theme-level rules must cover portal content and raw DOM controls; component
  overrides with fixed `!important` dimensions need their own mobile rule.

## Contexts

Auto-detection only covers `chat`, `sidebar`, `dashboard`, and `header`. For
other areas, add `data-context="..."` on a wrapper element.

## Testing

- Run `bun run theme:validate` to catch schema and selector issues.
- Use visual regression tests for major UI areas.
- Verify dark mode if you ship `colors.dark`.
