# OpenRouter integration

OR3 uses the official SDK for model metadata, code exchange, and non-streaming
requests. The shared adapter in `shared/openrouter/` owns client creation,
request options, normalized errors, and SDK-to-local model conversion.

Chat streaming uses raw fetch and `shared/openrouter/parseOpenRouterSSE.ts`
so OR3 controls cancellation, deadlines, incremental reasoning/tool/image
events, and foreground/background persistence. The installed SDK also supports
streaming; OR3's fetch pipeline is an implementation choice.

| Source owner | Contract |
| --- | --- |
| [Shared adapter](../shared/openrouter/index.ts) | Client, request options, normalized errors, and model types |
| [Client factory](../shared/openrouter/client.ts) | Attribution headers and SDK setup |
| [SSE parser](../shared/openrouter/parseOpenRouterSSE.ts) | Incremental provider events |

Use the maintained [key and connection APIs](../public/_documentation/auth/reference.md),
[model catalog](../public/_documentation/auth/models-service.md),
[provider message builder](../public/_documentation/auth/openrouter-build.md),
[chat streaming guide](../public/_documentation/utils/openrouterStream.md), and
[error guide](../public/_documentation/utils/errors.md) for usage contracts.
