# Connection and key APIs

These APIs are for OR3 source components. Portable plugins use [SDK model access](/documentation/plugins/plugin-sdk) and do not receive the user's OpenRouter key.

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

The login helper prefers S256 when Web Crypto is available and uses the plain challenge fallback when it is unavailable. The callback uses the saved challenge method. Configuration comes from public runtime values `openRouterAuthUrl`, `openRouterRedirectUri`, and `openRouterClientId`; the API base URL is `public.openRouter.baseUrl`. Use the source configuration rather than adding a second redirect implementation.

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
