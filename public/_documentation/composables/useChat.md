# useChat

The main composable for managing AI chat conversations in OR3. Handles sending messages, streaming responses, retrying failed messages, and managing conversation state.

Think of `useChat` as your chat conversation manager — it keeps track of all messages, talks to the AI, and handles everything from loading states to error recovery.

---

## What does it do?

`useChat` is the heart of every chat conversation. When you want to:

- Send a message to an AI model
- Display a conversation with streaming responses
- Retry a failed message
- Show loading states while the AI is thinking
- Cancel an ongoing AI response

...this composable handles all of that for you.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useChat } from '~/composables/chat/useAi';

// Create a new chat
const chat = useChat();

// Send a message
async function ask() {
  await chat.sendMessage('Hello, how are you?');
}
</script>

<template>
  <div>
    <!-- Show all messages -->
    <div v-for="msg in chat.messages.value" :key="msg.id">
      <strong>{{ msg.role }}:</strong> {{ msg.text }}
    </div>

    <!-- Show loading state -->
    <div v-if="chat.loading.value">AI is thinking...</div>

    <!-- Send button -->
    <button @click="ask" :disabled="chat.loading.value">
      Send Message
    </button>
  </div>
</template>
```

---

## How to use it

### 1. Create a chat instance

```ts
// Start a new conversation
const chat = useChat();

// Or continue an existing thread
const chat = useChat(existingMessages, 'thread-id-123');

// Or with a pending system prompt
const chat = useChat([], undefined, 'prompt-id-456');
```

### 2. Send messages

```ts
// Simple text message
await chat.sendMessage('What is the weather like?');

// Message with images/files
await chat.sendMessage('Describe this image', {
  files: [{ type: 'image/png', url: 'https://...' }],
  model: 'openai/gpt-4-vision',
  online: false
});

// Message with file attachments (by hash)
await chat.sendMessage('Analyze these files', {
  file_hashes: ['abc123', 'def456'],
  model: 'anthropic/claude-3-sonnet'
});
```

### 3. Handle the response

The AI response appears in two places:

- **During streaming**: `chat.tailAssistant.value` shows the message being written
- **After complete**: The message moves to `chat.messages.value`

```vue
<template>
  <!-- Show completed messages -->
  <div v-for="msg in chat.messages.value" :key="msg.id">
    {{ msg.text }}
  </div>

  <!-- Show streaming message (being written right now) -->
  <div v-if="chat.tailAssistant.value" class="streaming">
    {{ chat.tailAssistant.value.text }}
    <span v-if="chat.tailAssistant.value.pending">▋</span>
  </div>
</template>
```

### 4. Retry failed messages

If a message fails, you can retry it:

```ts
// Retry with the same model
await chat.retryMessage(failedMessageId);

