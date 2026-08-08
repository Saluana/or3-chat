# exchangeOpenRouterCode

Function that exchanges an OpenRouter authorization code for an API key. Handles PKCE code verification and retrieves the user's API key after successful authentication.

Think of `exchangeOpenRouterCode` as the handshake — after OpenRouter redirects you back, this function verifies your code and gets your key.

---

## What does it do?

`exchangeOpenRouterCode` completes the OAuth flow by:

- Sending the authorization code to OpenRouter through the OpenRouter SDK
- Verifying the PKCE code verifier
- Retrieving the user's API key
- Handling network and API errors gracefully

---

## Basic Example

```ts
import { exchangeOpenRouterCode } from '~/core/auth/openrouter-auth';

// After being redirected from OpenRouter
const result = await exchangeOpenRouterCode({
  code: 'auth_code_from_openrouter',
  verifier: 'code_verifier_from_session_storage',
  codeMethod: 'S256'
});

if (result.ok) {
  console.log('Got key:', result.userKey);
  // Store key in state/DB
} else {
  console.error('Exchange failed:', result.reason);
}
```

---

## How to use it

### 1. Call after redirect

```ts
import { exchangeOpenRouterCode, type ExchangeParams } from '~/core/auth/openrouter-auth';

const params: ExchangeParams = {
  code: getUrlParam('code'),
  verifier: sessionStorage.getItem('openrouter_code_verifier') || '',
  codeMethod: sessionStorage.getItem('openrouter_code_method') || 'plain'
};

const result = await exchangeOpenRouterCode(params);
```

### 2. Handle success

```ts
if (result.ok) {
  const apiKey = result.userKey;
  const status = result.status;
  
  // Store the key
  await db.kv.set({ name: 'openrouter_api_key', value: apiKey });
}
```

### 3. Handle failure

```ts
if (!result.ok) {
  switch (result.reason) {
    case 'network':
      console.error('Network error - check connection');
      break;
    case 'bad-response':
      console.error('OpenRouter returned error:', result.status);
      break;
    case 'no-key':
      console.error('No key in response');
      break;
  }
}
```

### 4. Where the request goes

The exchange runs in the browser through the `@openrouter/sdk` client. The base URL comes from `runtimeConfig.public.openRouter.baseUrl` when set. There is no server API route for the exchange — the callback page calls `exchangeOpenRouterCode` directly.

---

## What you get back

### Success Response

```ts
interface ExchangeResultSuccess {
  ok: true;
  userKey: string;      // The API key
  status: number;       // 200
}
```

### Failure Response

```ts
interface ExchangeResultFail {
  ok: false;
  status: number;
  reason: 'network' | 'bad-response' | 'no-key';
}
```

### Failure Reasons

| Reason | Meaning | Status | Retryable |
|--------|---------|--------|-----------|
| `'network'` | Request aborted or SDK network error | `0` | Yes |
| `'bad-response'` | OpenRouter returned an error | SDK error status | Yes |
| `'no-key'` | Response OK but no `key` in it | `200` | No |

---

## Parameters

```ts
interface ExchangeParams {
  code: string;                    // Authorization code from OpenRouter
  verifier: string;                // Original PKCE code verifier
  codeMethod: string;              // 'S256' or 'plain'
  attempt?: number;                // Retry count for error logging
}
```

---

## How it works (under the hood)

Here's what happens:

1. **Client setup**: Creates an OpenRouter SDK client. The API key is left empty (the exchange endpoint does not need one). The base URL comes from `runtimeConfig.public.openRouter.baseUrl` when set.
2. **SDK call**: Calls `client.oAuth.exchangeAuthCodeForAPIKey()` with `code`, `code_verifier`, and `code_challenge_method`
3. **Parse response**: The SDK returns an object with a `key` field
4. **Check key**: If `key` is missing, returns `{ ok: false, reason: 'no-key' }`
5. **Return**: Success with the key, or failure with a reason
6. **Error logging**: SDK errors are normalized and reported to the error system with tags and context

## Error Handling

