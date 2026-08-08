# useTypedThemeOverrides

Type-safe wrappers around `useThemeOverrides` for common component types. Each wrapper merges base props with resolved theme overrides.

## Helpers

| Helper | Component | Props type |
| ------ | --------- | ---------- |
| `useButtonOverrides(params, baseProps?)` | Nuxt UI `UButton` | `NuxtUIButtonOverrides` |
| `useInputOverrides(params, baseProps?)` | Nuxt UI `UInput` | `NuxtUIInputOverrides` |
| `useTextareaOverrides(params, baseProps?)` | Nuxt UI `UTextarea` | `NuxtUITextareaOverrides` |
| `useModalOverrides(params, baseProps?)` | Nuxt UI `UModal` | `NuxtUIModalOverrides` |
| `usePlainOverrides(params, baseProps?)` | Plain (non-Nuxt UI) elements | `PlainElementOverrides` |

All take a `ResolveParams` (`{ component, context, identifier, state? }`) and return a computed of merged props. Theme overrides win over the base props.

## Usage

```ts
import { useButtonOverrides } from '~/composables/useTypedThemeOverrides';

const sendProps = useButtonOverrides(
    { component: 'button', context: 'chat', identifier: 'chat.send' },
    { square: true, size: 'sm', color: 'primary', variant: 'solid' }
);
```

```vue
<UButton v-bind="sendProps">Send</UButton>
```

## Notes

-   The underlying `useThemeOverrides` call always sets the matching `isNuxtUI` flag for you.

## Related

-   `useThemeResolver` — the raw resolution API.
-   `useChatInputTheme` — a larger bundle built from these wrappers.
