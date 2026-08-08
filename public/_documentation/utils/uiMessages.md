# UI Messages

Type definitions and utilities for chat messages in the OR3 UI layer. Extends database message types with display properties like tool calls, workflow state, and pending flags.

Think of `uiMessages` as the bridge between raw database records and what you actually render in the chat — it flattens content into text, extracts tool call status, and adds workflow rendering state without cluttering the database schema.

---

## Purpose

The UI message utilities provide:

- **Display-ready messages** — Flattened text plus tool call and workflow info
- **Type safety** — Full TypeScript support for all message variants
- **Tool call tracking** — Status, arguments, and results for inline display
- **Streaming state** — Pending flags for active AI responses
- **Ordered parts** — Optional `parts` array that preserves provider emission order

---

## Core Types

### `UiChatMessage`

The main message type used throughout chat components.

```ts
interface UiChatMessage {
    id: string;                          // Unique message ID
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string;                        // Flattened text content
    file_hashes?: string[];              // Attached file references
    reasoning_text?: string | null;      // AI reasoning (if supported)
    stream_id?: string;                  // For tracking streaming messages
    pending?: boolean;                   // True while streaming
    toolCalls?: ToolCallInfo[];          // Active tool calls
    parts?: UiChatMessagePart[];         // Ordered text/tool parts
    error?: string | null;               // Message-level error
    isWorkflow?: boolean;                // True for workflow messages
    workflowState?: UiWorkflowState;     // Workflow execution state
}
```

### `ToolCallInfo`

Tracks the lifecycle of a single tool invocation.

```ts
interface ToolCallInfo {
    id?: string;                 // Tool call ID
    name: string;                // Tool function name
    label?: string;              // Display label
    status: 'loading' | 'complete' | 'error' | 'pending';
    args?: string;               // JSON arguments
    result?: string;             // Handler result
    error?: string;              // Error message if failed
    fingerprint?: string;        // Execution fingerprint
    completedAt?: number;        // Completion timestamp
}
```

Note the status set includes `'pending'` in addition to `'loading'`,
`'complete'`, and `'error'`.

### `UiChatMessagePart`

Used when the message carries an ordered `parts` array. Text and tool calls
render in the same sequence the provider emitted them.

```ts
type UiChatMessagePart =
    | { id: string; type: 'text'; text: string }
    | { id: string; type: 'tool'; toolCall: ToolCallInfo };
```

### `UiWorkflowState`

Workflow-specific rendering state. Defined in `app/utils/chat/workflow-types.ts`
and attached to workflow messages by `ensureUiMessage`.

---

## Functions

### `ensureUiMessage(raw)`

Convert a raw message record into a UI message.

```ts
function ensureUiMessage(raw: RawMessageLike): UiChatMessage
```

**What it does:**

1. Resolves `id` from `id`, `stream_id`, or a fresh runtime UUID
2. Extracts tool calls from `data.tool_calls` if present
3. Reads `reasoning_text` from `data.reasoning_text` or the top level
4. Detects workflow messages via the `data` discriminator and builds `workflowState`
5. Flattens `text` or `content` parts into display text (workflow messages use `finalOutput`)
6. Appends markdown image placeholders for assistant `file_hashes` (deduplicated against images the model already emitted)
7. Derives `pending` from the workflow execution state or the raw flag
8. Preserves all original fields and returns a typed `UiChatMessage`

**Example:**

```ts
import { ensureUiMessage } from '~/utils/chat/uiMessages';

const rawMsg = {
    id: '123',
    role: 'user',
    text: 'Hello',
    file_hashes: ['abc', 'def'],
    data: {},
};

const uiMsg = ensureUiMessage(rawMsg);
// uiMsg.text === 'Hello'
```

### `partsToText(parts, role?)`

Flatten content parts into a displayable string.

```ts
function partsToText(
    parts: string | ContentPartLike[] | null | undefined,
    role?: string
): string
```

- Returns the string as-is when `parts` is a string
- Concatenates `text` parts
- Converts assistant-generated images to `![generated image](src)` markdown
- Skips image embedding for user messages (shown via the attachments gallery)

---

## How it works

### Message enrichment flow

1. Raw message loaded from Dexie
2. `ensureUiMessage` called during history load
3. Tool calls extracted from `data.tool_calls`
4. Text flattened from `text`, `content`, or content parts
5. Result cached in chat state

### Tool call lifecycle

```
pending → loading → complete (or error)
```

