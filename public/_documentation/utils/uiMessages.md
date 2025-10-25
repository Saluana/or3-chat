# UI Messages

Type definitions and utilities for chat messages in the OR3 UI layer. Extends database message types with display properties like attachments, tool calls, and pending states.

Think of `uiMessages` as the bridge between raw database records and what you actually render in the chat — it adds UI sugar like file previews, tool execution status, and streaming indicators without cluttering the database schema.

---

## Purpose

The UI message types provide:

- **Display-ready messages** — Enriched with attachments and tool call info
- **Type safety** — Full TypeScript support for all message variants
- **Tool call tracking** — Status, arguments, and results for inline display
- **Attachment mapping** — Links file hashes to preview URLs
- **Streaming state** — Pending flags for active AI responses

---

## Core Types

### `UiChatMessage`

The main message type used throughout chat components.

```ts
interface UiChatMessage {
    id: string;                          // Unique message ID
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string;                        // Message content
    file_hashes?: string[];              // Attached file references
    reasoning_text?: string;             // AI reasoning (if supported)
    stream_id?: string;                  // For tracking streaming messages
    pending?: boolean;                   // True while streaming
    toolCalls?: ToolCallInfo[];          // Active tool calls
    attachments?: AttachmentWithPreview[]; // Files with preview URLs
}
```

### `ToolCallInfo`

Tracks the lifecycle of a single tool invocation.

```ts
interface ToolCallInfo {
    id: string;                 // Tool call ID from OpenRouter
    name: string;               // Tool function name
    arguments: string;          // JSON arguments
    result?: string;            // Handler result
    error?: string;             // Error message if failed
    status: 'loading' | 'complete' | 'error';
}
```

### `AttachmentWithPreview`

File attachment enriched with preview URL.

```ts
interface AttachmentWithPreview {
    hash: string;              // File hash
    name: string;              // Original filename
    size: number;              // File size in bytes
    type: string;              // MIME type
    previewUrl?: string;       // Blob URL for preview
}
```

---

## Functions

### `ensureUiMessage(msg)`

Convert a raw database message into a UI message with attachments.

```ts
function ensureUiMessage(msg: any): UiChatMessage
```

**What it does:**

1. Extracts tool calls from `data.tool_calls` if present
2. Maps `file_hashes` to full `AttachmentWithPreview` objects
3. Preserves all original fields
4. Returns a typed `UiChatMessage`

**Example:**

```ts
import { ensureUiMessage } from '~/utils/chat/uiMessages';

const rawMsg = {
    id: '123',
    role: 'user',
    text: 'Hello',
    file_hashes: ['abc', 'def'],
    data: {}
};

const uiMsg = ensureUiMessage(rawMsg);
// uiMsg.attachments is now an array with file details
```

### `extractToolCalls(data)`

Pull tool call info from a message's data field.

```ts
function extractToolCalls(data: any): ToolCallInfo[] | undefined
```

Returns undefined if no tool calls present.

**Example:**

```ts
const toolCalls = extractToolCalls(message.data);
if (toolCalls) {
    console.log('Tool calls:', toolCalls.length);
}
```

---

## How it works

### Message enrichment flow

1. Raw message loaded from Dexie
2. `ensureUiMessage` called during history load
3. Tool calls extracted from `data.tool_calls`
4. File hashes mapped to attachment objects
5. Result cached in chat state

### Tool call lifecycle

```
loading → handler executing
   ↓
complete → handler succeeded, result available
   ↓
error → handler failed, error message available
```

Status updated in real-time during streaming.

### Attachment resolution

```ts
// In ensureUiMessage:
if (msg.file_hashes?.length) {
    const attachments = await Promise.all(
        msg.file_hashes.map(hash => 
            getAttachmentWithPreview(hash)
        )
    );
    uiMsg.attachments = attachments;
}
```

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
        <span v-if="call.status === 'loading'">⏳ Executing...</span>
        <span v-else-if="call.status === 'complete'">✓ Done</span>
        <span v-else-if="call.status === 'error'">⚠️ {{ call.error }}</span>
    </div>
</template>
```

### Show attachments

```vue
<template>
    <div v-if="message.attachments?.length" class="attachments">
        <img 
            v-for="att in message.attachments" 
            :key="att.hash"
            :src="att.previewUrl"
            :alt="att.name"
        />
    </div>
</template>
```

### Streaming indicator

```ts
const isStreaming = computed(() => 
    message.pending || message.toolCalls?.some(t => t.status === 'loading')
);
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
        
        <!-- Attachments -->
        <AttachmentGallery 
            v-if="message.attachments?.length"
            :attachments="message.attachments"
        />
    </div>
</template>
```

### `useChat.ts`

```ts
import { ensureUiMessage } from '~/utils/chat/uiMessages';

// When loading history
const uiMessages = rawMessages.map(m => ensureUiMessage(m));
messages.value = uiMessages;

// When receiving streaming updates
const tailMsg = ensureUiMessage({
    id: streamId,
    role: 'assistant',
    text: accumulatedText,
    pending: true,
    toolCalls: activeToolCalls.value
});
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

// Bad - missing attachments and tool calls
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
const hasAttachments = computed(() => 
    !!message.value.attachments?.length
);

// Bad - recalculates on every render
const hasAttachments = !!message.attachments?.length;
```

---

## Limitations

- Attachment preview URLs are blob URLs (memory-bound)
- Tool call status is local only (not persisted)
- Pending flag cleared on page reload
- No nested tool call tracking

---

## Related

- `useChat` — Chat composable that creates UI messages
- `ChatMessage.vue` — Component that renders UI messages
- `ToolCallIndicator.vue` — Displays tool call status
- `~/db/messages` — Database message schema
- `~/utils/files/attachments` — Attachment utilities

---

## TypeScript

Full type definitions:

```ts
interface UiChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    text: string;
    file_hashes?: string[];
    reasoning_text?: string;
    stream_id?: string;
    pending?: boolean;
    toolCalls?: ToolCallInfo[];
    attachments?: AttachmentWithPreview[];
}

interface ToolCallInfo {
    id: string;
    name: string;
    arguments: string;
    result?: string;
    error?: string;
    status: 'loading' | 'complete' | 'error';
}

interface AttachmentWithPreview {
    hash: string;
    name: string;
    size: number;
    type: string;
    previewUrl?: string;
}

function ensureUiMessage(msg: any): UiChatMessage;
function extractToolCalls(data: any): ToolCallInfo[] | undefined;
```

---

Document generated from `app/utils/chat/uiMessages.ts` implementation.
