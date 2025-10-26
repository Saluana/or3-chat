# Chat Mentions

Enhance your chat conversations by referencing documents and chats directly in your messages. The mentions system lets you @-mention documents and chat threads, automatically injecting their full content as context for the AI.

Think of it as a way to say "Hey AI, here's a specific document/chat you should read" — the mention system fetches it and includes it in the conversation.

---

## Purpose

Chat mentions let you:

-   Reference documents by typing `@` in the chat input
-   Reference previous chat threads by typing `@`
-   Search across your documents and chats with live filtering
-   Automatically include the full content of mentioned items in AI requests
-   Keep track of what context you've added to your conversation
-   Use keyboard or mouse to navigate and select mentions

---

## Basic Usage

### Triggering the mentions dropdown

Simply type `@` in the chat input box:

```
User: @  ← dropdown appears here
```

The dropdown shows:

-   **Search box** — find documents/chats by title
-   **Filter buttons** — toggle between documents and chats
-   **Search results** — relevance-scored matches (if you're typing)
-   **Recommended** — recent/popular items (while searching)
-   **Documents** — all available documents (when not searching)
-   **Chats** — all available chat threads (when not searching)

### Searching for mentions

Type to filter the dropdown:

```
User: @project  ← shows documents/chats matching "project"
```

The search is live and includes:

-   Document/chat titles
-   Fuzzy matching for typos
-   Relevance scoring (best matches first)

### Filtering by source

Click the **Docs** or **Chats** buttons to toggle what's shown:

-   **Docs enabled, Chats disabled** — only documents appear
-   **Docs enabled, Chats enabled** — both appear (default)
-   Both toggled off — shows "Try enabling another source" message

### Selecting a mention

Use one of three methods:

**Keyboard navigation:**

-   `Arrow Up` / `Arrow Down` — cycle through items
-   `Enter` — select the highlighted item
-   `Escape` — close the dropdown

**Mouse navigation:**

-   Click any item to select it

**Programmatic:**

```ts
// From custom logic (advanced)
props.command(mentionItem);
```

### Result: Mention inserted

When you select a mention, OR3:

1. Replaces `@` + search text with a mention token
2. Closes the dropdown
3. Shows the mention in the editor as `@DocumentName` or `@ChatTitle`

Example:

```
Before: "Can you analyze @my"
After:  "Can you analyze @My Project Report"
```

---

## How it works under the hood

### 1. Index initialization

When you first type `@`, the mentions plugin:

-   Loads all documents (posts with `postType='doc'`)
-   Loads all chat threads
-   Builds an Orama search index (~70KB, lazy-loaded)
-   Caches results for fast searching

### 2. Search and ranking

When you type after `@`:

-   Queries the Orama index with fuzzy matching
-   Returns up to 50 results, capped at 5 per source
-   Scores by relevance (exact matches rank higher)
-   Shows search results section first
-   Falls back to substring matching if Orama unavailable

### 3. Context injection

When you send a message with mentions:

1. The mentions plugin scans the editor content for mention nodes
2. For each mentioned item, it resolves the full content:
   - **Documents**: Loads the full markdown/editor content
   - **Chats**: Loads the complete message transcript
3. Truncates each to 50KB (UTF-8 safe) to manage token usage
4. Injects resolved content as `system` role messages before your user message
5. AI receives the context and can reference it

Example system message:

```
(Referenced Document: My Project Report)
# Project Overview
The project aims to...
[full document content]
```

### 4. Index updates

The mentions index stays in sync via database hooks:

-   **Document created** → added to index
-   **Document title changed** → index updated
-   **Chat thread created** → added to index

---

## Complete example

Here's a full chat interaction with mentions:

**User types in chat input:**

```
"@proj"  ← types mention trigger + search
```

**Dropdown shows:**

```
┌─────────────────────────────┐
│ 🔎 [proj________] Docs Chats│
├─────────────────────────────┤
│ 🔎 Search Results           │
│  → My Project Plan (95%)    │
│  → Project Status (87%)     │
│                             │
│ 📄 Documents                │
│  → My Project Proposal      │
│  → Q4 Planning Doc          │
│                             │
│ 💬 Chats                    │
│  → Project Kickoff Call     │
│  → Team Sync #3             │
└─────────────────────────────┘
```

**User presses Down arrow, then Enter:**

```
Selected: "My Project Plan"
```

**Editor shows:**

```
"Can you summarize @My Project Plan"
```

**User sends message:**

System prepares conversation:

```
[
  {
    "role": "system",
    "content": "(Referenced Document: My Project Plan)\n# Project Overview\n..."
  },
  {
    "role": "user",
    "content": "Can you summarize @My Project Plan"
  }
]
```

**AI receives context and responds:**

```
"Based on the project plan, here are the key points:
1. Timeline: 3 months
2. Budget: $50k
..."
```

---

## Features in detail

### Search box

```vue
<template>
  <UInput
    v-model="searchTerm"
    icon="pixelarticons:search"
    placeholder="Search documents or chats..."
    @keydown="handleSearchKeydown"
  />
</template>
```

-   Live filtering as you type
-   Keyboard navigation (Arrow Up/Down, Enter)
-   Instant results with debounce to prevent lag

### Filter buttons

```vue
<template>
  <div class="flex gap-2">
    <UButton
      :color="showDocuments ? 'primary' : 'neutral'"
      @click="toggleSource('document')"
    >
      Docs
    </UButton>
    <UButton
      :color="showChats ? 'primary' : 'neutral'"
      @click="toggleSource('chat')"
    >
      Chats
    </UButton>
  </div>
</template>
```

-   Click to toggle a source on/off
-   Can't disable all sources (at least one required)
-   Buttons show active state with color

### Section organization

Results are grouped by type:

1. **Search Results** — when typing (ranked by score)
2. **Recommended** — scored/fuzzy matches
3. **Documents** — all docs (when not searching)
4. **Chats** — all threads (when not searching)

Max 5 items per section to keep dropdown manageable.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Arrow Up` | Previous item |
| `Arrow Down` | Next item |
| `Enter` | Select current item |
| `Escape` | Close dropdown |

### Selection interception

You can add custom logic when mentions are selected (advanced):

```ts
// In MentionsPopover.vue
function handleCommand(item: MentionItem) {
    // Pre-insertion logic
    console.log('[MentionsPopover] Selected item:', item);
    
    // Examples:
    // - Track analytics: analytics.event('mention_selected', item);
    // - Update state: selectedMention.value = item;
    // - Show notification: toast.info(`Added ${item.label}`);
    
    // Insert the mention (required)
    props.command(item);
    
    // Post-insertion logic (popup closes immediately after)
}
```

The `MentionItem` object contains:

```ts
interface MentionItem {
    id: string;              // UUID of document or thread
    source: 'document' | 'chat';
    label: string;           // Display name
    subtitle?: string;       // Optional description
    score?: number;          // Relevance score (0-1)
}
```

---

## Mention item properties

### Document mention

```ts
{
    id: "abc123-def456",
    source: "document",
    label: "My Project Report",
    subtitle: undefined,
    score: 0.92  // fuzzy match score
}
```

### Chat mention

```ts
{
    id: "thread-789-xyz",
    source: "chat",
    label: "Team Standup - Oct 24",
    subtitle: undefined,
    score: 0.78
}
```

---

## Context resolution details

### Document context

When a document mention is resolved:

1. Fetches from database with `db.posts.get(id)`
2. Checks it's a document (`postType='doc'`) and not deleted
3. Extracts text content from editor structure
4. Truncates to 50KB with UTF-8 safe splitting
5. Prepends `(Referenced Document: Title)` label

Example resolved context:

```
(Referenced Document: Q4 Planning)
# Executive Summary
Q4 focuses on...

## Key Initiatives
1. Launch feature X
2. Improve performance
3. Build API v2

## Timeline
- Oct: Planning
- Nov: Development
- Dec: Testing
```

### Chat context

When a chat mention is resolved:

1. Fetches all messages with `db.messages.where('thread_id').equals(id)`
2. Sorts by index (chronological)
3. Formats as `[ROLE]: [CONTENT]` transcript
4. Truncates to 50KB with UTF-8 safe splitting
5. Prepends `(Referenced Chat: Title)` label

Example resolved context:

```
(Referenced Chat: Project Kickoff)
[2024-10-20]
user: What's our timeline?
assistant: We're targeting Q1 launch...
user: What are the risks?
assistant: Main risks are...
```

### Truncation

To keep token usage reasonable:

-   Max 50KB per mention (configurable via `MAX_CONTEXT_BYTES`)
-   UTF-8 safe truncation (won't split multi-byte chars)
-   Appends `\n...[truncated]` if content is cut
-   Total context across mentions limited by model context window

---

## Architecture

### File structure

```
app/plugins/ChatMentions/
├── index.ts              # Search index, context resolution
├── MentionsList.vue      # Dropdown UI (Nuxt components)
├── MentionsPopover.vue   # Popover positioning
└── suggestions.ts        # TipTap integration

app/plugins/
└── mentions.client.ts    # Nuxt plugin, lazy loading, hooks
```

### Component hierarchy

```
ChatInputDropper.vue
└─ EditorComponent (TipTap)
   └─ MentionExtension
      └─ createMentionSuggestion()
         └─ VueRenderer
            └─ MentionsPopover.vue
               └─ MentionsList.vue
```

### Tech stack

-   **TipTap v3.8.0** — Editor and mention extension
-   **VueRenderer** — Mount Vue components in editor suggestions
-   **tippy.js** — Popover positioning relative to caret
-   **Orama** — Fuzzy search indexing
-   **Nuxt UI** — Dropdown, buttons, input components
-   **OR3 Hooks** — Integration with app events

### Lazy loading

The mentions module loads on-demand:

1. User types `@` in chat input
2. Editor emits `editor:request-extensions` hook
3. Mentions plugin loads TipTap extension + Vue components
4. Orama index built from database (~70KB)
5. Ready for search

~First use: +70KB + startup time
~Subsequent uses: instant

### Storage and persistence

-   **Index**: Orama in-memory database (rebuilt on app start)
-   **Cache**: None (index rebuilt every time)
-   **DB**: Documents and threads stored in Dexie
-   **KV**: No KV storage needed (index auto-updated via hooks)

---

## Customization

### Adjust max results per source

Edit `app/plugins/ChatMentions/index.ts`:

```ts
const MAX_PER_GROUP = 5;  // Change to 10 for more results
```

### Adjust context truncation

```ts
const MAX_CONTEXT_BYTES = 50_000;  // 50KB, change for larger contexts
```

### Change dropdown width

Edit `app/plugins/ChatMentions/MentionsList.vue`:

```vue
<div class="w-[480px] ...">  <!-- Change 480px -->
```

### Custom styling

The dropdown uses Nuxt UI tokens and Tailwind:

```vue
<div
  class="bg-[var(--md-surface)] border-2 border-[var(--md-outline)] retro-shadow"
>
```

Modify these classes to match your theme.

### Add emoji or icons

In `MentionsList.vue`, section headers use emoji:

```ts
const sections = computed<SectionBucket[]>(() => {
    list.push({
        key: 'recommended',
        title: 'Search Results',
        icon: '🔎',  // Change icon here
        items: recommendedItems.value,
    });
    // ...
});
```

---

## Troubleshooting

### Dropdown doesn't appear

1. Check you're typing `@` in the chat input
2. Verify `editor:request-extensions` hook fired (check console)
3. Check for JavaScript errors in browser console
4. Try refreshing the page (HMR sometimes needs reset)

**Solution:**

```ts
// Force reload mentions module
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        delete (window as any).__MENTIONS_EXTENSION__;
    });
}
```

### Search results empty

1. Verify documents exist in your database
2. Try disabling filters (toggle Docs/Chats buttons)
3. Try clearing search term (delete typed text)
4. Check index was initialized (look for console logs)

**Debug:**

```ts
// In browser console
window.__MENTIONS_EXTENSION__  // Should not be undefined
```

### Mentions not injecting context

1. Verify mention was properly inserted (shows `@Name` in editor)
2. Check `ai.chat.messages:filter:input` hook is registered
3. Inspect network request to see if context appears in system messages
4. Check document/chat isn't marked as deleted

**Debug:**

```ts
// Add logging to mentions.client.ts
hooks.on('ai.chat.messages:filter:input', async (messages) => {
    console.log('[mentions] Injecting context into', messages.length, 'messages');
    // ...
});
```

### Dropdown keyboard navigation doesn't work

1. Ensure focus is in the dropdown (not search input)
2. Check search box isn't intercepting keys (may need Enter to confirm search first)
3. Try clicking an item to exit search mode

### Performance issues with many documents

1. Orama index might be large (watch browser memory)
2. Reduce `MAX_PER_GROUP` to trim dropdown size
3. Consider archiving old documents to reduce index

---

## Advanced: Programmatic mentions

### Insert mention via API (internal)

```ts
// From a plugin or component
const mentionItem = {
    id: 'doc-123',
    source: 'document' as const,
    label: 'My Document'
};

