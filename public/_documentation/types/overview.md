# TypeScript contracts

Import types from their defining module rather than copying an interface from documentation. The source carries optional fields, discriminated results, schema defaults, and new variants that a pasted definition can miss.

These references help you choose the right type and understand its boundary. They do not duplicate every source declaration.

| Contract | Import / guide |
| --- | --- |
| Internal chat messages, send results, and tools | `~/utils/chat/types`; [Chat types](/documentation/types/chat-types). |
| Stored entity rows and create inputs | `~/db/schema`; [Database types](/documentation/types/database). |
| Parsed documents and document patches | `~/db/documents`; [Database types](/documentation/types/database). |
| Typed hook payloads and augmentation | `~/core/hooks/hook-types`; [Hook types](/documentation/types/hooks). |
| Portable plugin contracts | `@or3/plugin-sdk`; [Plugin types](/documentation/types/plugins). |
| Source controllers and registries | [Source contributor map](/documentation/start/source-map); import return types from the defining module. |
| Provider message parts | `~/core/auth/openrouter-build`; [Build provider messages](/documentation/auth/openrouter-build). |
| OpenRouter model metadata | `~~/shared/openrouter/types`; [Model catalog](/documentation/auth/models-service). |

## Choose the boundary first

A database row is not a UI message or a provider payload. A document row has serialized content; document helpers return parsed TipTap content. A create input allows helper-generated defaults that a persisted row requires. Convert at the existing boundaries rather than casting one shape into another.

Use `import type` for declarations with no runtime dependency. Nuxt's `~/` alias resolves to `app/`, and `~~/` to the repository root. Those aliases are for host source development; a separately built portable plugin imports the SDK instead.

Types do not grant authority or validate untrusted input. Use the existing runtime schemas, permission checks, and entity APIs where the data crosses a boundary.

ESLint uses the Nuxt project types with `noUncheckedIndexedAccess` enabled. Sparse record and array lookups can return `undefined`, so keep their bounds checks. Runtime JSON should enter as `unknown` and be validated before it is treated as a complete contract.
