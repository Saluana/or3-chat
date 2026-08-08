# useSidebarProjectActionButtonProps

Theme-aware props for project tree action buttons in the sidebar. It resolves overrides for a given button identifier and merges them with a neutral popover-style default.

## Purpose

`useSidebarProjectActionButtonProps(options)` returns a computed props object ready for a `UButton`:

-   Defaults: `color: 'neutral'`, `variant: 'popover'`, `size: 'sm'`.
-   Optional `icon` and `className` are included when provided.
-   Theme overrides from the `sidebar` context with the given identifier are merged on top.

Options: `{ identifier: string; icon?: string; className?: string }`.

## Usage

```ts
import { useSidebarProjectActionButtonProps } from '~/composables/sidebar/useSidebarProjectActionButtonProps';

const props = useSidebarProjectActionButtonProps({
    identifier: 'project-tree.action',
    icon: 'i-ph-dots-three',
});
```

## Notes

-   Overrides win over defaults, so themes can restyle any action button.

## Related

-   `useThemeResolver` — the override engine.
-   `useProjectTreeActions` — the actions rendered with these props.
