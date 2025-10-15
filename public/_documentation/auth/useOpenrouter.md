# useOpenRouterAuth

Authentication composable for OpenRouter PKCE login flow. Manages the OAuth-like authentication process with OpenRouter, including code verification, session storage, and API key management.

Think of `useOpenRouterAuth` as your authentication gateway to OpenRouter — it handles the secure PKCE flow, manages the redirect dance, and stores your API key safely.

---

## What does it do?

`useOpenRouterAuth` provides the authentication machinery for OR3. When you want to:

- Start the OpenRouter login flow
- Handle PKCE code challenge/verifier generation
- Redirect to OpenRouter with proper security parameters
- Logout and clear authentication

...this composable manages all of that for you.

---

## Basic Example

```vue
<script setup>
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';

const { startLogin, logoutOpenRouter, isLoggingIn } = useOpenRouterAuth();

async function handleLogin() {
  await startLogin();
}

async function handleLogout() {
  await logoutOpenRouter();
}
</script>

<template>
  <div>
    <button :disabled="isLoggingIn">
      {{ isLoggingIn ? 'Logging in...' : 'Connect OpenRouter' }}
    </button>
  </div>
</template>
```

---

## How to use it

### 1. Create an auth instance

```ts
import { useOpenRouterAuth } from '~/core/auth/useOpenrouter';
const auth = useOpenRouterAuth();
```

### 2. Start the login flow

```ts
await auth.startLogin();
// User is redirected to OpenRouter
```

### 3. Handle logout

```ts
await auth.logoutOpenRouter();
// Clears all auth data
```

### 4. Monitor login state

```ts
if (auth.isLoggingIn.value) {
  console.log('Login in progress...');
}
```

---

## What you get back

When you call `useOpenRouterAuth()`, you get:

| Property | Type | Description |
|----------|------|-------------|
| `startLogin` | `function` | Begin PKCE OAuth flow |
| `logoutOpenRouter` | `function` | Clear auth and logout |
| `isLoggingIn` | `Ref<boolean>` | True while redirect is happening |

---

## How it works (under the hood)

Here's what happens when you call `startLogin()`:

1. **Generate verifier**: Creates 64 random bytes encoded as hex string
2. **Create challenge**: SHA-256 hash of verifier (S256 method), or plain fallback for iOS Safari
3. **Store session data**: Code verifier, method, and state in `sessionStorage`
4. **Build auth URL**: With callback URL, code challenge, and state
5. **Redirect**: User sent to OpenRouter auth page
6. **User logs in**: Authenticates at OpenRouter
7. **Redirect back**: OpenRouter sends code to callback page

The callback page receives the code and exchanges it for an API key.

---

## PKCE Security

**What is PKCE?** Proof Key for Code Exchange — a security layer for OAuth 2.0 that prevents code interception.

**Why use it?** SPAs can't keep secrets, so PKCE verifies you're the same client by:
1. Generating random `code_verifier`
2. Hashing it to `code_challenge` (SHA-256)
3. Exchanging authorization code + original verifier
4. Server confirms hash matches

**S256 vs Plain:** S256 is secure. Plain is fallback for iOS Safari on HTTP.

---

## Configuration

Set via Nuxt runtime config:

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      openRouterAuthUrl: 'https://openrouter.ai/auth',
      openRouterRedirectUri: 'https://yourdomain.com/openrouter-callback',
      openRouterClientId: 'your-app-id'
    }
  }
})
```

---

## Common patterns

### Check if connected

```ts
const { apiKey } = useUserApiKey();
if (apiKey.value) {
  console.log('Already connected');
}
```

### Logout with confirmation

```ts
async function confirmLogout() {
  if (confirm('Disconnect?')) {
    await auth.logoutOpenRouter();
  }
}
```

### Listen for auth changes

```ts
window.addEventListener('openrouter:connected', () => {
  console.log('Auth state changed');
});
```

---

## Important notes

### Session storage only

- Code verifier stored in `sessionStorage` (cleared on tab close)
- Never persisted to `localStorage`
- Not accessible from other tabs

### HTTPS requirement

PKCE S256 requires HTTPS (or localhost for dev). Falls back to plain method on iOS Safari for HTTP.

### Logout behavior

`logoutOpenRouter()`:
1. Removes `openrouter_api_key` from localStorage
2. Clears KV database entry
3. Dispatches `openrouter:connected` event

---

## Related

- `useUserApiKey` — access stored API key
- `exchangeOpenRouterCode` — swap auth code for API key
- `openrouter-callback.vue` — handles redirect
- `useChat` — uses API key for messages

---

## TypeScript

```ts
function useOpenRouterAuth(): {
  startLogin: () => Promise<void>;
  logoutOpenRouter: () => Promise<void>;
  isLoggingIn: Ref<boolean>;
}
```

---

Document generated from `app/core/auth/useOpenrouter.ts` implementation.
