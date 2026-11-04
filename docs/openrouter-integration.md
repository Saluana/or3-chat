# OpenRouter integration

OpenRouter is the default router; a direct OpenAI adapter (below) proves the
same boundary with a second router. The OpenRouter SDK remains the
compatibility surface for catalog discovery, authentication and trusted
workflow clients.
Title generation and governed plugin completions use the shared text-completion
request and inference runtime around their existing host-owned HTTP operation.
The OpenRouter adapter turns the router/model reference and output allowance
into the existing OpenRouter request shape.

Chat streaming uses raw fetch and `shared/openrouter/parseOpenRouterSSE.ts`
so OR3 controls cancellation, deadlines, incremental reasoning/tool/image
events, and foreground/background persistence. The installed SDK also supports
streaming; OR3's fetch pipeline is an implementation choice.
The foreground tool loop accepts a selected stream operation; its existing
OpenRouter entry point supplies the current operation and credential closure.
The surrounding native chat preparation and compatibility messages are still
OpenRouter-specific.

| Source owner | Contract |
| --- | --- |
| [Inference runtime](../shared/ai/runtime.ts) | Composes request preparation and response decoding with host-authorized I/O; shared message and event types live beside it. |
| [OpenRouter adapter](../shared/openrouter/adapter.ts) | OpenRouter request encoding and streaming/completion decoding. |
| [Selection](../shared/openrouter/selection.ts) and [catalog](../shared/openrouter/catalog.ts) | Legacy model identity and capability interpretation; SDK catalog pagination and mapping. |
| [Client factory](../shared/openrouter/client.ts) | Attribution headers and SDK setup for supported SDK consumers. |
| [SSE parser](../shared/openrouter/parseOpenRouterSSE.ts) | Incremental provider events; the existing event export remains compatible. |
| [Decisions](../shared/openrouter/decisions.ts) | Optional project-memory classifier. It is not a chat completion; callers keep their origin gate, deadline and unclassified fallback. |
| [Provider body](../shared/ai/provider-body.ts) and [chat router](../server/utils/ai/chat-router.ts) | The one router-aware projection admission measures, and the server's per-router credential, endpoint and wire encoding for the stream route and background worker. |
| Trusted `ai.provider()` and workflow server ports | Return the real OpenRouter SDK client from the client factory with origin guards. The installed `or3-plugin-workflows` package owns its model gateway, so workflows are not portable to another router. |

The host retains credential selection, origin checks, context admission, retry
policy, tool execution and persistence. The runtime receives an authorized I/O
closure; it does not expose a credential-bearing proxy. The chat message
builder and existing plugin hooks still use their documented OpenRouter-shaped
message contract. A different production router and its connection/UI handling
are not provided by this refactor.

## Direct OpenAI adapter

`@openai/<model>` IDs select OpenAI. [Models](../shared/openai/models.ts) maps
OpenAI's model list to the catalog shape (capacities from a host table) and
[the adapter](../shared/openai/adapter.ts) projects OR3's request onto Chat
Completions at dispatch: `max_tokens` becomes `max_completion_tokens`, the
reasoning effort becomes the nearest `reasoning_effort` the model family accepts
(gpt-5.1 and later accept `none`…`xhigh`, gpt-5 `minimal`…`high`, o-series
`low`…`high`; others take none), usage is requested for streams, and OpenRouter
routing, plugin, search and cache-control options are dropped. OpenAI's stream
chunks are decoded by the same SSE parser. Keys are resolved per router on the
server (`server/secrets/openai.ts`).

The workspace **fast model** ([shared/ai/fast-model.ts](../shared/ai/fast-model.ts),
stored under the original `ai.title_generation_model` key) names chats and
documents, drives editor autocomplete and extracts project memories. Its router
also runs memory classification: OpenRouter Decisions with
`perplexity/pplx-decider-v1.2`, or [OpenAI Decisions](../shared/openai/decisions.ts)
(`POST /v1/decisions`, `gpt-6-luna`). With an OpenAI fast model, OR3 needs no
OpenRouter key; local installs send OpenAI memory inference through the server
with the device key, so it always reaches `OR3_OPENAI_BASE_URL`. Plugin
`ai.complete` routes allowlisted `@openai/` models to OpenAI (prices are the
operator's `OR3_PLUGIN_MODEL_PRICES`, for either router). Delegation, model
search and the installed Workflows gateway remain OpenRouter-only; the chat
settings popover shows their controls, and the model variants, disabled for
OpenAI models.

Use the maintained [key and connection APIs](../public/_documentation/auth/reference.md),
[model catalog](../public/_documentation/auth/models-service.md),
[provider message builder](../public/_documentation/auth/openrouter-build.md),
[chat streaming guide](../public/_documentation/utils/openrouterStream.md), and
[error guide](../public/_documentation/utils/errors.md) for usage contracts.
