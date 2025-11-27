# OpenRouter Integration

This document describes the OpenRouter SDK integration layer used throughout or3-chat.

## Overview

or3-chat uses the official `@openrouter/sdk` package for non-streaming API calls, with a thin adapter layer in `shared/openrouter/` that provides:

-   Consistent client initialization
-   Normalized error handling
-   Type mapping between SDK types and internal types

## Architecture

```
shared/openrouter/
├── index.ts           # Barrel exports
├── client.ts          # SDK client factory + request options
├── errors.ts          # Error normalization (SDK → NormalizedError)
├── types.ts           # Type mapping (SDK Model → OpenRouterModel)
└── parseOpenRouterSSE.ts  # SSE parsing for streaming (raw fetch)
```

## Usage

### Creating a Client

```ts
import {
    createOpenRouterClient,
    getRequestOptions,
} from '~~/shared/openrouter';

const client = createOpenRouterClient({ apiKey: userKey });

// With common headers (referer, title)
const models = await client.models.list({}, getRequestOptions());

// With abort signal
const response = await client.chat.send(params, getRequestOptions(signal));
```

### Error Handling

```ts
import { normalizeSDKError } from '~~/shared/openrouter';

try {
    await client.models.list({}, getRequestOptions());
} catch (error) {
    const normalized = normalizeSDKError(error);

    console.log(normalized.code); // 'ERR_AUTH', 'ERR_RATE_LIMIT', etc.
    console.log(normalized.message); // User-friendly message
    console.log(normalized.status); // HTTP status code
    console.log(normalized.retryable); // Whether retry makes sense
}
```

### Error Codes

| Code              | HTTP Status | Description                | Retryable |
| ----------------- | ----------- | -------------------------- | --------- |
| `ERR_AUTH`        | 401         | Invalid or expired API key | No        |
| `ERR_CREDITS`     | 402         | Insufficient credits       | No        |
| `ERR_FORBIDDEN`   | 403         | Access denied              | No        |
| `ERR_RATE_LIMIT`  | 429         | Rate limit exceeded        | Yes       |
| `ERR_BAD_REQUEST` | 400         | Invalid request parameters | No        |
| `ERR_NOT_FOUND`   | 404         | Resource not found         | No        |
| `ERR_TIMEOUT`     | 408/524     | Request timed out          | Yes       |
| `ERR_SERVER`      | 500         | OpenRouter service error   | Yes       |
| `ERR_PROVIDER`    | 502/503     | AI provider unavailable    | Yes       |
| `ERR_OVERLOADED`  | 529         | Provider overloaded        | Yes       |
| `ERR_CHAT`        | 400         | Chat-specific error        | No        |
| `ERR_ABORTED`     | 0           | Request cancelled          | No        |
| `ERR_UNKNOWN`     | 0           | Unexpected error           | Yes       |

### Type Mapping

The SDK returns models in camelCase, but our internal `OpenRouterModel` interface uses snake_case to match the REST API:

```ts
import { sdkModelToLocal, type OpenRouterModel } from '~~/shared/openrouter';

const sdkModels = response.data;
const models: OpenRouterModel[] = sdkModels.map(sdkModelToLocal);
```

## Streaming

**Important**: The SDK does not support streaming responses. All streaming code continues to use raw `fetch()` with the SSE parser in `parseOpenRouterSSE.ts`.

This is by design:

-   Streaming requires fine-grained control over the response body
-   SDK methods return complete responses, not async iterables
-   Our existing SSE parsing handles reasoning tokens, tool calls, and image generation

### Streaming Endpoints

| Location                               | Purpose                                  |
| -------------------------------------- | ---------------------------------------- |
| `server/api/openrouter/stream.post.ts` | SSR server route (proxies to OpenRouter) |
| `app/utils/chat/openrouterStream.ts`   | Client-side fallback (direct API call)   |

Both use raw `fetch()` and pipe through `parseOpenRouterSSE()`.

## Files Using the SDK

| File                                                | SDK Usage                                  |
| --------------------------------------------------- | ------------------------------------------ |
| `app/core/auth/models-service.ts`                   | `client.models.list()`                     |
| `app/core/auth/openrouter-auth.ts`                  | `client.oAuth.exchangeAuthCodeForAPIKey()` |
| `app/plugins/EditorAutocomplete/TiptapExtension.ts` | `client.chat.send()`                       |

## Default Headers

All SDK requests include these headers via `getRequestOptions()`:

```ts
{
  'HTTP-Referer': 'https://or3.chat',
  'X-Title': 'or3.chat'
}
```

These are required by OpenRouter for analytics and rate limiting.

## OAuth Flow

The OAuth PKCE flow uses `client.oAuth.exchangeAuthCodeForAPIKey()`:

```ts
const response = await client.oAuth.exchangeAuthCodeForAPIKey({
    code: authCode,
    codeVerifier: verifier,
    codeChallengeMethod: 'S256', // or 'plain'
});

const apiKey = response.key;
```

The key is then stored in IndexedDB via the KV table.

## Migration Notes

This integration was added to replace raw `fetch()` calls with the official SDK, providing:

1. **Type safety**: SDK types for request/response bodies
2. **Error handling**: Typed error classes instead of status code parsing
3. **Maintainability**: Official SDK tracks API changes

Raw `fetch()` is retained only for streaming, where the SDK doesn't provide an equivalent.
