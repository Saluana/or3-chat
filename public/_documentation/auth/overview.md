# Model provider connections

OR3 supports OpenRouter and direct OpenAI connections for model discovery and chat. This section covers connecting accounts and keys, reading model capabilities, and preparing provider messages. Direct OpenAI chat requires an OR3 server.

| Task | Guide |
| --- | --- |
| Connect or troubleshoot OpenRouter | [Connect OpenRouter](/documentation/auth/connect) |
| Connect a direct OpenAI key | [Direct OpenAI keys](/documentation/auth/reference#direct-openai-keys) |
| Add connection controls to OR3 source UI | [Connection and key APIs](/documentation/auth/reference) |
| Fetch or filter model metadata | [Model catalog](/documentation/auth/models-service) |
| Convert internal messages and attachments | [Build provider messages](/documentation/auth/openrouter-build) |

OpenRouter connection is separate from OR3 Cloud sign-in. Cloud identity, workspace permissions, and auth providers are documented under [Cloud accounts and access](/documentation/cloud/auth-system).

These developer references describe host source APIs. Portable plugins should use the permission-scoped [plugin SDK](/documentation/plugins/plugin-sdk) for model calls rather than reading user credentials or importing private host modules.
