# Error reporting in OR3

Host source uses `err()` to create an `AppError` and `reportError()` to
normalize, log, emit hooks, and optionally notify the user. This module is a
host implementation helper; installable plugins should report through the
SDK logger and their own UI instead of importing `~/utils/errors`.

```ts
import { err, reportError } from '~/utils/errors';

async function saveAndReport(
    saveDraft: () => Promise<void>,
): Promise<void> {
    try {
        await saveDraft();
    } catch (cause: unknown) {
        reportError(err('ERR_DB_WRITE_FAILED', 'Could not save the draft', {
            severity: 'error',
            cause,
            tags: { domain: 'chat' },
        }));
        throw cause;
    }
}
```

`AppError` carries a code, severity (`info`, `warn`, `error`, or `fatal`),
optional `retryable` metadata, tags, a timestamp, and an optional cause.
`reportError()` emits `error:raised`, then `error:<domain>` when a `domain`
tag is present; chat-domain errors also emit `ai.chat.error:action`. It shows a
toast by default except for info-level errors. Pass `silent: true` to suppress
the toast or `toast: false` to override the default.

The reporter suppresses duplicate log entries with the same code and message
for 300 ms. Its redactor is only a heuristic: it masks top-level message/tag
strings that contain a secret-related keyword and look like a long token. It
does not scrub arbitrary nested values, all error data, or every credential
format. Never put secrets in error messages or tags.

## Retry only when safe

`simpleRetry(fn, attempts = 2, delayMs = 400)` runs the function up to
`attempts` times with a fixed delay between failures, then rethrows the last
error. It does not interpret HTTP status codes or `Retry-After`. Use it only
for transient failures where repeating the operation is safe and idempotent;
do not use it to replay external writes, authorization failures, or validation
errors. For HTTP or provider work, prefer the operation-specific retry helper
when it carries structured retry metadata.

## Source location

The host implementation is `app/utils/errors.ts`. It can be used by host app
code and source extensions. It is not a portable plugin API; see the
[Plugin SDK](/documentation/plugins/plugin-sdk) for installable extensions.
