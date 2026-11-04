# Chat types

Import internal chat contracts from `~/utils/chat/types`. They describe UI messages and request state; [provider messages](/documentation/auth/openrouter-build) and [database rows](/documentation/types/database) have separate contracts.

The shared `AiMessage`, content parts and `ToolCall` have one owner in
`shared/ai/types.ts`. Existing chat imports continue to re-export those types;
`ChatMessage` adds UI and persistence metadata.

`AiCompletionRequest` describes the text inputs used by title generation and
governed plugin completions. It carries a router/model reference, messages,
an optional output limit and explicit reasoning-disable choice; omitting
that choice leaves the model default. Credentials remain with host-authorized
I/O. Chat streaming still uses its existing provider-message contract.

The shared `AiStreamRequest` carries a router/model reference and supports the
existing host message and tool projections. The foreground loop binds a stream
operation to this request while keeping cancellation and host ownership in the
operation context. The current chat builder and hooks still use their existing
OpenRouter-shaped message representation.

## Messages and content

| Type | Use |
| --- | --- |
| `ChatMessage` | UI/context message: role, string or content-part array, optional identity, file hashes, reasoning, errors, pending state, ordering, and tool metadata. |
| `TextPart` | `type: 'text'` and text. |
| `ImagePart` | `type: 'image'`, image reference or bytes, optional mediaType. |
| `FilePart` | `type: 'file'`, data reference or bytes, required mediaType, optional name. |
| `ContentPart` | Union of those three parts. |

Roles include `tool` as well as user, assistant, and system. `file_hashes` on a `ChatMessage` is a JSON-serialized string (or null), while `SendMessageParams.file_hashes` is an array. Use the existing serialization and payload builder; a cast will not convert content.

```ts
import type { ChatMessage, ContentPart } from '~/utils/chat/types';

export function visibleText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}
```

## Sending and request state

`SendMessageParams` contains model selection, attachments, additional context hashes, reasoning choices, retry history, and the `onUserPersisted` callback. Use `modelVariant` for routing variants rather than the deprecated `online` flag. The callback runs after the user row is durable and before response generation.

The `online` variant remains compatible with saved selections and enables the OpenRouter web search server tool. The model decides whether to search, and search charges may apply.

`SendResult` is discriminated by `status`: accepted, rejected, failed, aborted, complete, or detached. A rejected result with reason `unsupported_input` means the selected model cannot read an attachment in this turn (an image for a text-only model); nothing was saved and the composer keeps the draft. Some failed/aborted/detached results can still carry a persisted user message ID. An accepted request is not a completed assistant answer. Use the exported `hasDurableSendAcceptance(result)` when deciding whether the user's message has been saved.

```ts
import { hasDurableSendAcceptance, type SendResult } from '~/utils/chat/types';

export function describeSend(result: SendResult): string {
  if (result.status === 'complete') return 'Response completed';
  if (result.status === 'rejected') return 'Message was rejected: ' + result.reason;
  if (hasDurableSendAcceptance(result)) return 'User message saved; response status: ' + result.status;
  return 'Request status: ' + result.status;
}
```

`ChatRequestState` tracks idle, admitted, persisted, streaming, and terminal phases. `RegisterSendResult` exposes terminal and optional durable-acceptance promises. Preserve those distinctions when building UI; clearing the input or reporting “sent” solely because a request was attempted can lose the user's draft.

## Tools

`ToolDefinition` holds the provider function schema and optional UI/runtime metadata. Its parameters use `JsonSchemaObject` from `~~/shared/chat/tool-schema`. `ToolChoice` supports auto, none, or a specific function. `ToolCall.function.arguments` is a JSON string; parse and validate it against the admitted schema before execution.

`ToolRuntime` is client, server, or hybrid. Runtime selection is not authorization. `ToolExecutionContext` carries request-scoped subject/workspace/thread/message IDs, call and request IDs, and an abort signal. Its optional `assertToolAuthorized()` callback is supplied by the registry: host mutation handlers invoke it inside a transaction covering `threads`, `projects`, `posts`, `file_meta`, and `kv`, before their write. It rechecks the captured definition, saved chat tool enablement, owner, project policy and normalized arguments. It performs bounded local authorization reads; do not add network calls, prompts, or arbitrary preparation hooks inside that transaction. `ToolExecutionAdmission` carries the admitted definition, optional document-agent enablement behavior, and an optional `beforeExecute` guard. The browser registry awaits that guard after approval and before entering the handler, outside storage transactions, then repeats local authorization. Remote claim validation belongs in this guard; it must never be added to `assertToolAuthorized`. Use the existing registry/execution flow to enforce these contracts; never execute arbitrary returned names directly.

Portable plugin tool definitions belong to [SDK contracts](/documentation/plugins/plugin-sdk), not private host imports.

## Stream events

`AiEvent` is owned by `~~/shared/ai/events`; the existing `ORStreamEvent` import
from `~~/shared/openrouter/parseOpenRouterSSE` remains an alias. Its variants
are usage, text, image, reasoning, tool_call, and done. Narrow by `type`; image
events can include a final flag and index. The parser reports provider/protocol
failures through its error path, not an “error” union member.

Use these exported types so additions cause useful TypeScript errors in exhaustive consumers rather than drifting copied declarations.
