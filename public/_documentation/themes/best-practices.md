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

## Contexts

Auto-detection only covers `chat`, `sidebar`, `dashboard`, and `header`. For
other areas, add `data-context="..."` on a wrapper element.

## Testing

- Run `bun run theme:validate` to catch schema and selector issues.
- Use visual regression tests for major UI areas.
- Verify dark mode if you ship `colors.dark`.
