# useTokenizer

Composable for GPT tokenization with automatic Web Worker optimization. Counts tokens using a dedicated worker thread when available, falling back to direct encoding for SSR or when workers fail.

Think of `useTokenizer` as your token counter — it gives you accurate GPT token counts for chat messages, prompts, and documents while keeping the main thread responsive through worker-based parallelization.

---

## Purpose

`useTokenizer` is the go-to solution for token counting in OR3. When you want to:

-   Count tokens in user messages before sending to AI
-   Display token usage in real-time as users type
-   Validate message length against model limits
-   Calculate costs based on token counts
-   Count tokens in batches for multiple texts
-   Keep the UI responsive during heavy tokenization

...this composable handles all of that for you.

---

## Basic Example

Here's the simplest way to use it:

```vue
<script setup>
import { useTokenizer } from '~/composables/core/useTokenizer';

const tokenizer = useTokenizer();
const messageText = ref('');

// Count tokens in a single message
const tokenCount = ref(0);

watch(messageText, async (text) => {
    tokenCount.value = await tokenizer.countTokens(text);
});
</script>

<template>
    <div>
        <textarea v-model="messageText" placeholder="Type your message..." />
        <p>Token count: {{ tokenCount }}</p>
        <p v-if="!tokenizer.isReady.value">Loading tokenizer...</p>
    </div>
</template>
```

---

## How to use it

### 1. Create a tokenizer instance

```ts
import { useTokenizer } from '~/composables/core/useTokenizer';

const tokenizer = useTokenizer();
```

Each component gets its own instance, but they all share the same worker thread for efficiency.

### 2. Count tokens in a single text

```ts
// Count tokens in a message
const count = await tokenizer.countTokens('Hello, world!');
console.log(`Token count: ${count}`);

// Empty strings return 0
const empty = await tokenizer.countTokens('');
console.log(empty); // 0
```

### 3. Count tokens in batches

```ts
// Count multiple texts at once
const texts = [
    { key: 'greeting', text: 'Hello, how are you?' },
    { key: 'question', text: 'What is the weather like today?' },
    { key: 'farewell', text: 'Goodbye!' },
];

const results = await tokenizer.countTokensBatch(texts);
console.log(results);
// {
//   greeting: 6,
//   question: 8,
//   farewell: 2
// }
```

### 4. Check if tokenizer is ready

```ts
// Wait for worker initialization
if (!tokenizer.isReady.value) {
    console.log('Tokenizer is initializing...');
}

await nextTick(); // Or use a watcher
```

---

## What you get back

When you call `useTokenizer()`, you get an object with:

| Property            | Type                                                        | Description                                    |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `countTokens`       | `(text: string) => Promise<number>`                         | Count tokens in a single text                  |
| `countTokensBatch`  | `(items: Array<{key: string, text: string}>) => Promise<Record<string, number>>` | Count tokens for multiple texts |
| `isReady`           | `Ref<boolean>`                                              | `true` when tokenizer is ready to use          |

---

## How it works (under the hood)

Here's what happens when you count tokens:

### Single text counting

1. **Check for empty text**: Returns `0` immediately if text is empty
2. **Try worker**: If on client, attempts to use the Web Worker
3. **Send request**: Posts message to worker with unique ID
4. **Wait for response**: Worker tokenizes and returns count
5. **Fallback on error**: If worker fails, uses direct `gpt-tokenizer` import
6. **Return count**: Returns the final token count

### Batch counting

1. **Check for empty batch**: Returns `{}` immediately if no items
2. **Try worker**: Attempts to use Web Worker for parallel processing
3. **Send batch request**: Posts all texts with their keys
4. **Worker processes**: Tokenizes all texts in the worker thread
5. **Return results**: Returns object mapping keys to counts
6. **Fallback**: If worker fails, processes each text sequentially

### Worker lifecycle

-   **Singleton**: All composable instances share one worker
-   **Lazy initialization**: Worker created on first use
-   **Auto-recovery**: Worker recreated if it crashes
-   **HMR cleanup**: Worker terminated on hot module reload
-   **SSR-safe**: Falls back to direct import during SSR

---

## Common patterns

### Real-time token display

```vue
<script setup>
const tokenizer = useTokenizer();
const message = ref('');
const tokens = ref(0);

// Debounce for better performance
const debouncedCount = useDebounceFn(async (text: string) => {
    tokens.value = await tokenizer.countTokens(text);
}, 300);

watch(message, (text) => {
    debouncedCount(text);
});
</script>

<template>
    <div>
        <textarea v-model="message" />
        <span class="token-count">{{ tokens }} tokens</span>
    </div>
</template>
```

### Validate message length

```ts
const tokenizer = useTokenizer();
const maxTokens = 4096;

async function validateMessage(text: string): Promise<boolean> {
    const count = await tokenizer.countTokens(text);
    
    if (count > maxTokens) {
        console.warn(`Message too long: ${count}/${maxTokens} tokens`);
        return false;
    }
    
    return true;
}
```

### Batch count conversation history

