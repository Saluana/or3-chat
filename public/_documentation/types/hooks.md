# Hook types

The typed hook map and augmentation contract are maintained with the hook API in [Hook reference](/documentation/hooks/reference). Start there for typedOn, typedFilter, listener cleanup, payload tuples, and adding a typed hook.

| Contract | Host source import |
| --- | --- |
| Hook payload maps and entity/payload types | `~/core/hooks/hook-types` |
| Typed registration helpers | `~/core/hooks/typed-hooks` |
| Runtime hook engine | `~/core/hooks/useHooks` |

Import the actual declarations rather than copying interfaces here. Check the [hook catalog](/documentation/hooks/hook-catalog) for the event and its call site; similar-looking names can have different payloads and timing.

Portable plugins use the SDK hook/contribution surface and the grants documented in [SDK reference](/documentation/plugins/plugin-sdk). Host hook types do not make arbitrary internal events available to a portable runtime.