// Directly call command (if extension is registered)
const ext = (window as any).__MENTIONS_EXTENSION__;
if (ext && ext.suggestion?.command) {
    ext.suggestion.command(mentionItem);
}
```

### Listen for mention events

```ts
const hooks = useHooks();

// When a mention is selected
hooks.on('ui.editor.mention:selected', (item: MentionItem) => {
    console.log('Mention selected:', item);
    // Your logic here
});
```

### Batch insert mentions

```ts
// Not directly supported; must be done one at a time
// via keyboard or clicking dropdown items
```

---

## Related

-   `useChat` — send messages with mentioned context
-   `ChatInputDropper.vue` — chat input component that triggers mentions
-   `~/db/posts` — document database
-   `~/db/threads` — chat threads database
-   `~/core/search/orama` — search index utilities
-   TipTap Mention extension — `@tiptap/extension-mention`
-   Orama — `@orama/orama` search library

---

## Example: Complete chat with mentions

```vue
<template>
    <div class="chat-container">
        <!-- Messages -->
        <div class="messages">
            <div
                v-for="msg in chat.messages.value"
                :key="msg.id"
                class="message"
                :class="`role-${msg.role}`"
            >
                <strong>{{ msg.role }}:</strong>
                <div class="text">{{ msg.text }}</div>
            </div>
        </div>

        <!-- Chat input with mentions support -->
        <div class="input-area">
            <ChatInputDropper
                ref="inputRef"
                @send="(content) => chat.sendMessage(content)"
                :disabled="chat.loading.value"
            />
            <button
                v-if="chat.loading.value"
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
import ChatInputDropper from '~/components/chat/ChatInputDropper.vue';