```ts
const tokenizer = useTokenizer();

async function countConversationTokens(messages: ChatMessage[]) {
    const items = messages.map((msg, idx) => ({
        key: `msg-${idx}`,
        text: msg.text,
    }));
    
    const counts = await tokenizer.countTokensBatch(items);
    
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`Total conversation tokens: ${total}`);
    
    return { counts, total };
}
```

### Cost estimation

```ts
const tokenizer = useTokenizer();

async function estimateCost(text: string, costPerToken: number = 0.00002) {
    const tokens = await tokenizer.countTokens(text);
    const cost = tokens * costPerToken;
    
    return {
        tokens,
        cost: cost.toFixed(4),
    };
}

// Usage
const { tokens, cost } = await estimateCost(userMessage);
console.log(`${tokens} tokens = $${cost}`);
```

### Progress tracking for large batches

```ts
const tokenizer = useTokenizer();

async function countWithProgress(
    texts: Array<{ key: string; text: string }>,
    onProgress?: (current: number, total: number) => void
) {
    const batchSize = 50;
    const results: Record<string, number> = {};
    
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await tokenizer.countTokensBatch(batch);
        
        Object.assign(results, batchResults);
        
        if (onProgress) {
            onProgress(Math.min(i + batchSize, texts.length), texts.length);
        }
    }
    
    return results;
}
```

### Conditional warning display

```vue
<script setup>
const tokenizer = useTokenizer();
const input = ref('');
const tokenCount = ref(0);

const warningLevel = computed(() => {
    if (tokenCount.value > 4000) return 'error';
    if (tokenCount.value > 3000) return 'warning';
    return 'ok';
});

watchDebounced(input, async (text) => {
    tokenCount.value = await tokenizer.countTokens(text);
}, { debounce: 250 });
</script>

<template>
    <div>
        <textarea v-model="input" />
        <div :class="`token-badge ${warningLevel}`">
            {{ tokenCount }} tokens
        </div>
    </div>
</template>

<style scoped>
.token-badge.ok { color: var(--md-primary); }
.token-badge.warning { color: orange; }
.token-badge.error { color: var(--md-error); }
</style>
```

---

## Important notes

### Worker behavior

-   **Shared instance**: All composable instances use the same worker
-   **Automatic recovery**: Worker recreated if it fails or crashes
-   **HMR cleanup**: Worker terminated and recreated on hot reload
-   **Pending requests**: Automatically rejected if worker fails
-   **Client-only**: Worker only runs in browser (falls back on server)

### Performance characteristics

-   **Worker overhead**: Small texts (<100 chars) may be faster with fallback
-   **Batch advantage**: Batches reduce message passing overhead
-   **Main thread**: Fallback runs on main thread (may block on large texts)
-   **Memory**: Worker kept alive for reuse across calls

### SSR safety

-   **Server-side**: Always uses fallback (no workers in SSR)
-   **Initial render**: `isReady` is `false` during SSR
-   **Hydration**: Worker initialized after component mounts
-   **No flash**: Design UI to handle loading state gracefully

### Error handling

-   **Worker errors**: Automatically fall back to direct encoding
-   **Encoding errors**: Rejected promises propagate to caller
-   **Empty text**: Returns `0` without calling worker or fallback
-   **Cleanup**: Pending requests rejected on worker termination

### Fallback behavior

When worker is unavailable:
-   Dynamically imports `gpt-tokenizer` package
-   Caches encoder for subsequent calls
-   Runs synchronously on main thread
-   Same accuracy as worker (uses same encoder)

---

## Performance tips

### Debounce user input

```ts
import { useDebounceFn } from '@vueuse/core';

const debouncedCount = useDebounceFn(async (text: string) => {
    const count = await tokenizer.countTokens(text);
    // Update UI
}, 300);
```

### Use batching for multiple texts

```ts
// ❌ Slow: multiple worker round-trips
for (const msg of messages) {
    const count = await tokenizer.countTokens(msg.text);
}

// ✅ Fast: single batch request
const items = messages.map((msg, i) => ({ key: `${i}`, text: msg.text }));
const counts = await tokenizer.countTokensBatch(items);
```

### Cache results when possible

```ts
const tokenCache = new Map<string, number>();

async function countWithCache(text: string): Promise<number> {
    if (tokenCache.has(text)) {
        return tokenCache.get(text)!;
    }
    
    const count = await tokenizer.countTokens(text);
    tokenCache.set(text, count);
    return count;
}
```

### Avoid counting unchanged text

```ts
const lastText = ref('');
const lastCount = ref(0);

watch(currentText, async (text) => {
    if (text === lastText.value) return;
    
    lastCount.value = await tokenizer.countTokens(text);
    lastText.value = text;
});
```

---

## Troubleshooting

### "Worker not loading"

Worker creation can fail in restrictive environments. Check:
-   CSP (Content Security Policy) allows workers
-   Module workers supported by browser
-   No CORS issues with worker script

Fallback will activate automatically.

### "Counts seem incorrect"

-   Ensure you're using GPT-compatible text
-   Special characters and formatting affect counts
-   Whitespace is tokenized
-   Check for encoding issues in source text

### "Performance issues with large texts"