// Retry with a different model
await chat.retryMessage(failedMessageId, 'anthropic/claude-3-opus');
```

### 5. Cancel ongoing responses

```ts
// Stop the AI mid-response
chat.abort();
```

### 6. Clear everything

```ts
// Remove all messages and reset state
chat.clear();
```

---

## What you get back

When you call `useChat()`, you get an object with:

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `Ref<UiChatMessage[]>` | All finalized messages in the conversation |
| `loading` | `Ref<boolean>` | `true` while waiting for AI response |
| `threadId` | `Ref<string \| undefined>` | The database thread ID for this conversation |
| `streamId` | `Ref<string \| undefined>` | Current streaming message ID |
| `streamState` | `object` | Stream status: `{ active, finalized, error, aborted }` |
| `tailAssistant` | `Ref<UiChatMessage \| null>` | The AI message currently being streamed (not in `messages` yet) |
| `sendMessage` | `function` | Send a new user message |
| `retryMessage` | `function` | Retry a failed message |
| `abort` | `function` | Cancel the current AI response |
| `clear` | `function` | Clear all messages |
| `resetStream` | `function` | Reset stream state (usually automatic) |
| `flushTailAssistant` | `function` | Move `tailAssistant` into `messages` (usually automatic) |

---

## Message format

### UiChatMessage

This is what you see in `messages.value` and `tailAssistant.value`:

```ts
interface UiChatMessage {
  id: string;                    // unique message ID
  role: 'user' | 'assistant' | 'system';
  text: string;                  // the actual message text
  file_hashes?: string[];        // attached file references
  reasoning_text?: string;       // AI's reasoning (if model supports it)
  stream_id?: string;            // for tracking streaming messages
  pending?: boolean;             // true while streaming
}
```

### SendMessageParams

Optional parameters when sending a message:

```ts
interface SendMessageParams {
  files?: { type: string; url: string }[];  // images or files to attach
  model?: string;                           // AI model to use (e.g., 'openai/gpt-4')
  file_hashes?: string[];                   // reference existing files by hash
  extraTextParts?: string[];                // additional text segments
  online: boolean;                          // enable web search (adds ':online' suffix)
}
```

---

## How it works (under the hood)

Here's what happens when you send a message:

1. **Check API key**: Won't send without OpenRouter API key
2. **Apply filters**: Runs `ui.chat.message:filter:outgoing` hook (can block message)
3. **Create thread**: If this is the first message, creates a new thread in the database
4. **Load system prompt**: Fetches the active system prompt for context
5. **Add user message**: Saves your message to the database and updates `messages.value`
6. **Prepare AI request**: 
   - Builds conversation history
   - Removes empty assistant messages (API requirement)
   - Converts to OpenRouter format
   - Applies image limit (5 images max to avoid rate limits)
7. **Start streaming**: Opens a stream to OpenRouter API
8. **Process chunks**: As AI responds:
   - Text chunks update `tailAssistant.value.text`
   - Generated images get saved and attached
   - Reasoning text (if supported) goes into `reasoning_text`
   - Progress saved to DB every 500ms
9. **Apply incoming filter**: Runs `ui.chat.message:filter:incoming` hook
10. **Finalize**: Saves complete message to DB and emits completion hooks

If anything fails, the error is caught and you can retry.

---

## Common patterns

### Check if chat is ready

```ts
if (chat.loading.value) {
  console.log('Please wait, AI is responding...');
}
```

### Show streaming indicator

```vue
<div v-if="chat.tailAssistant.value?.pending">
  AI is typing<span class="dots">...</span>
</div>
```

### Handle retry button

```vue
<button 
  v-if="message.error" 
  @click="chat.retryMessage(message.id)"
>
  Retry
</button>
```

### Cancel long responses

```vue
<button 
  v-if="chat.loading.value" 
  @click="chat.abort"
  class="danger"
>
  Stop Generating
</button>
```

### Multi-model support

```ts
// Let user pick model
const selectedModel = ref('anthropic/claude-3-sonnet');

