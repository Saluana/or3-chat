# buildOpenRouterMessages

Utility for building OpenAI-compatible message arrays with hydrated images and files. Converts internal message format to OpenRouter API format with support for image deduplication, limits, and historical image inclusion policies.

Think of `buildOpenRouterMessages` as your message translator — it takes your chat messages and converts them into the exact format OpenRouter expects, handling all the tricky image and file stuff.

---

## What does it do?

`buildOpenRouterMessages` prepares messages for the OpenRouter API by:

- Converting internal format to OpenAI-compatible content arrays
- Hydrating file hashes into data URLs
- Deduplicating and limiting images
- Applying inclusion policies (all vs recent vs role-based)
- Handling PDFs, images, and other files

---

## Basic Example

```ts
import { buildOpenRouterMessages } from '~/core/auth/openrouter-build';

const messages = [
  { role: 'user', content: 'Analyze this image', file_hashes: 'hash123' },
  { role: 'assistant', content: 'I see...' }
];

const orMessages = await buildOpenRouterMessages(messages, {
  maxImageInputs: 8,
  dedupeImages: true
});

// Send to OpenRouter API
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ messages: orMessages })
});
```

---

## How to use it

### 1. Prepare your messages

```ts
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | any[];  // string or parts array
  file_hashes?: string;     // space-separated hashes
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are helpful' },
  { role: 'user', content: 'Hi', file_hashes: 'hash1 hash2' },
  { role: 'assistant', content: 'Hello!' }
];
```

### 2. Build with options

```ts
const orMessages = await buildOpenRouterMessages(messages, {
  maxImageInputs: 8,           // Total images across history
  dedupeImages: true,          // Skip duplicate hashes
  imageInclusionPolicy: 'all', // 'all' | 'recent' | 'recent-user' | 'recent-assistant'
  recentWindow: 12,            // Last N messages when using recent policy
  debug: false
});
```

### 3. Result format

```ts
interface ORMessage {
  role: 'user' | 'assistant' | 'system';
  content: ORContentPart[];
}

interface ORContentPart {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string };
  file?: { filename: string; file_data: string };
}
```

---

## Image Inclusion Policies

### 'all' (default)

Include images from all messages, up to `maxImageInputs`.

```ts
// Message 1: [img1]
// Message 2: [img2]
// Message 3: [img3]
// Result: [img1, img2, img3] (or limited to maxImageInputs)
```

### 'recent'

Only include images from the last `recentWindow` messages.

```ts
await buildOpenRouterMessages(messages, {
  imageInclusionPolicy: 'recent',
  recentWindow: 12  // Last 12 messages
});
```

### 'recent-user'

Only images from recent user messages.

```ts
await buildOpenRouterMessages(messages, {
  imageInclusionPolicy: 'recent-user',
  recentWindow: 5  // Last 5 user messages
});
```

### 'recent-assistant'

Only images from recent assistant messages.

```ts
await buildOpenRouterMessages(messages, {
  imageInclusionPolicy: 'recent-assistant',
  recentWindow: 3
});
```

---

## What you get back

```ts
interface ORMessage {
  role: 'user' | 'assistant' | 'system';
  content: ORContentPart[];
}

// ORContentPart can be:

interface ORContentPartText {
  type: 'text';
  text: string;
}

interface ORContentPartImageUrl {
  type: 'image_url';
  image_url: { url: string };
}

interface ORContentPartFile {
  type: 'file';
  file: { filename: string; file_data: string };
}
```

---

## How it works (under the hood)

Here's the flow:

1. **Parse policies**: Determine which messages to inspect for images
2. **Collect candidates**: Find all image/file hashes in candidate messages
3. **External filter**: Optional hook to filter/veto specific images
4. **Dedupe & limit**: Remove duplicates, enforce max count
5. **Group by message**: Organize images back to their original messages
6. **Build content parts**: 
   - Extract text content
   - Hydrate files to data URLs
   - Hydrate hashes to base64 data URLs
   - Add files/images to content array
7. **Return**: OpenRouter-compatible message array

---

## File Hydration

Files are converted to data URLs for API transmission:

### Local hash → data URL

