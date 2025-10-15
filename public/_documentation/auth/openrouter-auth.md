# exchangeOpenRouterCode

Server-safe function that exchanges an OpenRouter authorization code for an API key. Handles PKCE code verification and retrieves the user's API key after successful authentication.

Think of `exchangeOpenRouterCode` as the backend handshake — after OpenRouter redirects you back, this function verifies your code and gets your key.

---

## What does it do?

`exchangeOpenRouterCode` completes the OAuth flow by:

- Sending the authorization code to OpenRouter
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

### 4. Custom fetch (for testing)

```ts
const result = await exchangeOpenRouterCode({
  code: 'test_code',
  verifier: 'test_verifier',
  codeMethod: 'plain',
  fetchImpl: customFetch, // Use your own fetch
  attempt: 1 // Retry attempt number
});
```

---

## What you get back

### Success Response

```ts
interface ExchangeResultSuccess {
  ok: true;
  userKey: string;      // The API key
  status: number;       // HTTP 200 etc
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

| Reason | Meaning | Retryable |
|--------|---------|-----------|
| `'network'` | Fetch failed (no internet, CORS, timeout) | Yes |
| `'bad-response'` | Response wasn't OK or couldn't parse JSON | Yes |
| `'no-key'` | Response OK but no `key` or `access_token` | No |

---

## Parameters

```ts
interface ExchangeParams {
  code: string;                    // Authorization code from OpenRouter
  verifier: string;                // Original PKCE code verifier
  codeMethod: string;              // 'S256' or 'plain'
  fetchImpl?: typeof fetch;         // Optional custom fetch implementation
  attempt?: number;                // Retry count for error logging
}
```

---

## How it works (under the hood)

Here's what happens:

1. **POST request**: Sends code + verifier to `https://openrouter.ai/api/v1/auth/keys`
2. **Request body**:
   ```json
   {
     "code": "<auth_code>",
     "code_verifier": "<code_verifier>",
     "code_challenge_method": "<method>"
   }
   ```
3. **Fetch**: Uses provided fetch or global `fetch`
4. **Parse response**: JSON decode the response
5. **Check key**: Look for `json.key` or `json.access_token`
6. **Return**: Success with key, or failure with reason
7. **Error logging**: Reports to error system with tags and context

---

## Error Handling

All errors are caught and reported:

- **Network errors**: `reportError` with `'network'` tag and `attempt`
- **Bad responses**: `reportError` with HTTP status
- **Missing key**: `reportError` with response key count

Errors include context tags:
- `domain: 'auth'`
- `stage: 'exchange'`
- `status: <http_status>`
- `attempt: <retry_number>`

---

## Common patterns

### In callback page

```ts
// pages/openrouter-callback.vue
const { $router, $route } = useNuxtApp();

onMounted(async () => {
  const code = $route.query.code as string;
  const verifier = sessionStorage.getItem('openrouter_code_verifier');
  const method = sessionStorage.getItem('openrouter_code_method');

  const result = await exchangeOpenRouterCode({
    code,
    verifier: verifier || '',
    codeMethod: method || 'plain'
  });

  if (result.ok) {
    // Dispatch event
    window.dispatchEvent(new CustomEvent('openrouter:connected'));
    // Redirect to home
    $router.push('/');
  } else {
    console.error('Auth failed:', result.reason);
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

Keys start with `sk_` or similar prefix. Always treat as sensitive:
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

After exchange (success or failure), clear session storage:

```ts
sessionStorage.removeItem('openrouter_code_verifier');
sessionStorage.removeItem('openrouter_code_method');
sessionStorage.removeItem('openrouter_state');
```

---

## Related

- `useOpenRouterAuth` — initiates the login flow
- `useUserApiKey` — stores the key after exchange
- `openrouter-callback.vue` — calls this on redirect
- `~/core/auth/useOpenrouter.ts` — PKCE setup

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
  fetchImpl?: typeof fetch;
  attempt?: number;
}

export async function exchangeOpenRouterCode(
  p: ExchangeParams
): Promise<ExchangeResult>;
```

---

Document generated from `app/core/auth/openrouter-auth.ts` implementation.
