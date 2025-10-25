artifact_id: 2f0a0d8f-7cc5-4e27-9c9e-0c2a3d7a4d6e

## Overview

Add a minimal Nitro server route to proxy OpenRouter SSE. It prefers a server env key (`OPENROUTER_API_KEY`), otherwise uses an `apiKey` provided in the client request body. Extract the SSE parsing/normalization into a shared isomorphic module so the server can emit normalized events, and the client can reuse the same logic on fallback. Event shape (ORStreamEvent) remains unchanged.

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
    -   Forwards to `https://openrouter.ai/api/v1/chat/completions` with `Accept: text/event-stream` and `stream: true` in body.
    -   Uses shared parser to convert upstream SSE into normalized `ORStreamEvent` and re-emits as SSE to clients (one JSON object per SSE frame line, prefixed with `data: `, separated by a blank line).
    -   Aborts upstream when client disconnects.

-   Client (existing): `openRouterStream(params)`
    -   Builds request body (model, messages, modalities, tools, reasoning, stream=true).
    -   Attempts `/api/openrouter/stream` first (always sends `apiKey` in body — used only if env key is missing on server).
    -   If server route fails/unavailable, falls back to direct OpenRouter call using `apiKey` in headers and runs the same shared parser locally.

## Directory layout (proposed)

-   `server/api/openrouter/stream.post.ts` — Nitro route proxying to OpenRouter and re-emitting normalized events
-   `shared/openrouter/parseOpenRouterSSE.ts` — isomorphic parser that converts upstream SSE into `ORStreamEvent`
-   `app/utils/chat/openrouterStream.ts` — thin client wrapper: try server first, fallback direct; uses shared parser on fallback

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

// Optional helper: frames normalized events into SSE lines
export function eventToSSE(evt: ORStreamEvent): string; // returns `data: <json>\n\n`
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

## Step-by-step implementation guide

1. Create shared isomorphic parser

-   File: `shared/openrouter/parseOpenRouterSSE.ts`
-   Exports:
    -   `parseOpenRouterSSE(stream: ReadableStream<Uint8Array>)`
    -   `eventToSSE(evt: ORStreamEvent)` (simple helper that JSON.stringify’s and prefixes with `data: `)
-   Implementation notes:
    -   Use `TextDecoder` and `ReadableStreamDefaultReader` to accumulate chunks into a buffer string.
    -   Split on `\n`, keep the last partial line in buffer.
    -   Only process lines starting with `data: `; ignore others and empty lines.
    -   Handle `[DONE]` by yielding `{ type: 'done' }` at the end (server will add a final done as well for safety).
    -   Parse JSON and map provider deltas into `ORStreamEvent`:
        -   reasoning: from `delta.reasoning_details` (prefer) or `delta.reasoning`
        -   text: from `delta.text`, `delta.content` string, or parts of `delta.content[]`
        -   images: detect in `delta.images`, `delta.content[]`, final `message.images`, and `message.content[]`
        -   tool_calls: accumulate across chunks by index; yield on `finish_reason === 'tool_calls'`
    -   Avoid retaining large arrays; do not log arguments/content.

2. Add Nitro server route

-   File: `server/api/openrouter/stream.post.ts`
-   Logic:
    -   Read JSON body. Choose key = `process.env.OPENROUTER_API_KEY || body.apiKey`; if missing, 400.
    -   Fetch `https://openrouter.ai/api/v1/chat/completions` with headers:
        -   `Authorization: Bearer <key>`
        -   `Content-Type: application/json`
        -   `Accept: text/event-stream`
        -   `HTTP-Referer` = `https://<host>`
        -   `X-Title` = `or3.chat`
    -   Body: forward the same payload (ensure `stream: true`).
    -   On success: pipe through shared parser and re-emit as SSE (`data: <json>\n\n`).
    -   Abort handling: listen to `event.node?.req?.on('close')` and call `AbortController.abort()`.
    -   Do not log keys. If you log meta, redact.

3. Update client wrapper

-   File: `app/utils/chat/openrouterStream.ts`
-   Changes:
    -   Before direct OpenRouter fetch, try POST to `/api/openrouter/stream` with the same body plus `apiKey` field.
    -   If the server responds with non-OK or network error, fallback to the existing direct OpenRouter fetch.
    -   On fallback (direct), keep current parsing logic or import and use `parseOpenRouterSSE` from `shared/` to keep behavior identical.

## Contract (inputs/outputs)

-   Input (client to server): `ProxyRequestBody` (OpenRouter payload + optional `apiKey`).
-   Output (server to client): SSE frames each containing a single `ORStreamEvent` JSON object; final `{ type: 'done' }`.
-   Error modes:
    -   400 if no API key is available.
    -   Upstream non-OK -> propagate status and text (non-SSE response).
    -   Client disconnect -> abort upstream fetch, stop emitting.

## Edge cases to consider

-   No `resp.body` from upstream (HTTP error): return status + text.
-   Duplicate images in deltas: de-duplicate via a Set in parser.
-   Tool call chunks without id in early deltas: key by index; set `id` when it arrives.
-   Reasoning duplicated between `reasoning` and `reasoning_details`: prefer `reasoning_details` to avoid duplicates.
-   Very long strings in body preview: if you add logging, always truncate and never include API keys.