await chat.sendMessage(userInput, {
  model: selectedModel.value,
  online: false
});
```

### Attach images

```ts
// From file input
const fileUrl = URL.createObjectURL(file);
await chat.sendMessage('What is this?', {
  files: [{ type: file.type, url: fileUrl }],
  model: 'openai/gpt-4-vision'
});
```

---

## Important notes

### Memory management

- `messages.value` contains finalized messages only
- `tailAssistant.value` holds the message currently being streamed
- When you send a new message, `tailAssistant` automatically moves to `messages`
- Call `clear()` to free memory if the conversation gets very long

### Thread creation

If you don't provide a `threadId`, the first `sendMessage` creates one automatically:
- Title: first 6 words of your message
- System prompt: uses pending prompt or default
- Timestamp: set to now

### Retry behavior

When you retry a message:
1. Finds the user message and its assistant response
2. Deletes both from database and memory
3. Re-sends with original text and attachments
4. Creates new message IDs

### Hooks integration

The composable emits several hook events you can listen to:

- `ui.chat.message:filter:outgoing` — before sending (can veto)
- `ui.chat.message:filter:incoming` — after receiving (can transform)
- `ai.chat.model:filter:select` — choose/override model
- `ai.chat.messages:filter:input` — modify conversation history
- `ai.chat.send:action:before` — before AI call
- `ai.chat.send:action:after` — after completion/abort
- `ai.chat.stream:action:complete` — stream finished
- `ai.chat.stream:action:error` — stream error
- `ai.chat.retry:action:before` — before retry
- `ai.chat.retry:action:after` — after retry
- `ui.pane.msg:action:sent` — multi-pane message sent
- `ui.pane.msg:action:received` — multi-pane message received

### Image handling

- User images: displayed in attachments gallery (not embedded in text)
- AI-generated images: embedded as markdown `![image](url)` in message text
- Image limit: Max 5 images per request (automatically trimmed)
- Previous assistant images are carried forward in conversation

### Model selection

If you don't specify a model, it uses:
1. Last selected model (from localStorage)
2. Fixed model (from settings)
3. Fallback: `openai/gpt-oss-120b`

### Online mode

Add `:online` suffix to enable web search:
```ts
await chat.sendMessage('Latest news?', {
  model: 'anthropic/claude-3-sonnet',
  online: true  // becomes 'anthropic/claude-3-sonnet:online'
});
```

---

## Troubleshooting

### "Message blocked"
Your message was filtered by an outgoing hook. Check hook extensions.

### Empty responses
Check if API key is valid and model is available.

### Stream errors
Usually network issues or invalid API responses. Retry should work.

### Memory issues with long conversations
Call `clear()` or create a new chat instance for fresh conversation.

### Images not showing
- User images: Check `file_hashes` are valid
- AI images: Must use vision-capable model

---

## Related

- `useActivePrompt` — manage system prompts
- `useUserApiKey` — OpenRouter API key management
- `useAiSettings` — model preferences and master system prompt
- `useModelStore` — available models catalog
- `~/db/messages` — direct database access
- `~/db/threads` — thread management

---

## TypeScript

Full type signature:

```ts
function useChat(
  msgs?: ChatMessage[],
  initialThreadId?: string,
  pendingPromptId?: string
): {
  messages: Ref<UiChatMessage[]>;
  loading: Ref<boolean>;
  threadId: Ref<string | undefined>;
  streamId: Ref<string | undefined>;
  streamState: {
    active: Ref<boolean>;
    finalized: Ref<boolean>;
    error: Ref<Error | null>;
    aborted: Ref<boolean>;
  };
  tailAssistant: Ref<UiChatMessage | null>;
  sendMessage: (content: string, params?: SendMessageParams) => Promise<void>;
  retryMessage: (messageId: string, modelOverride?: string) => Promise<void>;
  abort: () => void;
  clear: () => void;
  resetStream: () => void;
  flushTailAssistant: () => void;
}
```

---

## Example: Full chat component

```vue
<template>
  <div class="chat-container">
    <!-- Message list -->
    <div class="messages">
      <div 
        v-for="msg in chat.messages.value" 
        :key="msg.id"
        :class="`message message-${msg.role}`"
      >
        <div class="role">{{ msg.role }}</div>
        <div class="text">{{ msg.text }}</div>
        <button 
          v-if="msg.role === 'assistant'" 
          @click="retry(msg.id)"
          class="retry-btn"
        >
          ↻ Retry
        </button>
      </div>

      <!-- Streaming message -->
      <div 
        v-if="chat.tailAssistant.value" 
        class="message message-assistant streaming"
      >
        <div class="role">assistant</div>
        <div class="text">
          {{ chat.tailAssistant.value.text }}
          <span v-if="chat.tailAssistant.value.pending" class="cursor">▋</span>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="input-area">
      <textarea 
        v-model="input" 
        @keydown.enter.meta="send"
        :disabled="chat.loading.value"
        placeholder="Type your message..."
      />
      <button 
        v-if="!chat.loading.value"
        @click="send"
        :disabled="!input.trim()"
      >
        Send
      </button>
      <button 
        v-else
        @click="chat.abort()"
        class="stop-btn"
      >
        Stop
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useChat } from '~/composables/chat/useAi';

const chat = useChat();
const input = ref('');

async function send() {
  if (!input.value.trim()) return;
  const text = input.value;
  input.value = '';
  await chat.sendMessage(text);
}

async function retry(messageId: string) {
  await chat.retryMessage(messageId);
}
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.message {
  margin-bottom: 1rem;
  padding: 0.5rem;
  border-radius: 4px;
}

.message-user {
  background: #e3f2fd;
  margin-left: 20%;
}

.message-assistant {
  background: #f5f5f5;
  margin-right: 20%;
}

.streaming .cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.input-area {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid #ddd;
}

textarea {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: none;
  font-family: inherit;
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  background: #2196f3;
  color: white;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stop-btn {
  background: #f44336;
}

.retry-btn {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  background: #757575;
}
</style>
```

---

Document generated from `app/composables/chat/useAi.ts` implementation.
