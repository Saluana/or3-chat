# Chat streaming in OR3 source

`app/utils/chat/openrouterStream.ts` is the host chat's streaming transport.
It normalizes foreground OpenRouter responses and includes client helpers for
SSR background jobs. These app imports are for OR3 source code; installable
plugins use the permission-scoped methods in the [Plugin SDK](/documentation/plugins/plugin-sdk).

## Foreground route and fallback

The stream tries `POST /api/openrouter/stream` first when the server route is
available. Both the proxy response and the direct OpenRouter response use the
shared SSE parser, so callers receive the same normalized events for text,
images, reasoning, tool calls, and completion.

With SSR auth enabled and no client API key, the server route is required. A
missing or failing route returns an error; the browser does not fall back to a
direct request without a key. When a key is present, the route receives it in
`x-or3-openrouter-key`; if fallback is allowed and the route is unavailable,
the legacy direct path sends the key as a Bearer token. A successful server
stream ends that attempt. In the optional fallback path, proxy errors other
than 404/405 propagate instead of marking the route unavailable.

The route-availability result is cached in `localStorage` for 15 minutes. In
the optional server-first path, 404/405 responses and network failures mark the
route unavailable; other proxy errors do not. When SSR auth requires the
server route, 404/405 and network failures throw without marking it unavailable.
The cache can be stale after changing between static and SSR builds or
providers. Clear `or3:server-route-available` (and
`or3:background-streaming-available`) in that case.

Pass an `AbortSignal` to stop a request. The transport applies a response
deadline and an idle watchdog to streaming body reads. `streamedFieldMode` is
normally `delta`; use `cumulative-snapshot` only for an adapter that repeats
the full tool name/arguments in each event.

`openRouterStreamWithRetry()` retries retryable transport, 429, and 5xx errors
only until the first event reaches its consumer. After output starts, errors
propagate so a retry cannot silently duplicate already displayed content.

Native chat supplies a captured `contextPolicy` to the complete-body admission
helper. It preserves every selected message and accounts for tools and request
configuration. The OR3 server receives only versioned user choices in `_context`,
resolves the selected model through the SDK catalog, and validates before
provider dispatch or durable job admission. Direct OpenRouter requests omit
the envelope. Callers without a captured policy retain their legacy contract;
the unbound native continuation helper rejects missing policy explicitly.

An explicit provider `context_length_exceeded` or `context_window_exceeded`
machine code becomes permanent `ERR_CONTEXT_FULL`. Native outcomes report
`context_full`; recovery copy suggests compaction, editing, or a larger supported
model. No context failure triggers trimmed input or an automatic retry.

## Background jobs

`startBackgroundStream()` posts `_background: true`, the originating thread
and message IDs, an admission ID, history admission, and optional tool/runtime
metadata to `/api/openrouter/stream`. The server must confirm admission with a
JSON job ID. An unsupported or malformed admission is an error; this helper
does not silently start a second execution mode. Polling, SSE attachment,
cancellation, and retryable status errors are provided by the same module.

Background mode requires the SSR server route and the server's feature flag.
The client availability cache can be cleared or stale; explicit runtime
configuration takes precedence. The exact request eligibility, authorization,
job lifecycle, and browser bridge are documented in [Background execution](/documentation/cloud/background-execution).

## Host source boundary

The import path `~/utils/chat/openrouterStream` resolves within OR3's `app/`
tree and is not part of the portable plugin SDK. Portable model and tool work
must use the currently supported, permission-scoped SDK surface. See the
[SDK support table](/documentation/plugins/plugin-sdk#supported-operations)
before adding a portable operation.