const chat = useChat();
const inputRef = ref();

// Mentions are automatically handled by ChatInputDropper
// When user sends a message with mentions:
// 1. Mentions plugin collects mention nodes from editor
// 2. ai.chat.messages:filter:input hook injects context
// 3. Chat sends to AI with full context included
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
    padding: 0.75rem;
    background: var(--md-surface-dim);
    border-radius: 4px;
}

.message.role-user {
    background: var(--md-primary-container);
    margin-left: 10%;
}

.message.role-assistant {
    background: var(--md-secondary-container);
    margin-right: 10%;
}

.text {
    margin-top: 0.5rem;
}

.input-area {
    display: flex;
    gap: 0.5rem;
    padding: 1rem;
    border-top: 1px solid var(--md-outline);
}

.stop-btn {
    padding: 0.5rem 1rem;
    background: var(--md-error);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}
</style>
```

---

## Keyboard reference

| Context | Key | Action |
| --- | --- | --- |
| Search input | `Arrow Down` | Move to first result |
| Search input | `Arrow Up` | Move to last result |
| Search input | `Enter` | Select current item |
| Dropdown | `Arrow Up/Down` | Navigate items |
| Dropdown | `Enter` | Select item |
| Dropdown | `Escape` | Close dropdown |
| Filter button | Click | Toggle Docs/Chats |
| Item | Click | Select |

---

Document generated from `app/plugins/ChatMentions/` implementation.

