# openrouterStream

Low-level streaming helper for OpenRouter API responses. Handles SSE (Server-Sent Events) parsing, tool calling, reasoning, images, and text chunks with proper buffering and accumulation. Also starts and tracks SSR background streaming jobs.

Think of `openRouterStream` as your bridge between the raw OpenRouter API and your application — it parses streaming events, accumulates fragmented tool calls, and yields normalized events your UI can consume.

---

## Purpose

`openRouterStream` is an async generator that:

-   Tries the server proxy route (`/api/openrouter/stream`) first, then falls back to direct OpenRouter when allowed
-   Parses incoming SSE data into structured events
-   Handles multi-part tool calls streamed across chunks
-   Extracts text, images, reasoning, and tool calls
-   Provides normalized event types for easy consumption
-   Starts background jobs and polls or subscribes to their status in SSR mode

Use this when you need **direct streaming control** or are building a **custom chat integration**. For most use cases, `useChat` (which uses this internally) is simpler.

---

## Basic Example

```ts
import { openRouterStream } from '~/utils/chat/openrouterStream';

const stream = openRouterStream({
    apiKey: 'sk-or-v1-...',
    model: 'anthropic/claude-3-sonnet',
    orMessages: [
        { role: 'user', content: 'Hello!' }
    ],
    modalities: ['text'],
});

for await (const event of stream) {
    if (event.type === 'text') {
        console.log('Text:', event.text);
    } else if (event.type === 'tool_call') {
        console.log('Tool call:', event.tool_call.function.name);
    } else if (event.type === 'done') {
        console.log('Stream complete');
    }
}
```

---

## How to use it

### 1. Create a stream

```ts
const stream = openRouterStream({
    apiKey: userApiKey,        // optional; required only for the direct fallback
    model: 'anthropic/claude-3-sonnet',
    orMessages: conversationHistory,
    modalities: ['text', 'image'],
    tools: enabledToolDefinitions,   // optional function-calling tools
    toolChoice: 'auto',              // optional
    reasoning: { effort: 'high' },   // optional reasoning config
    threadId: '...',                 // optional, forwarded to the server route
    messageId: '...',                // optional, forwarded to the server route
    signal: abortController.signal,  // optional: for cancellation
    streamedFieldMode: 'delta',      // only adapters that emit whole tool
                                     // fields on every event should use
                                     // 'cumulative-snapshot'
    responseTimeoutMs: 30_000,       // optional deadline for response headers
    idleTimeoutMs: 60_000,           // optional idle watchdog for body reads
});
```

### 2. Iterate over events

```ts
try {
    for await (const event of stream) {
        switch (event.type) {
            case 'text':
                processText(event.text);
                break;
            case 'image':
                processImage(event.url, event.final);
                break;
            case 'reasoning':
                processReasoning(event.text);
                break;
            case 'tool_call':
                handleToolCall(event.tool_call);
                break;
            case 'done':
                finalize();
                break;
        }
    }
} catch (error) {
    handleStreamError(error);
}
```

### 3. Handle tool calls

Tool calls are complete `ToolCall` objects when yielded:

```ts
if (event.type === 'tool_call') {
    const { id, function: { name, arguments: argsJson } } = event.tool_call;

    const args = JSON.parse(argsJson);
    const result = await executeTool(name, args);
}
```

### 4. Cancel streaming

```ts
const abortController = new AbortController();
const stream = openRouterStream({
    // ...
    signal: abortController.signal,
});

abortController.abort();
```

---

## Server route first

The generator does not always talk to OpenRouter directly:

1. If SSR auth is enabled and no API key is available, the server route is **required**. A missing or failing route throws an error — no fallback.
2. Otherwise it checks the route availability cache and tries `/api/openrouter/stream` first.
3. Only a 404 or 405 (static build, missing route) or a genuine network failure marks the route as unavailable. Other proxy errors (5xx, 401, 403, 429) propagate so callers can retry or surface them.
4. When the server route succeeds, its SSE body is parsed with the same shared parser and the stream ends — no fallback.
5. If the route is unavailable and an API key exists, the generator falls back to a direct OpenRouter request.

### Availability cache

-   localStorage key: `or3:server-route-available`
-   Stores `{ available: boolean, timestamp: number }`
-   TTL: 15 minutes; an expired entry is retried
-   First run assumes the route is available
-   A `forceServerRoute` request never writes the cache

If behavior looks inconsistent after toggling SSR or providers, clear this key (and `or3:background-streaming-available`) or use a fresh profile.

---

## What you get back

Each event is one of:

