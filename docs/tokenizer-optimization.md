# Tokenizer Optimization

## Overview

Migrated `gpt-tokenizer` from top-level imports to a worker-powered, dynamically imported tokenizer system. The worker keeps tokenization off the main thread while preserving SSR safety via graceful fallbacks.

## Changes Made

### 1. Created Composable (`/app/composables/core/useTokenizer.ts`)

-   Provides `countTokens(text)` for single text tokenization
-   Provides `countTokensBatch(items)` for batch tokenization
-   Lazily spins up a shared Web Worker on the client
-   Falls back to dynamic imports when a worker isn't available (SSR / errors)
-   Automatically handles worker lifecycle during HMR

### 2. Updated SystemPromptsModal (`/app/components/chat/SystemPromptsModal.vue`)

-   Removed top-level `import { encode } from 'gpt-tokenizer'`
-   Replaced synchronous computed with async composable-based approach
-   Token counts now updated asynchronously via `watch(prompts, ...)`
-   Maintains same UI/UX with improved performance

### 3. Updated Composables Index (`/app/composables/index.ts`)

-   Added export for `useTokenizer` composable

### 4. Web Worker (`app/workers/tokenizer.worker.ts`)

-   Dedicated worker receives encode/batch requests
-   Dynamically imports `gpt-tokenizer` inside the worker scope
-   Uses strict typings and Nuxt-friendly `new URL(..., import.meta.url)` setup
-   Returns counts back to the main thread with error handling baked in

## Benefits

### Bundle Size

-   **Main bundle no longer includes `gpt-tokenizer` upfront**
-   Library loaded on-demand inside the worker (or fallback) only when needed
-   Reduced initial JavaScript payload
-   Faster initial page load

### Performance

-   **Background processing**: Worker keeps the UI thread responsive
-   **Lazy loading**: `gpt-tokenizer` only fetched when tokenization is needed
-   **Cached encoder**: Encoder cached in the worker and fallback path
-   **Batch processing**: Efficient batch operations for multiple prompts
-   **SSR safe**: Seamlessly falls back to dynamic import when no worker

### Developer Experience

-   Simple API: `const { countTokens } = useTokenizer()`
-   Worker orchestration hidden behind the composable
-   Proper error handling with fallbacks to dynamic imports
-   TypeScript support with typed worker messages

## Usage Example

```typescript
import { useTokenizer } from '~/composables';

const { countTokens, countTokensBatch } = useTokenizer();

// Single text
const count = await countTokens('Hello world');

// Batch
const counts = await countTokensBatch([
    { key: 'prompt1', text: 'First prompt' },
    { key: 'prompt2', text: 'Second prompt' },
]);
// Returns: { prompt1: 2, prompt2: 2 }
```

## Migration Notes

Any future code that needs tokenization should:

1. Use `useTokenizer()` composable instead of importing `gpt-tokenizer` directly
2. Handle async nature of token counting
3. Use batch operations when counting multiple texts for efficiency

## Testing

-   Verify token counts display correctly in SystemPromptsModal
-   Check that worker initializes properly in dev tools
-   Confirm fallback works when worker unavailable
-   Test SSR/SSG builds don't break
