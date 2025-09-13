# Error Handling

Single-page guide to the unified error API. Keep this lean; everything here fits on one screen.

## Quick Start

Use `reportError` everywhere instead of raw `console.error`:

```ts
import { reportError, err } from '~/utils/errors';

try {
    await doThing();
} catch (e) {
    reportError(
        err('ERR_INTERNAL', 'Failed to do thing', {
            tags: { domain: 'feature', stage: 'perform', id: item.id },
            retryable: true,
        }),
        {
            toast: true,
            retry: () => doThing(),
        }
    );
}
```

## API Surface (`~/utils/errors.ts`)

| Symbol                                                                                           | Purpose                                                                                         |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `err(code, message, { severity?, retryable?, tags?, cause? })`                                   | Factory creating a typed `AppError`.                                                            |
| `isAppError(v)` / `asAppError(v, fb?)`                                                           | Type guard / coercion with fallback code & message.                                             |
| `reportError(input, { code?, message?, tags?, toast?, silent?, retry?, severity?, retryable? })` | Normalize, scrub, dedupe-log, emit hooks, optionally toast & surface retry. Returns `AppError`. |
| `simpleRetry(fn, attempts=2, delayMs=400)`                                                       | Minimal linear async retry helper.                                                              |
| `useErrorToasts()`                                                                               | Deprecated noop shim (avoid; kept for legacy components).                                       |

### Emitted Hooks

| Hook                   | Fired When                         | Payload               |
| ---------------------- | ---------------------------------- | --------------------- |
| `error:raised`         | Every call to `reportError`        | `AppError`            |
| `error:<domain>`       | If `tags.domain` present           | `AppError`            |
| `ai.chat.error:action` | Back-compat when `domain==='chat'` | `{ error: AppError }` |

> Legacy note: `ai.chat.error:action` is bridged automatically. New code should listen on `error:chat` instead. No deprecation warning yet (noise reduction).

## Error Codes

| Code                    | Meaning                          | Retry?  | Notes                                                |
| ----------------------- | -------------------------------- | ------- | ---------------------------------------------------- |
| `ERR_INTERNAL`          | Generic internal failure         | Manual  | Fallback / unexpected branches.                      |
| `ERR_STREAM_ABORTED`    | User aborted a chat stream       | No      | Toast suppressed unless `errors.showAbortInfo` true. |
| `ERR_STREAM_FAILURE`    | Chat streaming failed mid-flight | Yes     | Retry closure added in chat composable.              |
| `ERR_NETWORK`           | Network / fetch failure          | Often   | Include stage / attempt tags.                        |
| `ERR_TIMEOUT`           | Timed out operation              | Often   | Not yet widely used.                                 |
| `ERR_DB_WRITE_FAILED`   | IndexedDB write failed           | Yes     | See tags `domain:'db'` + `rw:'write'`.               |
| `ERR_DB_READ_FAILED`    | IndexedDB read failed            | Yes     | `rw:'read'`.                                         |
| `ERR_DB_QUOTA_EXCEEDED` | Browser storage quota exceeded   | No      | Show quota guidance toast.                           |
| `ERR_FILE_VALIDATION`   | File rejected (type/size/count)  | No      | Reported with toast.                                 |
| `ERR_FILE_PERSIST`      | Failed to persist file blob/meta | Yes     | Retry closure provided.                              |
| `ERR_VALIDATION`        | Generic user input validation    | No      | Provide precise message.                             |
| `ERR_AUTH`              | Auth / CSRF / exchange issues    | Depends | OpenRouter callback flow.                            |
| `ERR_RATE_LIMIT`        | Provider rate limit hit          | Yes     | Not all providers send clear signals.                |
| `ERR_UNSUPPORTED_MODEL` | Model not allowed / recognized   | No      | surfaced in UI.                                      |
| `ERR_HOOK_FAILURE`      | Plugin hook handler threw        | Depends | Emitted silently unless needed.                      |

## Tags Convention

Attach small, flat metadata objects (string/number/bool) to power diagnostics & filtering:

| Tag        | Example                       | Meaning                             |
| ---------- | ----------------------------- | ----------------------------------- |
| `domain`   | `chat`, `db`, `files`, `auth` | High-level feature area.            |
| `threadId` | `t123`                        | Chat thread context.                |
| `streamId` | `id-abc`                      | Streaming session.                  |
| `modelId`  | `openai/gpt-oss-120b`         | LLM used.                           |
| `stage`    | `stream`, `abort`, `exchange` | Lifecycle stage.                    |
| `op`       | `write`                       | DB/file operation action.           |
| `entity`   | `messages`                    | Table or logical entity.            |
| `rw`       | `read` / `write`              | Convenience tag (added by `dbTry`). |

Guidelines:

1. Keep under ~8 keys; avoid large values (scrubber truncates >8k chars).
2. Omit nullish keys; no nested objects (keep it serializable / flat).
3. Always include `domain` where reasonable for domain hooks.

## Toast Behavior

`reportError` shows a toast unless:

-   Severity is `info` OR `silent:true`, and no explicit `toast:true`.
-   Code is `ERR_STREAM_ABORTED` with severity `info` (explicitly suppressed unless opt-in config).
    Duplicate logs (same code + message) within 300ms are suppressed; a 1s sliding prune keeps the map small.

## Files & DB Helpers

`dbTry(fn, { op:'write', entity:'messages' })` wraps Dexie calls, mapping quota errors to `ERR_DB_QUOTA_EXCEEDED` (non-retryable) or generic read/write codes (retryable). Exports `DB_QUOTA_GUIDANCE` for UI reuse.

File handling emits:

-   `ERR_FILE_VALIDATION` on unsupported mime/size/count.
-   `ERR_FILE_PERSIST` with retry on IndexedDB persistence errors.

## Plugin Example

Annotate domain + context tags and rely on hooks:

```ts
// plugins/example-error-demo.client.ts
import { reportError, err } from '~/utils/errors';

export default defineNuxtPlugin(() => {
    const hooks = useHooks();
    // Listen to all DB errors
    hooks.on('error:db', (e) => {
        console.log('db error observed (plugin)', e.code, e.tags);
    });
    // Emit a demo error (with domain tag so plugin listeners see it)
    try {
        throw new Error('Simulated failure');
    } catch (e) {
        reportError(
            err('ERR_INTERNAL', 'Demo plugin failure', {
                tags: { domain: 'demo', stage: 'init' },
                retryable: false,
            }),
            { toast: true }
        );
    }
});
```

Legacy hook bridge: if you still listen on `ai.chat.error:action`, it continues to fire for chat domain errors. Prefer `error:chat` going forward.

## Migration Checklist

1. Replace `console.error` with `reportError` (supply domain + minimal tags).
2. Use `err()` to construct domain-specific errors instead of ad-hoc objects.
3. Provide retry closures only where user action makes sense (e.g., network, stream failure, file persist).
4. Avoid spamming: rely on duplicate suppression; aggregate or debounce if looping.
5. Remove legacy `useErrorToasts`; rely on Nuxt UI toasts directly through `reportError`.

---

Questions or missing code? Open an issue / PR with proposed new code & tags.
