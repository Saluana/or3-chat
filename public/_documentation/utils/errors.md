# errors

Centralized error utility for OR3. Provides error types, factories, reporting, retry logic, and duplicate suppression with automatic secret scrubbing and hook integration.

Think of `errors.ts` as your error handling toolkit — it standardizes error creation, ensures secrets never leak, and integrates with the hook system so other modules can react to failures.

---

## Purpose

`errors.ts` offers:

-   **Standardized error types** (`AppError` with code, severity, retryable flag)
-   **Error factories** (`err()`, `asAppError()`) for quick creation
-   **Centralized reporting** (`reportError()`) with toast notifications
-   **Secret scrubbing** (automatic redaction of API keys)
-   **Duplicate suppression** (don't spam identical errors)
-   **Hook integration** (errors trigger custom events)
-   **Simple retry helper** (`simpleRetry()`) for transient failures

Use this whenever you catch an exception, especially in async operations, API calls, or database access.

---

## Basic Example

```ts
import { err, reportError, simpleRetry } from '~/utils/errors';

// Create an error
const error = err('ERR_NETWORK', 'Failed to fetch models', {
    severity: 'warn',
    retryable: true,
    tags: { domain: 'chat', modelId: 'claude-3' },
});

// Report it (shows toast, logs, fires hooks)
reportError(error, { toast: true, retry: () => retryFetch() });

// Or wrap and report in one shot
try {
    await fetchData();
} catch (e) {
    reportError(e, {
        code: 'ERR_NETWORK',
        message: 'Could not reach server',
        tags: { endpoint: '/api/models' },
    });
}

// Simple retry with backoff
const result = await simpleRetry(
    () => fetchModels(),
    2,      // attempts
    500     // delay between attempts
);
```

---

## How to use it

### 1. Create errors

```ts
// Factory with full details
const err1 = err('ERR_DB_WRITE_FAILED', 'Could not save message', {
    severity: 'error',
    retryable: true,
    tags: { table: 'messages', rowId: '123' },
});

// Minimal error
const err2 = err('ERR_INTERNAL', 'Something went wrong');

// With cause chain
const err3 = err('ERR_VALIDATION', 'Input invalid', {
    severity: 'warn',
    cause: originalError,
});
```

### 2. Convert existing errors

```ts
import { asAppError } from '~/utils/errors';

try {
    // Some operation
} catch (e) {
    // Convert any error to AppError
    const appError = asAppError(e, {
        code: 'ERR_NETWORK',
        message: 'Fallback message',
    });
}
```

### 3. Report errors

```ts
import { reportError } from '~/utils/errors';

try {
    await riskyOperation();
} catch (e) {
    // Report with all features
    reportError(e, {
        code: 'ERR_INTERNAL',
        message: 'Operation failed',
        severity: 'error',
        retryable: true,
        tags: { context: 'chat', operation: 'send' },
        toast: true,
        silent: false,
        retry: () => riskyOperation(),
    });
}
```

### 4. Simple retry

```ts
import { simpleRetry } from '~/utils/errors';

const data = await simpleRetry(
    async () => {
        const res = await fetch('/api/models');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    },
    3,      // Try up to 3 times
    1000    // Wait 1s between attempts
);
```

### 5. Type guards

```ts
import { isAppError } from '~/utils/errors';

try {
    await operation();
} catch (e) {
    if (isAppError(e)) {
        console.log('Code:', e.code);
        console.log('Retryable:', e.retryable);
    } else {
        console.log('Unknown error:', e);
    }
}
```

---

## What you get back

### AppError interface

```ts
interface AppError extends Error {
    code: ErrorCode;                    // e.g., 'ERR_NETWORK'
    severity: 'info' | 'warn' | 'error' | 'fatal';
    retryable?: boolean;                // Safe to retry?
    tags?: Record<string, any>;         // Contextual metadata
    timestamp: number;                  // ms since epoch
    message: string;                    // From Error.message
    cause?: unknown;                    // Error cause chain (if provided)
}
```

### Error codes

```ts
type ErrorCode =
    | 'ERR_INTERNAL'           // Generic internal error
    | 'ERR_STREAM_ABORTED'     // User cancelled stream
    | 'ERR_STREAM_FAILURE'     // Stream died unexpectedly
    | 'ERR_NETWORK'            // Network connectivity
    | 'ERR_TIMEOUT'            // Operation timed out
    | 'ERR_DB_WRITE_FAILED'    // Database insert/update failed
    | 'ERR_DB_READ_FAILED'     // Database query failed
    | 'ERR_DB_QUOTA_EXCEEDED'  // Storage quota exceeded
    | 'ERR_FILE_VALIDATION'    // File validation failed
    | 'ERR_FILE_PERSIST'       // Could not save file
    | 'ERR_VALIDATION'         // Input validation failed
    | 'ERR_AUTH'               // Authentication failed
    | 'ERR_RATE_LIMIT'         // Rate limited
    | 'ERR_UNSUPPORTED_MODEL'  // Model not available
    | 'ERR_HOOK_FAILURE'       // Hook threw exception
```

---

## How it works (under the hood)

### Error creation flow

1. **Call `err()`** with code, message, and options
2. **Creates Error** with standard fields
3. **Sets metadata**: severity (default `error`), retryable flag, tags, timestamp
4. **Returns AppError** ready for throw or reporting

### Reporting flow

1. **Receive error** or raw exception
2. **Convert to AppError** using `asAppError()` if needed
3. **Merge options** (override severity, tags, code if provided)
4. **Scrub secrets** (replace obvious API keys with `***`)
5. **Check duplicates** (suppress identical errors within 300ms)
6. **Log to console** if not suppressed
7. **Fire hooks**: `error:raised`, `error:{domain}`, `ai.chat.error:action`
8. **Show toast** unless `silent: true` or error is info-level
9. **Return AppError** to caller

### Duplicate suppression

-   Maps error code + message → timestamp
-   Errors identical within 300ms are suppressed
-   Prevents notification spam during rapid retries
-   Opportunistic cleanup: old entries removed every access

### Secret scrubbing

-   Scans all string values in message and tags
-   Replaces strings matching `/api|key|secret|token/i` with `***`
-   Truncates strings longer than 8192 chars
-   Preserves short strings and non-strings

---

## Key Features

✅ **Standardized errors**: Consistent structure across app  
✅ **Secret-safe**: Automatic API key redaction  
✅ **Duplicate suppression**: No error spam  
✅ **Hook integration**: Other modules can react  
✅ **Toast notifications**: User-visible feedback  
✅ **Retry helpers**: Easy transient failure handling  
✅ **Cause chains**: Preserves error nesting  
✅ **Tagging**: Add context without changing code  

---

## Common patterns

### Wrap API call with error handling

```ts
async function fetchModels() {
    try {
        const res = await fetch('/api/v1/models');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        reportError(e, {
            code: 'ERR_NETWORK',
            tags: { endpoint: '/api/v1/models' },
            retry: fetchModels,
        });
        throw e;
    }
}
```

### Graceful degradation

```ts
async function loadPreferences() {
    try {
        return await db.kv.get('user-prefs');
    } catch (e) {
        reportError(e, {
            code: 'ERR_DB_READ_FAILED',
            severity: 'warn',
            silent: true,  // Don't annoy user
        });
        return getDefaultPreferences();
    }
}
```

### Conditional retry

```ts
try {
    await importantOperation();
} catch (e) {
    const appErr = asAppError(e);
    if (appErr.retryable) {
        reportError(e, {
            retry: () => importantOperation(),
        });
    } else {
        throw e;
    }
}
```

### Hook-based error handling

```ts
// Some other module listening for errors
const hooks = useHooks();

hooks.onAction('error:chat', (error) => {
    // React to chat domain errors
    showErrorNotification(error.message);
});
```

### Distinguish chat from other errors

```ts
reportError(e, {
    code: 'ERR_STREAM_FAILURE',
    tags: { domain: 'chat' },
});

// Triggers:
// - error:raised
// - error:chat
// - ai.chat.error:action
```

---

## Important notes

### Severity levels

-   **`info`**: Non-critical (e.g., feature unavailable, but fallback exists)
-   **`warn`**: Something went wrong, but operation partially succeeded
-   **`error`**: Operation failed completely (default)
-   **`fatal`**: System cannot continue (rare)

Toast styling changes per severity.

### Retryable flag

Set `retryable: true` only if:

-   The operation is idempotent (safe to retry)
-   The failure is transient (likely to succeed on retry)
-   Don't set for auth failures, validation errors, or rate limits

### Tags for context

Use tags to add metadata without changing error structure:

```ts
reportError(e, {
    tags: {
        domain: 'chat',
        modelId: 'claude-3',
        attemptNumber: 2,
        userId: 'user-123',
    },
});
```

### Silent vs. toast

```ts
// Show user-facing toast
reportError(e, { toast: true });

// Never show toast (log only)
reportError(e, { silent: true });

// Default: show if severity != 'info'
reportError(e);
```

### Suppression timing

Duplicate check is **code + message** within **300ms**:

```ts
reportError(err('ERR_NETWORK', 'Fetch failed'), { silent: true });
// First report logged and noted

reportError(err('ERR_NETWORK', 'Fetch failed'), { silent: true });
// Within 300ms? Suppressed. After? Logged again.
```

---

## Troubleshooting

### Errors not showing to user

-   Check severity is not `'info'`
-   Verify `silent: true` is not set
-   Check `ERR_STREAM_ABORTED` (special-cased)

### Secrets still leaking

-   Scrubber only catches obvious patterns
-   Don't store secrets in error messages directly
-   Use tags + log redaction if needed

### Duplicate suppression too aggressive

-   300ms window is global
-   Different errors won't collide
-   Can't adjust timing (hardcoded for simplicity)

### Toast not appearing

-   Check `import.meta.client` (SSR safe)
-   Verify `useToast()` is available
-   Toast failures caught silently (logged as fallback)

---

## Related

-   `useHooks` — Hook system for error reactions
-   `useToast` (Nuxt UI) — Toast notification system
-   `openrouterStream` — Streaming errors use this
-   `useChat` — Chat operations report via this

---

## TypeScript

```ts
export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export type ErrorCode =
    | 'ERR_INTERNAL'
    | 'ERR_STREAM_ABORTED'
    | 'ERR_STREAM_FAILURE'
    // ... (see full list above)

export interface AppError extends Error {
    code: ErrorCode;
    severity: ErrorSeverity;
    retryable?: boolean;
    tags?: Record<string, string | number | boolean | undefined>;
    timestamp: number;
}

export function err(
    code: ErrorCode,
    message: string,
    o?: {
        severity?: ErrorSeverity;
        retryable?: boolean;
        tags?: Record<string, any>;
        cause?: unknown;
    }
): AppError

export function asAppError(
    v: unknown,
    fb?: { code?: ErrorCode; message?: string }
): AppError

export function reportError(
    input: unknown,
    opts?: {
        code?: ErrorCode;
        message?: string;
        tags?: Record<string, any>;
        toast?: boolean;
        silent?: boolean;
        retry?: () => any;
        severity?: ErrorSeverity;
        retryable?: boolean;
    }
): AppError

export async function simpleRetry<T>(
    fn: () => Promise<T>,
    attempts?: number,
    delayMs?: number
): Promise<T>
```

---

## Example: Full error handling flow

```ts
import { reportError, simpleRetry, isAppError } from '~/utils/errors';

async function sendChatMessage(text: string) {
    try {
        // Attempt with retry
        const response = await simpleRetry(
            () => openRouterStream({
                apiKey: key,
                model: model,
                orMessages: messages,
                modalities: ['text'],
            }),
            2,
            1000
        );

        for await (const event of response) {
            if (event.type === 'text') {
                updateUI(event.text);
            } else if (event.type === 'done') {
                break;
            }
        }
    } catch (e) {
        // Detailed error reporting
        const error = reportError(e, {
            code: 'ERR_STREAM_FAILURE',
            tags: {
                domain: 'chat',
                model: model,
                messageLength: text.length,
            },
            retry: () => sendChatMessage(text),
        });

        // React based on type
        if (isAppError(error) && error.retryable) {
            showRetryButton();
        } else {
            showFatalError();
        }
    }
}
```