```ts
// Hash from Dexie
hash = 'abc123def456'
→ getFileBlob(hash)
→ blobToDataUrl(blob)
→ 'data:image/png;base64,...'
```

### Remote URL → data URL

```ts
url = 'https://example.com/image.png'
→ fetch(url)
→ blob
→ blobToDataUrl(blob)
→ 'data:image/png;base64,...'
```

### Blob URL → (not sent)

Blob URLs (`blob:`) can't be accessed server-side, so they're skipped.

---

## Caching

Images are cached in memory to avoid repeated conversions:

```ts
// Global caches (persistent in window)
window.__or3ImageDataUrlCache    // Maps ref → data URL
window.__or3ImageHydrateInflight // In-flight promises
```

**Benefits:**
- Fast repeated builds
- No duplicate network requests
- Automatic deduplication

**Lifetime:**
- Cleared on page reload
- Persists across multiple API calls

---

## Common patterns

### Limit to recent images only

```ts
const orMessages = await buildOpenRouterMessages(messages, {
  imageInclusionPolicy: 'recent',
  recentWindow: 5,
  maxImageInputs: 3
});
```

### Vision-only mode (user images only)

```ts
const orMessages = await buildOpenRouterMessages(messages, {
  imageInclusionPolicy: 'recent-user',
  recentWindow: 10,
  maxImageInputs: 5
});
```

### No images (text only)

```ts
const orMessages = await buildOpenRouterMessages(messages, {
  maxImageInputs: 0  // Disables all images
});
```

### Custom filter

```ts
const orMessages = await buildOpenRouterMessages(messages, {
  filterIncludeImages: async (candidates) => {
    // Only include images from user messages
    return candidates.filter(c => c.role === 'user');
  }
});
```

### Debug output

```ts
const orMessages = await buildOpenRouterMessages(messages, {
  debug: true
});
// Logs candidate count, selected count, hydration status
```

---

## Important notes

### Memory limits

- Max 5MB per file (enforced during hydration)
- Large images truncated silently
- Base64 encoding increases size ~33%

### Image types supported

- **Input**: PNG, JPG, GIF, WebP, AVIF
- **Detection**: Via MIME type or file extension
- **Inline formats**: data URLs, https URLs, local hashes, blob URLs

### PDF handling

PDFs are sent as files, not images:

```ts
content: [
  { type: 'text', text: 'Analyze this' },
  { type: 'file', file: { filename: 'doc.pdf', file_data: 'data:application/pdf;base64,...' } }
]
```

### Dedupe strategy

Hashes are compared for exact matches. If same image appears twice:
- First occurrence kept
- Second and later deduplicated (removed)

### Errors on hydration

If any hydration fails:
- Image is skipped silently
- Debug logging shows why
- Rest of message unaffected

---

## Decide modalities

Helper to determine if response should include images:

```ts
import { decideModalities } from '~/core/auth/openrouter-build';

const modalities = decideModalities(orMessages, 'gpt-4-vision');
// Returns: ['text'] or ['text', 'image']
```

Checks:
- If any input images exist
- If prompt mentions "generate/create image"
- Requested model capability

---

## Related

- `useChat` — uses this to build API requests
- `modelsService` — check model capabilities
- `~/db/files` — file storage and retrieval
- OpenRouter API docs — message format reference

---

## TypeScript

```ts
export interface BuildImageCandidate {
  hash: string;
  role: 'user' | 'assistant';
  messageIndex: number;
}

export interface BuildOptions {
  maxImageInputs?: number;
  dedupeImages?: boolean;
  imageInclusionPolicy?: 'all' | 'recent' | 'recent-user' | 'recent-assistant';
  recentWindow?: number;
  filterIncludeImages?: (candidates: BuildImageCandidate[]) => Promise<BuildImageCandidate[]> | BuildImageCandidate[];
  debug?: boolean;
}

export async function buildOpenRouterMessages(
  messages: ChatMessageLike[],
  opts?: BuildOptions
): Promise<ORMessage[]>;

export function decideModalities(
  orMessages: ORMessage[],
  requestedModel?: string
): string[];
```

---

Document generated from `app/core/auth/openrouter-build.ts` implementation.
