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
classified retryability, HTTP status, source, credential ownership, provider code, retry delay, tags, a timestamp, and an optional local cause.
`reportError()` emits `error:raised`, then `error:<domain>` when a `domain`
tag is present; chat-domain errors also emit `ai.chat.error:action`. It shows a
toast by default except for info-level errors. Pass `silent: true` to suppress
the toast or `toast: false` to override the default.

The reporter suppresses duplicate log entries with the same code and message
for 300 ms. Primary UI uses `presentError()` from `shared/errors`, never an
arbitrary exception message or response body. Pass an app-owned operation
fallback with `message` (reporter) or `fallbackMessage` (presenter).

`asAppError()` retains explicitly supplied operation copy and login context
when the same error is normalized or reported again. That trust stays local
and does not apply to arbitrary exception text or objects claiming to be an
`AppError`. New explicit operation copy takes precedence. Nuxt UI generates
toast identifiers so separate failures in the same millisecond stay separate.

Provider credentials and OR3 sessions receive different guidance. Recovery
controls appear only when the host supports them. Retry requires classified
retryability and an operation-owned safe callback; it is withheld during a
provider retry delay. Authentication, quota, validation and uncertain tool
outcomes cannot acquire a Retry button through an override.

Details expose only allowlisted, bounded metadata: canonical code, HTTP status,
source, credential ownership, known provider code, retry delay and retryability.
Raw bodies, stacks, causes, headers, URLs and user content are omitted. Causes
remain local for error handling. Lifecycle logging redacts nested credential
fields and embedded token patterns before truncating strings. Never deliberately
put secrets in messages, tags or app-owned fallback copy.

Background jobs retain their metadata inside the existing error-string field;
consumers must present it through the shared mapper rather than display it raw.

## Codes and diagnostic tags

Canonical `ErrorCode` values and classification live in
`shared/errors/index.ts`; the host reporter re-exports the shared contracts.
Choose the code for the failed operation rather than copying an upstream error
name. Common groups include:

| Group | Codes |
| --- | --- |
| Internal and input | `ERR_INTERNAL`, `ERR_UNKNOWN`, `ERR_VALIDATION`, `ERR_BAD_REQUEST`, `ERR_NOT_FOUND` |
| Transport and provider | `ERR_NETWORK`, `ERR_TIMEOUT`, `ERR_SERVER`, `ERR_PROVIDER`, `ERR_OVERLOADED`, `ERR_RATE_LIMIT` |
| Identity and credits | `ERR_AUTH`, `ERR_FORBIDDEN`, `ERR_CREDITS` |
| Browser persistence | `ERR_DB_READ_FAILED`, `ERR_DB_WRITE_FAILED`, `ERR_DB_QUOTA_EXCEEDED`, `ERR_FILE_VALIDATION`, `ERR_FILE_PERSIST` |
| Cloud storage | `ERR_STORAGE_UPLOAD_FAILED`, `ERR_STORAGE_DOWNLOAD_FAILED`, `ERR_STORAGE_QUOTA_EXCEEDED`, `ERR_STORAGE_FILE_NOT_FOUND`, `ERR_STORAGE_PROVIDER_ERROR`, `ERR_FILE_TOO_LARGE` |
| Chat and tools | `ERR_STREAM_ABORTED`, `ERR_STREAM_FAILURE`, `ERR_ABORTED`, `ERR_UNSUPPORTED_MODEL`, `ERR_TOOL_OUTCOME_UNKNOWN` |
| Context admission | `ERR_CONTEXT_FULL`, `ERR_MODEL_METADATA_UNAVAILABLE`, `ERR_CONTEXT_LIMIT_INVALID`, `ERR_OUTPUT_LIMIT_INVALID` |
| Extensions and sync | `ERR_HOOK_FAILURE`, `ERR_SYNC_PAYLOAD_TOO_LARGE` |

The code alone does not authorize retry. Preserve normalized retryability,
credential ownership, and retry delay; uncertain tool outcomes require
reconciliation before any repeated side effect.

Context admission failures are permanent for that candidate. Explicit provider
context-length/window machine codes map to `ERR_CONTEXT_FULL` with app-owned
recovery copy; arbitrary upstream text and generic HTTP 400 responses do not
establish context overflow. Stored background error strings retain these codes
through the shared serializer and presenter.

Reporter tags are small, flat string/number/boolean values. Use `domain`
(chat, db, files, auth), `stage` or `op`, and the relevant record ID where
needed. `dbTry` adds `rw` and `entity` context for database failures.
Do not include document content, credentials, or large objects. Tags help local
diagnostics and domain hook routing; they are not automatically safe UI details.

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