Status updated in real-time during streaming.

### Attachment placeholder injection

For assistant messages with `file_hashes`, the text is scanned for existing
markdown images. Missing hashes are appended as transparent placeholder
images (`![file-hash:<hash>](...)`) so the gallery can show the same image
once instead of twice.

---

## Common patterns

### Check for tool calls

```ts
if (message.toolCalls?.length) {
    console.log('Has tool calls:', message.toolCalls);
}
```

### Display tool status

```vue
<template>
    <div v-for="call in message.toolCalls" :key="call.id">
        <span v-if="call.status === 'pending' || call.status === 'loading'">Executing...</span>
        <span v-else-if="call.status === 'complete'">Done</span>
        <span v-else-if="call.status === 'error'">{{ call.error }}</span>
    </div>
</template>
```

### Streaming indicator

```ts
const isStreaming = computed(() =>
    message.pending || message.toolCalls?.some(t => t.status === 'loading')
);
```

### Render ordered parts

```ts
for (const part of message.parts ?? []) {
    if (part.type === 'text') {
        renderText(part.text);
    } else {
        renderTool(part.toolCall);
    }
}
```

---

## Integration with chat components

### `ChatMessage.vue`

```vue
<script setup lang="ts">
import type { UiChatMessage } from '~/utils/chat/uiMessages';

const props = defineProps<{
    message: UiChatMessage
}>();
</script>

<template>
    <div :class="`message-${message.role}`">
        <div>{{ message.text }}</div>

        <!-- Tool calls -->
        <ToolCallIndicator
            v-if="message.toolCalls?.length"
            :tool-calls="message.toolCalls"
        />
    </div>
</template>
```

---

## Type guards

Check message types at runtime:

```ts
function isUserMessage(msg: UiChatMessage): boolean {
    return msg.role === 'user';
}

function isAssistantMessage(msg: UiChatMessage): boolean {
    return msg.role === 'assistant';
}

function hasToolCalls(msg: UiChatMessage): boolean {
    return !!msg.toolCalls?.length;
}

function isPending(msg: UiChatMessage): boolean {
    return msg.pending === true;
}
```

---

## Best practices

### Always use `ensureUiMessage`

```ts
// Good
const uiMsg = ensureUiMessage(dbMsg);

// Bad - missing tool calls, text flattening, and workflow state
const uiMsg = dbMsg as UiChatMessage;
```

### Check for undefined

```ts
// Good
if (message.toolCalls?.length) { ... }

// Bad - may throw
if (message.toolCalls.length) { ... }
```

### Don't mutate directly

```ts
// Good - create new object
const updated = {
    ...message,
    text: newText
};

// Bad - mutates reactive state
message.text = newText;
```

### Use computed for derived state

```ts
// Good
const hasToolCalls = computed(() =>
    !!message.value.toolCalls?.length
);

// Bad - recalculates on every render
const hasToolCalls = !!message.toolCalls?.length;
```

---

## Limitations

- Tool call status is local only (not persisted)
- Pending flag cleared on page reload
- No nested tool call tracking
- Attachments are resolved by components, not by this module

---

## Related

- `useChat` — Chat composable that creates UI messages
- `ChatMessage.vue` — Component that renders UI messages
- `workflow-types.ts` — `UiWorkflowState` definition
- `~/utils/files/attachments` — File hash parsing helpers
- `~/db/messages` — Database message schema

---

## TypeScript

Full type definitions:

```ts
interface UiChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string;
    file_hashes?: string[];
    reasoning_text?: string | null;
    stream_id?: string;
    pending?: boolean;
    toolCalls?: ToolCallInfo[];
    parts?: UiChatMessagePart[];
    error?: string | null;
    isWorkflow?: boolean;
    workflowState?: UiWorkflowState;
}

interface ToolCallInfo {
    id?: string;
    name: string;
    label?: string;
    status: 'loading' | 'complete' | 'error' | 'pending';
    args?: string;
    result?: string;
    error?: string;
    fingerprint?: string;
    completedAt?: number;
}

type UiChatMessagePart =
    | { id: string; type: 'text'; text: string }
    | { id: string; type: 'tool'; toolCall: ToolCallInfo };

function ensureUiMessage(raw: RawMessageLike): UiChatMessage;
function partsToText(
    parts: string | ContentPartLike[] | null | undefined,
    role?: string
): string;
```

---

Document generated from `app/utils/chat/uiMessages.ts` implementation.
