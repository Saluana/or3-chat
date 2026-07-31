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

## Use v-theme everywhere

If a component should be themed, add `v-theme`. Remove hardcoded props that the
theme is responsible for.

```vue
<UButton v-theme="'chat.send'">Send</UButton>
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

## Contexts

Auto-detection only covers `chat`, `sidebar`, `dashboard`, and `header`. For
other areas, add `data-context="..."` on a wrapper element.

## Testing

- Run `bun run theme:validate` to catch schema and selector issues.
- Use visual regression tests for major UI areas.
- Verify dark mode if you ship `colors.dark`.
