artifact_id: 2f0a0d8f-7cc5-4e27-9c9e-0c2a3d7a4d6e

## Overview

Add a minimal Nitro server route to proxy OpenRouter SSE. It prefers a server env key (`OPENROUTER_API_KEY`), otherwise uses an `apiKey` provided in the client request body. The existing client generator (`app/utils/chat/openrouterStream.ts`) remains the parser/stream consumer; it will try the server first, then fall back to direct OpenRouter if the route is unavailable. Event shape (ORStreamEvent) is unchanged.

## Architecture

```mermaid
flowchart LR
  UI[Client UI] -->|calls| ORS[openRouterStream wrapper]
  ORS -->|POST SSE| API[/api/openrouter/stream/]
  subgraph Server
    API --> PARSER[shared parser]
  end
  PARSER -->|ORStreamEvent SSE| API
  API -->|ORStreamEvent SSE| ORS
  subgraph Fallback (no server)
    ORS --> FPARSER[shared parser]
    FPARSER --> UI
  end
  API -.->|fetch SSE| OR[OpenRouter]
```

### Components

-   Server (Nitro): `POST /api/openrouter/stream`

    -   Reads request JSON body.
    -   Selects API key: `env.OPENROUTER_API_KEY ?? body.apiKey`.
    -   Forwards to `https://openrouter.ai/api/v1/chat/completions` with `Accept: text/event-stream`.
    -   Uses shared parser to convert upstream SSE into normalized `ORStreamEvent` and re-emits as SSE to clients.
    -   Aborts upstream when client disconnects.

-   Client (existing): `openRouterStream(params)`
    -   Builds request body (model, messages, modalities, tools, reasoning, stream=true).
    -   Attempts `/api/openrouter/stream` first (always sends `apiKey` in body — used only if env key is missing on server).
    -   If server route fails/unavailable, falls back to direct OpenRouter call using `apiKey` in headers and runs the same shared parser locally.

## Interfaces (TypeScript)

```ts
// Request body sent to server route (superset of OpenRouter body)
interface ProxyRequestBody {
    model: string;
    messages: any[];
    modalities: string[];
    stream: true;
    tools?: ToolDefinition[];
    tool_choice?: ToolChoice | 'auto';
    reasoning?: any;
    apiKey?: string; // optional client-provided key; used only if env is missing
}
```

### Isomorphic parser API

```ts
// Consumes upstream SSE response body and yields normalized events
export async function* parseOpenRouterSSE(
    stream: ReadableStream<Uint8Array>
): AsyncGenerator<ORStreamEvent, void, unknown>;
```

## Server Route (Nitro) behavior (pseudocode)

```ts
export default defineEventHandler(async (event) => {
    const body = await readBody<ProxyRequestBody>(event);
    const key = process.env.OPENROUTER_API_KEY || body.apiKey;
    if (!key) {
        setResponseStatus(event, 400);
        return 'Missing OpenRouter API key';
    }

    const ac = new AbortController();
    // Abort when client disconnects
    // @ts-expect-error: node may be undefined on some presets
    event.node?.req?.on?.('close', () => ac.abort());

    const upstream = await fetch(OR_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'HTTP-Referer': `https://${
                getHeader(event, 'host') || 'localhost'
            }`,
            'X-Title': 'or3.chat',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
    });

    if (!upstream.ok || !upstream.body) {
        setResponseStatus(event, upstream.status);
        return await upstream.text().catch(() => upstream.statusText);
    }

    setHeader(event, 'Content-Type', 'text/event-stream');
    setHeader(event, 'Cache-Control', 'no-cache, no-transform');
    setHeader(event, 'Connection', 'keep-alive');

    const encoder = new TextEncoder();
    const eventStream = new ReadableStream({
        async start(controller) {
            for await (const evt of parseOpenRouterSSE(upstream.body)) {
                // SSE frame: data: <json>\n\n
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)
                );
            }
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
            );
            controller.close();
        },
    });
    return sendStream(event, eventStream);
});
```

## Error handling

-   400: No API key found (neither env nor body.apiKey).
-   5xx/4xx from upstream: pass back status with upstream text (non-streaming). Do not log or echo API keys; redact if logging meta.

## Testing strategy (lean)

-   Unit: key selection (env present vs. absent) and 400 path.
-   Integration (local): server emits normalized `ORStreamEvent` SSE; abort closes upstream and stops upstream fetch.
-   Client: falls back to direct OpenRouter when server route 404/ECONNREFUSED.