| Event Type | Payload | Description |
|---|---|---|
| `text` | `{ type: 'text'; text: string }` | Text chunk from model |
| `image` | `{ type: 'image'; url: string; final?: boolean; index?: number }` | Image URL |
| `reasoning` | `{ type: 'reasoning'; text: string }` | Model's internal thinking |
| `tool_call` | `{ type: 'tool_call'; tool_call: ToolCall }` | Function call request |
| `done` | `{ type: 'done' }` | Stream complete |

### ToolCall structure

```ts
interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;  // JSON string
    };
}
```

---

## How it works (under the hood)

1. **Connect**: Fetches `/api/openrouter/stream` (server route) or the OpenRouter API directly with streaming enabled
2. **Parse SSE**: Applies standard SSE framing, including multiline `data`, CRLF, comments, split UTF-8, and a final unterminated event
3. **Accumulate**: Buffers partial chunks until complete JSON line
4. **Detect tool calls**: Watches for `delta.tool_calls` in JSON
5. **Accumulate tool calls**: Reconstructs fragmented tool calls across chunks
6. **Emit events**: Yields normalized events as they arrive
7. **Handle finish_reason**: When `finish_reason === 'tool_calls'`, emits tools
8. **Extract images**: Handles multiple image formats, deduplicated by URL
9. **Yield done**: Sends exactly one final `done` event and stops immediately on `[DONE]`

Both paths (server route and direct fallback) run the SSE body through the same shared parser from `shared/openrouter/parseOpenRouterSSE`, so event behavior is identical.

---

## Key Features

- **Fragmented tool calls**: Accumulates partial calls across chunks
- **Multiple image formats**: OpenAI, Gemini, and inline formats
- **Reasoning support**: Extracts model reasoning
- **Cancellation**: Respects `AbortSignal`
- **Typed failures**: Distinguishes transport, protocol, and provider failures
- **Memory efficient**: Deduplicates images
- **Bounded waits**: Response-header deadlines and streaming idle watchdogs
- **Route detection**: Caches server-route availability to avoid repeated 404s
- **Retry wrapper**: Retries transient failures before the first event

---

## Retrying transient failures

`openRouterStreamWithRetry` wraps the generator with automatic retry:

```ts
const stream = openRouterStreamWithRetry({
    ...params,
    maxRetries: 2,        // default
    maxRetryAfterMs: 5000, // default, caps the per-retry wait
});

for await (const event of stream) { /* ... */ }
```

-   Retries 429 (honoring `Retry-After`), 5xx, and network errors
-   Retries only before the first event is yielded; once bytes flow, mid-stream errors propagate so partial state is preserved
-   Non-retryable errors (4xx except 429, aborts) propagate immediately
-   Backoff is exponential (500ms base) unless `Retry-After` is larger

---

## Common patterns

### Accumulate full response

```ts
let fullText = '';
let allToolCalls: ToolCall[] = [];

for await (const event of stream) {
    if (event.type === 'text') {
        fullText += event.text;
    } else if (event.type === 'tool_call') {
        allToolCalls.push(event.tool_call);
    }
}
```

### Stream text with real-time updates

```ts
let buffer = '';

for await (const event of stream) {
    if (event.type === 'text') {
        buffer += event.text;
        updatePreview(buffer);
    }
}
```

### Handle tool calling flow

```ts
for await (const event of stream) {
    if (event.type === 'tool_call') {
        const tool = event.tool_call;
        const result = await executeLocalTool(
            tool.function.name,
            JSON.parse(tool.function.arguments)
        );
    }
}
```

---

## Background streaming (SSR mode)

When background jobs are enabled, the client can start a server-side job instead of streaming in the foreground. See `public/_documentation/cloud/background-execution.md` for the full flow.

### `isBackgroundStreamingEnabled(configuredEnabled?)`

Returns `true` when background streaming is available:

-   Returns `false` when the server route cache says no route exists
-   Config flag wins over the cache: explicit `true` enables, explicit `false` disables
-   Otherwise reads localStorage `or3:background-streaming-available` (`"true"` / `"false"`)
-   Defaults to `false` until the first successful background start

### `startBackgroundStream(params)`

Starts a job on the server and returns `{ jobId, status: 'streaming' }`. Sends `_background: true` plus `_threadId`, `_messageId`, optional `_toolRuntime`, and `_streamedFieldMode` in the request body. A 404/405 clears both availability caches. `apiKey` travels in the `x-or3-openrouter-key` header.

### `pollJobStatus(jobId, offset?, signal?)`

Gets `BackgroundJobStatus` from `/api/jobs/:id/status`. Throws `BackgroundJobPollError` with a `kind` (`transport | rate_limit | server | not_found | auth | protocol`), a `retryable` flag, and optional `retryAfterMs` parsed from `Retry-After` (capped at 30s).

