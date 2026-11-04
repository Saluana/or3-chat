# Connection and key APIs

These APIs are for OR3 source components. Portable plugins use [SDK model access](/documentation/plugins/plugin-sdk) and do not receive the user's OpenRouter key.

The inference runtime does not choose or persist credentials. Existing host
authentication and request-scoped authorization remain responsible for key
selection; the OpenRouter adapter receives an authorized operation rather than
a new credential store.

## Connect and disconnect from a component

Create `useOpenRouterAuth()` during component setup so its Nuxt runtime configuration and toast dependencies are available. Call its methods from user actions.

```vue
<script setup lang="ts">
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
const { startLogin, logoutOpenRouter, isLoggingIn } = useOpenRouterAuth();
</script>

<template>
  <UButton :loading="isLoggingIn" @click="startLogin()">Connect OpenRouter</UButton>
  <UButton @click="logoutOpenRouter()">Disconnect OpenRouter</UButton>
</template>
```

| Member | Behavior |
| --- | --- |
| `startLogin()` | Checks required Cloud sign-in, creates verifier/state, records PKCE method, and navigates to authorization. |
| `isLoggingIn` | Reactive ref used to prevent duplicate attempts and show progress. |
| `logoutOpenRouter()` | Clears personal key state, persisted KV, and legacy localStorage; dispatches the connection-change signal. |

The login helper always uses S256. It hashes with Web Crypto when available and loads the SHA-256 fallback when Web Crypto is unavailable. The callback uses the saved challenge method. Configuration comes from public runtime values `openRouterAuthUrl`, `openRouterRedirectUri`, and `openRouterClientId`; the API base URL is `public.openRouter.baseUrl`. Use the source configuration rather than adding a second redirect implementation.

## Persist or clear a personal key

```ts
import {
  persistUserApiKey,
  clearPersistedUserApiKey,
  isValidOpenRouterKeyFormat,
  useUserApiKey,
} from '~/core/auth/useUserApiKey';

export async function savePersonalKey(input: string): Promise<void> {
  if (!isValidOpenRouterKeyFormat(input)) throw new Error('Invalid key format');
  await persistUserApiKey(input);
}

export async function removePersonalKey(): Promise<void> {
  await clearPersistedUserApiKey();
}

// Call during client component setup.
const { apiKey } = useUserApiKey();
```

`persistUserApiKey` trims and validates the key, awaits the KV write under `openrouter_api_key`, updates global reactive state, and dispatches `openrouter:connected`. Use it for paste inputs and successful callbacks. Do not set the global state directly or write credentials to localStorage.

`clearPersistedUserApiKey` invalidates in-flight hydration, clears memory immediately, and awaits deleting the KV entry. It can reject if deletion fails. `logoutOpenRouter` wraps that behavior for UI use and handles storage failure; a failed deletion can leave persisted data, so storage errors matter even when the visible state is disconnected.

`useUserApiKey()` exposes a readonly `apiKey` ref, plus `setKey` and `clearKey` for memory-only changes. Those two methods do not persist. Client initialization starts hydration from KV. `hydrateUserApiKeyFromKv()` is also exported; its generation guard prevents an older read overwriting a newer save or clear. Never depend on browser key state as server authorization.

Format validation requires the trimmed `sk-or-` prefix and more than eight characters after it. It performs no provider request and verifies neither balance nor validity. Read key values only when making an authorized request; never log them.

## Callback and code exchange

The callback page `app/pages/openrouter-callback.vue` reads the returned code, verifies state against the saved value when present, retrieves the verifier and method, and calls `exchangeOpenRouterCode` from `~/core/auth/openrouter-auth`. It persists a successful key with `persistUserApiKey` before returning to the app.

| Input | Meaning |
| --- | --- |
| `code` | Authorization code from this attempt. |
| `verifier` | Saved PKCE verifier. |
| `codeMethod` | The saved challenge method. |
| `attempt` | Optional attempt metadata; it does not enable retries. |

The exchange uses the shared SDK client, a 15-second timeout, and retries disabled because the code is single use. Its discriminated result is either `{ ok: true, userKey, status }` or `{ ok: false, reason, status, errorCode?, errorMessage? }`. Failure reasons are `network`, `bad-response`, and `no-key`. The caller owns user-facing recovery; this utility does not display toasts. Do not wrap it in a generic retry loop.

The implementation lives in `app/core/auth/useOpenrouter.ts`, `useUserApiKey.ts`, `openrouter-auth.ts`, and the callback page. The [user connection guide](/documentation/auth/connect) explains recovery without exposing implementation details.

## Direct OpenAI keys

OpenAI models are listed as `@openai/<model>`; the prefix keeps them apart from OpenRouter's `openai/…` routes. They are billed to an OpenAI key. Chat always runs through the OR3 server; on a local install, project-memory inference for an OpenAI fast model calls OpenAI from the browser with the device key, as OpenRouter memory inference does.

```ts
import { useOpenAiKey } from '~/core/auth/useOpenAiKey';

// Call during client component setup.
const { connection, refresh, save, remove } = useOpenAiKey();

export async function connectOpenAi(input: string): Promise<boolean> {
  await save(input); // validates the `sk-` format first
  await refresh(); // updates connection.connected, .available and .instance
  return connection.connected;
}

export const disconnectOpenAi = remove;
```

- **Cloud:** `POST /api/openai/credentials` with `{ operation: 'status' | 'save' | 'delete' }` stores the key in the account secret vault (consumer `@or3.openai`) and never returns it. It needs the same `x-or3-cloud-intent` and `x-or3-account` headers as the OpenRouter route. A saved personal key wins over `OR3_OPENAI_API_KEY`.
- **Local mode:** the key is kept in the local-only KV entry `openai_api_key`, which never syncs, and is sent to this OR3 server as `x-or3-openai-key` only with OpenAI-model requests.
- `POST /api/openai/models` returns the caller's chat models in the catalog shape, or `[]` without a key. OpenAI's list reports no limits, so context and output capacities come from a host table in `shared/openai/models.ts`.

Chat, tools, background jobs and context admission work as for OpenRouter. Choose an OpenAI **Fast Model** in AI Settings and titles, editor autocomplete and project memories (OpenAI Decisions with `gpt-6-luna`) use the OpenAI key too, so no OpenRouter key is needed. Plugin completions, delegation and model search still use OpenRouter credentials.
