# OpenRouter

OR3 uses OpenRouter for model discovery and AI requests. This section covers connecting an account, persisting a user key, reading model capabilities, and preparing request messages.

| Task | Guide |
| --- | --- |
| Connect or troubleshoot your account | [Connect OpenRouter](/documentation/auth/connect) |
| Add connection controls to OR3 source UI | [Connection and key APIs](/documentation/auth/reference) |
| Fetch or filter model metadata | [Model catalog](/documentation/auth/models-service) |
| Convert internal messages and attachments | [Build provider messages](/documentation/auth/openrouter-build) |

OpenRouter connection is separate from OR3 Cloud sign-in. Cloud identity, workspace permissions, and auth providers are documented under [Cloud accounts and access](/documentation/cloud/auth-system).

These developer references describe host source APIs. Portable plugins should use the permission-scoped [plugin SDK](/documentation/plugins/plugin-sdk) for model calls rather than reading user credentials or importing private host modules.