-   Use debouncing for real-time counting
-   Batch multiple texts together
-   Consider caching results
-   Profile to see if worker vs fallback matters

### "isReady stays false"

-   Check browser console for worker errors
-   Verify component is mounted (SSR context)
-   Worker may have failed to initialize (fallback active)

---

## Type Definitions

```ts
interface UseTokenizerReturn {
    countTokens: (text: string) => Promise<number>;
    countTokensBatch: (items: Array<{ key: string; text: string }>) => Promise<Record<string, number>>;
    isReady: Ref<boolean>;
}

function useTokenizer(): UseTokenizerReturn;
```

### Worker message types

```ts
// Request to worker
type WorkerRequest = 
    | { id: number; type: 'encode'; text: string }
    | { id: number; type: 'batch'; texts: string[]; keys: string[] };

// Response from worker
type WorkerResponse = 
    | { id: number; type: 'result'; count: number }
    | { id: number; type: 'batch-result'; counts: Record<string, number> }
    | { id: number; type: 'error'; error: string };
```

---

## Related

-   `~/workers/tokenizer.worker.ts` — Worker implementation
-   `gpt-tokenizer` — Underlying tokenization library
-   `useChat` — Uses tokenizer for message validation
-   `useAiSettings` — Token limit configuration

---

## Example: Full token counter component

```vue
<template>
    <div class="token-counter">
        <div class="input-section">
            <textarea
                v-model="text"
                placeholder="Enter text to count tokens..."
                class="retro-input"
                rows="10"
            />
        </div>

        <div class="stats-section">
            <div v-if="!tokenizer.isReady.value" class="loading">
                <span class="spinner" />
                Initializing tokenizer...
            </div>

            <div v-else class="stats">
                <div class="stat-item">
                    <span class="label">Tokens:</span>
                    <span class="value" :class="tokenLevel">{{ count }}</span>
                </div>

                <div class="stat-item">
                    <span class="label">Characters:</span>
                    <span class="value">{{ text.length }}</span>
                </div>

                <div class="stat-item">
                    <span class="label">Est. cost:</span>
                    <span class="value">${{ estimatedCost }}</span>
                </div>

                <div v-if="count > 4000" class="warning">
                    ⚠️ Token count exceeds typical model limits
                </div>
            </div>
        </div>

        <div class="actions">
            <button @click="clear" class="retro-btn">Clear</button>
            <button @click="copyStats" class="retro-btn">Copy Stats</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { useTokenizer } from '~/composables/core/useTokenizer';

const tokenizer = useTokenizer();
const text = ref('');
const count = ref(0);

const tokenLevel = computed(() => {
    if (count.value > 4000) return 'error';
    if (count.value > 3000) return 'warning';
    return 'normal';
});

const estimatedCost = computed(() => {
    // Example: GPT-4 pricing
    const costPer1kTokens = 0.03;
    const cost = (count.value / 1000) * costPer1kTokens;
    return cost.toFixed(4);
});

// Debounce token counting for better performance
const debouncedCount = useDebounceFn(async (newText: string) => {
    count.value = await tokenizer.countTokens(newText);
}, 300);

watch(text, (newText) => {
    debouncedCount(newText);
});

function clear() {
    text.value = '';
    count.value = 0;
}

async function copyStats() {
    const stats = `
Tokens: ${count.value}
Characters: ${text.length}
Estimated cost: $${estimatedCost.value}
    `.trim();

    await navigator.clipboard.writeText(stats);
    console.log('Stats copied to clipboard');
}
</script>

<style scoped>
.token-counter {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    max-width: 800px;
    margin: 0 auto;
}

.retro-input {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid var(--md-primary);
    background: var(--md-surface);
    color: var(--md-on-surface);
    font-family: 'VT323', monospace;
    font-size: 1rem;
    resize: vertical;
}

.stats-section {
    padding: 1rem;
    border: 2px solid var(--md-outline);
    background: var(--md-surface-variant);
}

.loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--md-on-surface-variant);
}

.spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--md-outline);
    border-top-color: var(--md-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.stats {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.stat-item {
    display: flex;
    justify-content: space-between;
    font-family: 'Press Start 2P', monospace;
    font-size: 0.75rem;
}

.label {
    color: var(--md-on-surface-variant);
}

.value {
    font-weight: bold;
}

.value.normal {
    color: var(--md-primary);
}

.value.warning {
    color: orange;
}

.value.error {
    color: var(--md-error);
}

.warning {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: rgba(255, 152, 0, 0.1);
    border: 1px solid orange;
    color: orange;
    font-size: 0.875rem;
}

.actions {
    display: flex;
    gap: 0.5rem;
}

.retro-btn {
    padding: 0.5rem 1rem;
    border: 2px solid var(--md-primary);
    background: var(--md-surface);
    color: var(--md-on-surface);
    cursor: pointer;
    font-family: 'Press Start 2P', monospace;
    font-size: 0.75rem;
    transition: all 0.2s;
}

.retro-btn:hover {
    background: var(--md-primary);
    color: var(--md-on-primary);
}
</style>
```

---

Document generated from `app/composables/core/useTokenizer.ts` implementation.
