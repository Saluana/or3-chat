# Chat Types

TypeScript type definitions for OR3 chat messages, tool calling, and streaming. Defines the core interfaces used throughout the chat system for messages, content parts, tool definitions, and stream events.

Think of these types as the contract between different parts of the chat system — they ensure messages, tools, and streaming events are structured consistently across the entire application.

---

## Purpose

The chat types provide:

- **Message structure** — Standard format for user/assistant/system messages
- **Content parts** — Support for text, images, and file attachments
- **Tool calling** — OpenRouter-compatible function definitions and calls
- **Streaming events** — Normalized event types from OpenRouter SSE streams
- **Type safety** — Full TypeScript inference across the chat stack

---

## Core Types

### `ChatMessage`

The raw message format used internally and in the database.

```ts
interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ContentPart[];
    id?: string;
    stream_id?: string;
    file_hashes?: string | null;
    reasoning_text?: string | null;
    error?: string | null;
    pending?: boolean;
    data?: Record<string, unknown> | null;
    index?: number | null;
    order_key?: string | null;
    created_at?: number | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}
```

**Fields:**
- `role` — Message sender (user, assistant, system, or tool result)
- `content` — Message text or array of content parts
- `id` — Unique message identifier
- `stream_id` — Links streaming messages to their final result
- `file_hashes` — Comma-separated hash list for attached files
- `reasoning_text` — AI reasoning output (if model supports it)
- `pending` — True while a message is being sent
- `data` — Arbitrary payload attached by senders
- `index` — Ordering index within the thread
- `order_key` — HLC-derived key that breaks index ties
- `tool_calls` — Function calls the assistant requested
- `tool_call_id` — Links a `tool` role message to its call

**Note:** For UI rendering, use `UiChatMessage` from `uiMessages.ts` which adds `toolCalls`, `attachments`, and `pending` fields.

---

## Content Parts

Messages can contain mixed content types using content parts.

### `TextPart`

Plain text content.

```ts
type TextPart = { 
    type: 'text'; 
    text: string;
};
```

### `ImagePart`

Image data or URL.

```ts
type ImagePart = {
    type: 'image';
    image: string | Uint8Array | Buffer;
    mediaType?: string;
};
```

### `FilePart`

File attachment with data.

```ts
type FilePart = {
    type: 'file';
    data: string | Uint8Array | Buffer;
    mediaType: string;
    name?: string;
};
```

### `ContentPart`

Union of all content part types.

```ts
type ContentPart = TextPart | ImagePart | FilePart;
```

**Example:**

```ts
const message: ChatMessage = {
    role: 'user',
    content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image', image: 'data:image/png;base64,...', mediaType: 'image/png' }
    ]
};
```

---

## Tool Calling Types

### `ToolCall`

Represents a function call request from the AI.

```ts
interface ToolCall {
    id: string;                  // Unique call ID
    type: 'function';            // Always 'function'
    function: {
        name: string;            // Tool name to execute
        arguments: string;       // JSON-stringified arguments
    };
}
```

**Example:**

```ts
const toolCall: ToolCall = {
    id: 'call_abc123',
    type: 'function',
    function: {
        name: 'calculate',
        arguments: '{"operation":"add","a":5,"b":3}'
    }
};
```

### `ToolDefinition`

OpenRouter-compatible tool definition with optional UI metadata.

```ts
interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: JsonSchemaObject;
    };
    ui?: {
        label?: string;              // Display name
        icon?: string;               // Icon name for UIcon
        descriptionHint?: string;    // Longer description
        defaultEnabled?: boolean;    // Initial enabled state
        category?: string;           // Group by category
    };
    runtime?: 'hybrid' | 'client' | 'server';
}
```

`JsonSchemaObject` comes from `~~/shared/chat/tool-schema`. It requires `type: 'object'` and accepts optional `properties` and `required` arrays. The `runtime` field tells the tool registry where the tool may execute. `'hybrid'` (the default) runs on either side, `'client'` only on the browser, and `'server'` only in SSR background execution.

**UI Metadata:**

The optional `ui` field was added in the tool-calling feature to provide:
- User-friendly display names and descriptions
- Icons for visual identification
- Default enabled state for new users
- Category grouping in settings

**Example:**

```ts
const calculatorTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'calculate',
        description: 'Perform basic arithmetic operations',
        parameters: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['add', 'subtract', 'multiply', 'divide']
                },
                a: { type: 'number' },
                b: { type: 'number' }
            },
            required: ['operation', 'a', 'b']
        }
    },
    ui: {
        label: 'Calculator',
        icon: 'pixelarticons:calculator',
        descriptionHint: 'Basic math operations',
        defaultEnabled: true,
        category: 'Math'
    }
};
```

### `ToolChoice`

Controls how the AI should use tools.

```ts
type ToolChoice =
    | 'auto'        // AI decides when to call tools
    | 'none'        // Never call tools
    | {             // Force specific tool
          type: 'function';
          function: {
              name: string;
          };
      };
```

**Example:**

```ts
// Let AI decide
const choice1: ToolChoice = 'auto';

// Disable tools
const choice2: ToolChoice = 'none';

// Force calculator
const choice3: ToolChoice = {
    type: 'function',
    function: { name: 'calculate' }
};
```

---

## Streaming Types

### `ORStreamEvent`

Events emitted by the OpenRouter streaming parser. The definition lives in `shared/openrouter/parseOpenRouterSSE.ts` and is re-exported by `~/utils/chat/types`.

```ts
type ORStreamEvent =
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; tool_call: ToolCall }
    | { type: 'done' };
```

**Event Types:**

- **`text`** — Text chunk from assistant response
- **`image`** — Generated image URL
- **`reasoning`** — Reasoning text (if model supports it)
- **`tool_call`** — Tool execution request
- **`done`** — Stream complete

