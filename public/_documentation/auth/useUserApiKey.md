# useUserApiKey

Composable for managing the OpenRouter API key in shared application state. Provides reactive access to the stored API key with sync between global state and Dexie database.

Think of `useUserApiKey` as your API key vault — it securely stores and retrieves your OpenRouter credentials while keeping everything in sync.

---

## What does it do?

`useUserApiKey` manages API key storage and retrieval. When you want to:

- Check if an API key is stored
- Get the current API key as a reactive ref
- Update the API key in state
- Clear the API key

...this composable handles all of that for you.

---

## Basic Example

```vue
<script setup>
import { useUserApiKey } from '~/core/auth/useUserApiKey';

const { apiKey, setKey, clearKey } = useUserApiKey();

function storeKey(newKey: string) {
  setKey(newKey);
}

function removeKey() {
  clearKey();
}
</script>

<template>
  <div>
    <!-- Check if connected -->
    <div v-if="apiKey.value">
      ✓ API Key stored ({{ apiKey.value.substring(0, 5) }}...)
      <button @click="removeKey">Clear</button>
    </div>
    
    <!-- Disconnected state -->
    <div v-else>
      No API key. Connect to OpenRouter first.
    </div>
  </div>
</template>
```

---

## How to use it

### 1. Create a key manager instance

```ts
import { useUserApiKey } from '~/core/auth/useUserApiKey';
const { apiKey, setKey, clearKey } = useUserApiKey();
```

### 2. Read the API key

```ts
// Reactive ref - updates when key changes
if (apiKey.value) {
  console.log('Key exists:', apiKey.value.length, 'characters');
}

// Watch for changes
watch(apiKey, (newKey) => {
  if (newKey) console.log('Key updated');
  else console.log('Key cleared');
});
```

### 3. Set a new key (in memory)

```ts
const newKey = 'sk-or-...';
setKey(newKey);

// Key is immediately available
console.log(apiKey.value); // 'sk-or-...'
```

`setKey()` only updates memory. The key is lost on reload unless you persist it:

```ts
// Canonical save path: validates, writes Dexie KV, and updates state
await persistUserApiKey('sk-or-...');
```

### 4. Clear the key

```ts
clearKey();

// Key is now null
console.log(apiKey.value); // null
```

`clearKey()` also only updates memory. For a full disconnect that also clears storage, call `logoutOpenRouter()` from `useOpenRouterAuth`.

---

## What you get back

When you call `useUserApiKey()`, you get:

| Property | Type | Description |
|----------|------|-------------|
| `apiKey` | `Ref<string \| null>` | Current API key or null |
| `setKey` | `(key: string) => void` | Store a new key |
| `clearKey` | `() => void` | Clear the key |

---

## How it works (under the hood)

Here's the flow:

1. **Initialization**: On client mount, fetches key from Dexie `kv` table
2. **Async load**: Key loads asynchronously without blocking composable
3. **State sync**: Key stored in shared `state.value.openrouterKey`
4. **Reactive ref**: Computed ref wraps state for reactivity
5. **Updates**: `setKey/clearKey` immediately update state (memory only)
6. **Persistence**: `persistUserApiKey()` or the OAuth callback writes the key to KV

The key is stored in Dexie's KV table with name `'openrouter_api_key'`.

---

## Save and validate a key

The module also exports two helpers used by the paste-key and OAuth flows:

### `persistUserApiKey(key)`

This is the canonical way to save a key. It:

1. Trims the input and validates its format
2. Throws an error if the format is invalid
3. Writes the key to the Dexie `kv` table (survives reloads)
4. Updates the global reactive state
5. Dispatches the `openrouter:connected` event

```ts
import { persistUserApiKey } from '~/core/auth/useUserApiKey';

try {
  await persistUserApiKey('sk-or-abc123...');
} catch (e) {
  console.error('Invalid key format', e);
}
```

Never set `state.value.openrouterKey` directly without `kv.set()`. The key is lost on reload.

### `isValidOpenRouterKeyFormat(key)`

Checks the shape of a key:

- Starts with `sk-or-`
- Has at least 8 characters after the prefix

```ts
import { isValidOpenRouterKeyFormat } from '~/core/auth/useUserApiKey';

isValidOpenRouterKeyFormat('sk-or-abc123...'); // true
isValidOpenRouterKeyFormat('sk_abc123...');    // false
```

### `hydrateUserApiKeyFromKv()`

Loads the key from Dexie into global state. `useUserApiKey()` calls this once on the first client-side call; you normally do not need to call it yourself.

---

## Common patterns

### Guard against missing key

```ts
function useChatIfReady() {
  const { apiKey } = useUserApiKey();
  
  return {
    canChat: computed(() => !!apiKey.value),
    requiresAuth: computed(() => !apiKey.value)
  };
}
```

### Sync with auth state

```ts
const { apiKey } = useUserApiKey();
const { startLogin } = useOpenRouterAuth();

async function ensureAuth() {
  if (!apiKey.value) {
    await startLogin();
  }
}
```

### Mask key for display

```ts
const { apiKey } = useUserApiKey();

const maskedKey = computed(() => {
  if (!apiKey.value) return '';
  return apiKey.value.substring(0, 5) + '...' + apiKey.value.substring(-5);
});
```

### Auto-clear on error

```ts
const { apiKey, clearKey } = useUserApiKey();

async function validateKey() {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey.value}` }
    });
    if (resp.status === 401) {
      clearKey(); // Unauthorized - clear it
    }
  } catch {}
}
```

---

## Important notes

### Client-only

- `useUserApiKey` only works on client (checks `import.meta.client`)
- Server-side calls return null
- Composable is safe to call from SSR components (no error)

### Async initialization

Key loads asynchronously from Dexie:
- Composable returns immediately with `apiKey.value` possibly null
- Key updates reactively when database fetch completes
- No `await` needed — just watch `apiKey` ref

### Security

- Key is never logged
- Key stored in Dexie (IndexedDB) — per-domain storage
- Key in state is memory-only (cleared on tab close if not persisted)
- Logout clears it from both localStorage and KV table

### State vs Storage

- **`state.value.openrouterKey`**: In-memory, fast access, cleared on refresh
- **Dexie KV table**: Persistent, cross-component, slower to read
- **Sync**: `useUserApiKey` loads from KV on mount

---

## Related

- `useOpenRouterAuth` — get a key via PKCE login
- `exchangeOpenRouterCode` — returns the key after successful auth; the callback page persists it via KV
- `useChat` — uses key for API requests
- `~/db/kv` — underlying KV storage

---

## TypeScript

```ts
function useUserApiKey(): {
  apiKey: Ref<string | null>;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export function isValidOpenRouterKeyFormat(key: string): boolean;
export async function persistUserApiKey(key: string): Promise<void>;
export async function hydrateUserApiKeyFromKv(): Promise<void>;
```

---

Document generated from `app/core/auth/useUserApiKey.ts` implementation.
