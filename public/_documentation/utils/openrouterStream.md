# openrouterStream

Low-level streaming helper for OpenRouter API responses. Handles SSE (Server-Sent Events) parsing, tool calling, reasoning, images, and text chunks with proper buffering and accumulation.

Think of `openrouterStream` as your bridge between the raw OpenRouter API and your application — it parses streaming events, accumulates fragmented tool calls, and yields normalized events your UI can consume.

---

## Purpose

`openrouterStream` is an async generator that:

-   Opens a streaming connection to OpenRouter's `/chat/completions` endpoint
-   Parses incoming SSE data into structured events
-   Handles multi-part tool calls streamed across chunks
-   Extracts text, images, reasoning, and tool calls
-   Provides normalized event types for easy consumption

Use this when you need **direct streaming control** or are building a **custom chat integration**. For most use cases, `useChat` (which uses this internally) is simpler.

---

## Basic Example

```ts
import { openrouterStream } from '~/utils/chat/openrouterStream';

const stream = openrouterStream({
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
const stream = openrouterStream({
    apiKey: userApiKey,
    model: 'anthropic/claude-3-sonnet',
    orMessages: conversationHistory,
    modalities: ['text', 'image'],
    signal: abortController.signal, // optional: for cancellation
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
const stream = openrouterStream({
    // ...
    signal: abortController.signal,
});

abortController.abort();
```

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

1. **Connect**: Opens fetch to OpenRouter API with streaming enabled
2. **Parse SSE**: Reads `data: ` prefixed lines
3. **Accumulate**: Buffers partial chunks until complete JSON line
4. **Detect tool calls**: Watches for `delta.tool_calls` in JSON
5. **Accumulate tool calls**: Reconstructs fragmented tool calls across chunks
6. **Emit events**: Yields normalized events as they arrive
7. **Handle finish_reason**: When `finish_reason === 'tool_calls'`, emits tools
8. **Extract images**: Handles multiple image formats
9. **Yield done**: Sends final `done` event when stream ends

---

## Key Features

✅ **Fragmented tool calls**: Accumulates partial calls across chunks
✅ **Multiple image formats**: OpenAI, Gemini, and inline formats
✅ **Reasoning support**: Extracts model reasoning
✅ **Cancellation**: Respects `AbortSignal`
✅ **Error diagnostics**: Detailed error logging
✅ **Memory efficient**: Deduplicates images

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

## Important notes

### API key security

-   Never expose OpenRouter API key in client code
-   Use PKCE flow or server-side proxies for production
-   Key must be validated/fetched before calling

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
-   `errors.ts` — Error handling

---

## TypeScript

```ts
export async function* openRouterStream(params: {
    apiKey: string;
    model: string;
    orMessages: any[];
    modalities: string[];
    signal?: AbortSignal;
}): AsyncGenerator<ORStreamEvent, void, unknown>

type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; tool_call: ToolCall }
    | { type: 'done' }
```