All errors are caught and reported through `reportError()` with a toast:

- **SDK error codes** are mapped to app error codes:

| SDK code | App code |
|----------|----------|
| `ERR_AUTH` | `ERR_AUTH` |
| `ERR_RATE_LIMIT` | `ERR_RATE_LIMIT` |
| `ERR_TIMEOUT` | `ERR_TIMEOUT` |
| `ERR_ABORTED` | `ERR_NETWORK` (returns `reason: 'network'`) |
| anything else | `ERR_NETWORK` |

Error context tags:
- `domain: 'auth'`
- `stage: 'exchange'`
- `attempt: <retry_number>`

Errors also carry a `retryable` flag from the SDK error normalizer.

---

## Common patterns

### In callback page

```ts
// pages/openrouter-callback.vue
onMounted(async () => {
  const code = route.query.code as string;
  // Reads sessionStorage first, then localStorage (reload fallback)
  const verifier =
    sessionStorage.getItem('openrouter_code_verifier') ||
    localStorage.getItem('openrouter_code_verifier') ||
    '';

  // Missing code or verifier aborts with a user-facing message
  // A saved state value must match the query state (CSRF check)

  const result = await exchangeOpenRouterCode({
    code,
    verifier,
    codeMethod: 'S256',
    attempt: 1
  });

  if (result.ok) {
    // Persist the key (KV + global state) and dispatch the event
    await kv.set('openrouter_api_key', result.userKey);
    window.dispatchEvent(new CustomEvent('openrouter:connected'));
    // Clear verifier/state/method markers, then redirect home
  } else {
    // Non-'no-key' failures get a retry closure via reportError
  }
});
```

### With retry logic

```ts
async function exchangeWithRetry(params: ExchangeParams) {
  const maxAttempts = 3;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await exchangeOpenRouterCode({
      ...params,
      attempt
    });
    
    if (result.ok) return result;
    
    if (result.reason === 'network' && attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    } else {
      return result;
    }
  }
}
```

---

## Important notes

### PKCE verification

OpenRouter verifies:
1. Hash of verifier matches code challenge
2. Code is not expired
3. Code was issued to your callback URL

If verification fails, response is 400/401 with error message.

### Key format

Keys start with `sk-or-` and are long random strings. Always treat as sensitive:
- Never log the full key
- Store only in secure storage (KV table)
- Use in Authorization headers only

### Network timeout

No explicit timeout on request, but browsers typically timeout after 30-60 seconds.

For sensitive operations, wrap in your own timeout:

```ts
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);

try {
  const result = await exchangeOpenRouterCode({
    code,
    verifier,
    codeMethod: 'S256',
    // Note: exchangeOpenRouterCode doesn't accept signal yet
  });
} finally {
  clearTimeout(timeoutId);
}
```

### Session cleanup

After exchange (success or failure), the callback page clears its session markers from both `sessionStorage` and `localStorage`:

```ts
['openrouter_auth_code', 'openrouter_code_verifier', 'openrouter_state', 'openrouter_code_method']
  .forEach((k) => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  });
```

---

## Related

- `useOpenRouterAuth` — initiates the login flow
- `useUserApiKey` — stores the key after exchange
- `openrouter-callback.vue` — calls this on redirect
- `~/core/auth/useOpenrouter.ts` — PKCE setup
- `shared/openrouter` — SDK client factory, error normalization, OAuth argument wrapping

---

## TypeScript

```ts
export type ExchangeResult = ExchangeResultSuccess | ExchangeResultFail;

interface ExchangeResultSuccess {
  ok: true;
  userKey: string;
  status: number;
}

interface ExchangeResultFail {
  ok: false;
  status: number;
  reason: 'network' | 'bad-response' | 'no-key';
}

interface ExchangeParams {
  code: string;
  verifier: string;
  codeMethod: string;
  attempt?: number;
}

export async function exchangeOpenRouterCode(
  p: ExchangeParams
): Promise<ExchangeResult>;
```

---

Document generated from `app/core/auth/openrouter-auth.ts` implementation.