**Example:**

```ts
for await (const event of openRouterStream(...)) {
    switch (event.type) {
        case 'text':
            console.log('Text:', event.text);
            break;
        case 'tool_call':
            console.log('Tool:', event.tool_call.function.name);
            break;
        case 'done':
            console.log('Stream finished');
            break;
    }
}
```

---

## Message Parameters

### `SendMessageParams`

Optional parameters when sending a chat message.

```ts
interface SendMessageParams {
    files?: { type: string; url: string }[];
    model?: string;
    file_hashes?: string[];
    extraTextParts?: string[];
    online: boolean;
    thinking?: boolean;
    reasoningEffort?: string | null;
    context_hashes?: string[];
    historyOverride?: ChatMessage[];
}
```

**Fields:**
- `files` — Image/file URLs to attach
- `model` — AI model to use (e.g., 'openai/gpt-4')
- `file_hashes` — Reference existing files by hash
- `extraTextParts` — Additional text segments
- `online` — Enable web search (adds ':online' suffix to model)
- `thinking` — Enable extended reasoning mode
- `reasoningEffort` — Reasoning budget for models that support it
- `context_hashes` — Hashes to include for model context without reattaching to the new UI message
- `historyOverride` — Canonical transcript prefix used for branch-preserving retry

**Example:**

```ts
await chat.sendMessage('Analyze this', {
    model: 'anthropic/claude-3-sonnet',
    file_hashes: ['abc123'],
    online: false
});
```

---

## Type Guards

`~/utils/chat/types` does not export runtime type guards. Narrow content parts inline instead:

```ts
function isTextPart(part: ContentPart): part is TextPart {
    return part.type === 'text';
}

function isImagePart(part: ContentPart): part is ImagePart {
    return part.type === 'image';
}

function isFilePart(part: ContentPart): part is FilePart {
    return part.type === 'file';
}

function hasToolCall(event: ORStreamEvent): event is { type: 'tool_call'; tool_call: ToolCall } {
    return event.type === 'tool_call';
}
```

---

## Common Patterns

### Building messages with mixed content

```ts
const message: ChatMessage = {
    role: 'user',
    content: [
        { type: 'text', text: 'Compare these:' },
        { type: 'image', image: imageUrl1, mediaType: 'image/png' },
        { type: 'image', image: imageUrl2, mediaType: 'image/png' }
    ]
};
```

### Parsing tool call arguments

```ts
const toolCall: ToolCall = { /* ... */ };
try {
    const args = JSON.parse(toolCall.function.arguments);
    console.log('Operation:', args.operation);
} catch (e) {
    console.error('Invalid tool arguments:', e);
}
```

### Converting string to content parts

```ts
function textToContent(text: string): ContentPart[] {
    return [{ type: 'text', text }];
}

function contentToString(content: string | ContentPart[]): string {
    if (typeof content === 'string') return content;
    return content
        .filter(p => p.type === 'text')
        .map(p => (p as TextPart).text)
        .join('');
}
```

### Checking for reasoning support

```ts
function hasReasoning(message: ChatMessage): boolean {
    return !!message.reasoning_text;
}
```

---

## Best Practices

### Always validate tool arguments

```ts
// Good - validate before use
const args = JSON.parse(toolCall.function.arguments);
if (typeof args.operation !== 'string') {
    throw new Error('Invalid operation type');
}

// Bad - assume structure
const result = calculate(args.operation, args.a, args.b);
```

### Use type guards for content parts

Write narrow helpers instead of unsafe assertions:

```ts
// Good
function isText(part: ContentPart): part is TextPart {
    return part.type === 'text';
}
if (isText(part)) {
    console.log('Text:', part.text);
}

// Bad - unsafe type assertion
const img = part as ImagePart;
```

### Handle both string and array content

```ts
// Good - normalize first
const parts = typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : message.content;

// Bad - assume one format
const text = message.content[0].text; // Breaks if string
```

### Provide UI metadata for tools

```ts
// Good - helps users understand the tool
const tool: ToolDefinition = {
    function: { /* ... */ },
    ui: {
        label: 'Weather Lookup',
        descriptionHint: 'Get current weather for any city',
        defaultEnabled: false
    }
};

// Bad - no context for users
const tool: ToolDefinition = {
    function: { name: 'get_weather', /* ... */ }
};
```

---

## Limitations

- **Content parts** — No nesting; flat array only
- **Tool calls** — Arguments must be JSON-serializable
- **File hashes** — Stored as comma-separated string, not array
- **Reasoning** — Only available on supported models
- **Tool UI metadata** — Not sent to OpenRouter API

---

## Related

- `~/utils/chat/uiMessages` — UI-enriched message types
- `~/utils/chat/tool-registry` — Tool registration and execution
- `~/utils/chat/openrouterStream` — Streaming parser that produces ORStreamEvent
- `~/composables/chat/useAi` — Chat composable that uses these types
- `~/db/messages` — Database schema for message persistence

---

## TypeScript

Import from:

```ts
import type {
    ChatMessage,
    ContentPart,
    TextPart,
    ImagePart,
    FilePart,
    ToolCall,
    ToolDefinition,
    ToolChoice,
    ToolRuntime,
    ORStreamEvent,
    SendMessageParams
} from '~/utils/chat/types';
```

Core definitions live in `app/utils/chat/types.ts`. `ORStreamEvent` is defined in `shared/openrouter/parseOpenRouterSSE.ts`. `ToolDefinition.function.parameters` uses `JsonSchemaObject` from `shared/chat/tool-schema.ts`.

---

Document generated from `app/utils/chat/types.ts` and `shared/openrouter/parseOpenRouterSSE.ts` implementations.