### `waitForJobCompletion(jobId, onProgress?, pollIntervalMs?, maxWaitMs?)`

Polls until the job leaves `streaming` state. Defaults: 1000ms interval, 5-minute cap. Throws on timeout.

### `subscribeBackgroundJobStream({ jobId, offset?, onStatus, onError? })`

Subscribes via EventSource to `/api/jobs/:id/stream` and calls `onStatus` for each `BackgroundJobStreamEvent` (`snapshot | delta | status`). Returns an unsubscribe function that closes the connection.

### `abortBackgroundJob(jobId)`

POSTs `/api/jobs/:id/abort` and returns `true` when the server confirms `{ aborted: true }`.

### Job status shape

```ts
interface BackgroundJobStatus {
    id: string;
    status: 'streaming' | 'complete' | 'error' | 'aborted';
    threadId: string;
    messageId: string;
    model: string;
    chunksReceived: number;
    startedAt: number;
    completedAt?: number;
    error?: string;
    content?: string;
    content_delta?: string;
    content_length?: number;
    tool_calls?: Array<{
        id?: string;
        name: string;
        status: 'loading' | 'complete' | 'error' | 'pending' | 'skipped';
        args?: string;
        result?: string;
        error?: string;
    }>;
    workflow_state?: WorkflowMessageData;
}
```

---

## Important notes

### API key security

-   Never expose OpenRouter API key in client code
-   Use PKCE flow or server-side proxies for production
-   Key must be validated/fetched before calling
-   The direct fallback sends the key as a Bearer token; the server route sends it in the `x-or3-openrouter-key` header instead

### Message format

`orMessages` follows OpenAI format:

```ts
{
    role: 'user' | 'assistant' | 'tool',
    content: string | object[] | null,
    tool_call_id?: string,
}
```

### Tool calling

-   Tool calls are complete when `finish_reason === 'tool_calls'`
-   You must execute tools locally
-   `useChat` handles tool flow automatically
-   Standard providers concatenate streamed name/argument deltas. Adapters that
    emit cumulative snapshots must explicitly set
    `streamedFieldMode: 'cumulative-snapshot'`
-   Tool definitions are sent without `ui`/`runtime` metadata

### Stream failures

Malformed SSE/JSON throws `OpenRouterProtocolError`. Provider error envelopes
and error finish reasons throw `OpenRouterProviderError`. HTTP/network failures
throw `OpenRouterStreamError` with `kind: 'transport'` and a `retryable` flag
(429 and 5xx are retryable). Failures do not emit a successful terminal event.

The caller signal is composed with a response-header deadline for every upstream
fetch. Once headers arrive, each body read is guarded by an idle watchdog. A caller
abort stays an `AbortError`; response and idle deadlines throw
`OpenRouterTimeoutError` with the corresponding phase.

### Modalities

```ts
['text']              // Text only
['text', 'image']     // Text and images
['audio', 'text']     // Audio support (if available)
```

### Cancellation behavior

When `signal.abort()` is called:

1. Fetch stops reading
2. Generator loop exits
3. `for await` breaks cleanly
4. No premature close errors

---

## Troubleshooting

### Empty stream

-   Check API key validity
-   Verify model name is supported
-   Ensure messages are formatted correctly

### 404 or "server route unavailable"

-   You may be on a static build, or a stale dev process is serving the page
-   Clear `or3:server-route-available` in localStorage
-   In SSR mode (no client key) the route is required and no fallback exists

### Partial tool calls

-   Verify `finish_reason === 'tool_calls'`
-   All accumulated tools emitted together

### Images not appearing

-   Model must support image output
-   Check `modalities` includes image
-   Verify URLs are accessible

### Stream hangs

-   Use `AbortSignal` with timeout
-   Check firewall/proxy blocks
-   Verify API account has credits

---

## Related

-   `useChat` — Higher-level composable using this internally
-   `useStreamAccumulator` — Frame-batched accumulation for UI
-   `ORStreamEvent` — Type definition
-   `parseOpenRouterSSE` — Shared SSE parser in `shared/openrouter`
-   `errors.ts` — Error handling
-   `background-execution.md` — Background job flow and eligibility rules

---

## TypeScript

```ts
export async function* openRouterStream(params: {
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities?: string[];
    threadId?: string;
    messageId?: string;
    tools?: ToolDefinition[];
    toolChoice?: ToolChoice;
    signal?: AbortSignal;
    reasoning?: OpenRouterReasoningConfig;
    streamedFieldMode?: 'delta' | 'cumulative-snapshot';
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
}): AsyncGenerator<ORStreamEvent, void, unknown>

type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; tool_call: ToolCall }
    | { type: 'done' }
```

Document generated from `app/utils/chat/openrouterStream.ts` implementation.
