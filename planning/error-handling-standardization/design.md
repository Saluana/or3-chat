# design.md

artifact_id: 5f9e2c2f-169d-4f8d-9e31-5a4e1a64e7b4

## Overview

Lean error handling standard: a single utility module, minimal types, one reporter API, Nuxt UI toast integration (no custom store). Optimize for: smallest code surface, easy plugin adoption, no silent failures, predictable shape, and low runtime cost. Removed from previous draft: separate logger module, complex coalescer, codemod phase, heavy retry abstraction, dedicated hook emitter file, and bespoke toast store/component.

## Architecture (Lean)

All core logic lives in `utils/errors.ts`:

1. Types & codes
2. `err()` factory
3. `asAppError()` normalizer
4. `reportError()` (normalize + console + hooks + optional toast)
5. Simple duplicate suppression (300ms) keyed by `code|message`
6. Optional `simpleRetry()` helper (linear delay)
7. Tiny scrubbing of obvious secrets

Hooks fired directly via existing `hooks.doAction`.

### Core Pieces

1. Types & codes (enum union literal)
2. Factory + normalizer
3. Reporter (console + hooks + toast)
4. Light duplicate suppression
5. Optional retry helper
6. (Removed) Custom toast store (now direct Nuxt UI `useToast()` calls)
7. Optional boundary (deferred)

## Data Model & Interfaces

### Type Definitions (single file `~/utils/errors.ts`)

```ts
export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export interface AppError extends Error {
    code: ErrorCode;
    severity: ErrorSeverity; // default 'error'
    retryable?: boolean;
    tags?: Record<string, string | number | boolean | undefined>;
    timestamp: number; // ms
}

export type ErrorCode =
    | 'ERR_INTERNAL'
    | 'ERR_STREAM_ABORTED'
    | 'ERR_STREAM_FAILURE'
    | 'ERR_NETWORK'
    | 'ERR_TIMEOUT'
    | 'ERR_DB_WRITE_FAILED'
    | 'ERR_DB_READ_FAILED'
    | 'ERR_DB_QUOTA_EXCEEDED'
    | 'ERR_FILE_VALIDATION'
    | 'ERR_FILE_PERSIST'
    | 'ERR_VALIDATION'
    | 'ERR_AUTH'
    | 'ERR_RATE_LIMIT'
    | 'ERR_UNSUPPORTED_MODEL'
    | 'ERR_HOOK_FAILURE';

export type StandardError = AppError; // backward compatible alias
```

### Factory & Utilities

Single file functions (pseudo‑code):

```ts
export function err(
    code: ErrorCode,
    message: string,
    o: {
        severity?: ErrorSeverity;
        retryable?: boolean;
        tags?: Record<string, any>;
        cause?: unknown;
    } = {}
): AppError {
    const e = new Error(message);
    (e as AppError).code = code;
    (e as AppError).severity = o.severity || 'error';
    (e as AppError).retryable = o.retryable;
    (e as AppError).tags = o.tags;
    (e as AppError).timestamp = Date.now();
    if (o.cause && !(e as any).cause) (e as any).cause = o.cause;
    return e as AppError;
}

export function isAppError(v: unknown): v is AppError {
    return (
        !!v &&
        typeof v === 'object' &&
        'code' in (v as any) &&
        'severity' in (v as any)
    );
}

export function asAppError(
    v: unknown,
    fb: { code?: ErrorCode; message?: string } = {}
): AppError {
    if (isAppError(v)) return v;
    if (v instanceof Error)
        return err(
            fb.code || 'ERR_INTERNAL',
            v.message || fb.message || 'Error',
            { cause: (v as any).cause }
        );
    if (typeof v === 'string') return err(fb.code || 'ERR_INTERNAL', v);
    return err(fb.code || 'ERR_INTERNAL', fb.message || 'Unknown error');
}
```

### Reporting API

```ts
const recent = new Map<string, number>(); // key => lastTs
const SUPPRESS_MS = 300;
export function reportError(
    input: unknown,
    opts: {
        code?: ErrorCode;
        message?: string;
        tags?: Record<string, any>;
        toast?: boolean;
        silent?: boolean;
        retry?: () => any;
    } = {}
): AppError {
    const e = asAppError(input, { code: opts.code, message: opts.message });
    if (opts.tags) e.tags = { ...(e.tags || {}), ...opts.tags };
    const key = e.code + '|' + e.message;
    const now = Date.now();
    const last = recent.get(key) || 0;
    const duplicate = now - last < SUPPRESS_MS;
    recent.set(key, now);
    if (!duplicate) {
        const level =
            e.severity === 'warn'
                ? 'warn'
                : e.severity === 'info'
                ? 'info'
                : 'error';
        (console as any)[level]('[err]', {
            code: e.code,
            msg: e.message,
            tags: e.tags,
            retryable: e.retryable,
        });
    }
    const hooks = useHooks();
    hooks.doAction('error:raised', e);
    const domain = e.tags?.domain as string | undefined;
    if (domain) hooks.doAction('error:' + domain, e);
    if (domain === 'chat') hooks.doAction('ai.chat.error:action', { error: e });
    if (
        !opts.silent &&
        !(e.code === 'ERR_STREAM_ABORTED' && e.severity === 'info')
    ) {
        if (opts.toast || e.severity !== 'info') pushToast(e, opts.retry);
    }
    return e;
}
```

`pushToast` provided by `useErrorToasts()` simple store.

### Logging

Inline inside `reportError` using `console` only. No extra abstraction.

### Hooks

Done inside `reportError`; no standalone emitter file.

### Retry (Optional)

`simpleRetry(fn, attempts, delayMs)` linear; consumers call manually. Not used automatically.

### UI Presentation

Nuxt UI toast system is used directly. `reportError` triggers `useToast().add({ title: code, description: message, actions:[{label:'Retry', onClick: retry}] })` when a toast should appear. No custom component or reactive store is maintained.

### Abort Handling

`useChat.abort()` calls:
`reportError(err('ERR_STREAM_ABORTED','Generation aborted',{severity:'info',tags:{domain:'chat',stage:'abort'}}), { code:'ERR_STREAM_ABORTED', toast: appConfig.errors?.showAbortInfo })`.
Default config `showAbortInfo=false` means aborts are logged + hooked but not toasted.

## Control Flow Examples (Lean)

Streaming failure: `catch(e){ reportError(e,{ code:'ERR_STREAM_FAILURE', tags:{domain:'chat', threadId, streamId}}) }`.
User abort: `reportError(err('ERR_STREAM_ABORTED','Generation aborted',{severity:'info',tags:{domain:'chat',stage:'abort'}}), { code:'ERR_STREAM_ABORTED', toast: false })`.
File validation: `throw err('ERR_FILE_VALIDATION','Unsupported file');` (UI catches & calls `reportError`).

## Error Mapping Rules

| Source                     | Mapping Logic                                                        |
| -------------------------- | -------------------------------------------------------------------- |
| Dexie `QuotaExceededError` | `ERR_DB_QUOTA_EXCEEDED`, retryable=false                             |
| Dexie generic error        | `ERR_DB_WRITE_FAILED` (write op) or `ERR_DB_READ_FAILED` (read path) |
| Fetch abort                | `ERR_STREAM_ABORTED`                                                 |
| 429 / Rate limit           | `ERR_RATE_LIMIT`, retryable=true (backoff)                           |
| Network offline            | `ERR_NETWORK`, retryable=true                                        |
| Validation (client)        | `ERR_VALIDATION`, retryable=false                                    |
| Unsupported model id       | `ERR_UNSUPPORTED_MODEL`, retryable=false                             |

## Sensitive Data Scrubbing

Inline helper: if value matches /(api|key|secret|token)/i and length>8 replace with '\*\*\*'. Not recursive deep clone.

## Linting & Tooling

Use existing ESLint rules: `no-console` (override allow errors in errors util), `no-empty` enforce comment. No custom plugin.

## Migration Strategy

1. Add file & start using in chat composable.
2. Convert openrouter callback page.
3. Replace empty catches opportunistically.
4. Add simple toast rendering if not present.
5. Document plugin usage.

## Testing Strategy

Unit: err(), asAppError(), duplicate suppression, scrub tokens.
Integration: chat abort (no toast), network failure (toast + retry), file validation (toast once).
UI: toast list renders code & message.

## Error Codes Registry (Initial)

| Code                  | Description                  | Retryable | Severity | Notes                          |
| --------------------- | ---------------------------- | --------- | -------- | ------------------------------ |
| ERR_INTERNAL          | Unclassified internal defect | false     | error    | Fallback                       |
| ERR_STREAM_ABORTED    | User aborted stream          | false     | info     | No toast (unless flag)         |
| ERR_STREAM_FAILURE    | Stream transport failure     | true      | error    | Retry allowed                  |
| ERR_NETWORK           | Generic network error        | true      | warn     | Offline detect                 |
| ERR_TIMEOUT           | Operation timed out          | true      | warn     | Backoff                        |
| ERR_DB_WRITE_FAILED   | Local DB write failed        | maybe     | error    | If transient=retry             |
| ERR_DB_READ_FAILED    | Local DB read failed         | maybe     | error    |                                |
| ERR_DB_QUOTA_EXCEEDED | Storage quota exceeded       | false     | error    | Show cleanup tip               |
| ERR_FILE_VALIDATION   | File type/size invalid       | false     | warn     | User fix                       |
| ERR_FILE_PERSIST      | File storage failure         | true      | error    | Retry                          |
| ERR_VALIDATION        | General input validation     | false     | warn     |                                |
| ERR_AUTH              | Auth / token failure         | maybe     | error    | If expired=retry after refresh |
| ERR_RATE_LIMIT        | Rate limited by provider     | true      | warn     | Backoff                        |
| ERR_UNSUPPORTED_MODEL | Model unsupported            | false     | warn     |                                |
| ERR_HOOK_FAILURE      | Hook subscriber threw        | false     | error    | Isolated & logged              |

## Sample Implementation Snippets

### Normalizer

```ts
export function normalizeError(
    raw: unknown,
    ctx: NormalizeContext = {}
): StandardError {
    if (isStandardError(raw)) return enrich(raw, ctx);
    let base: { message: string; name: string; cause?: any } = {
        message: '',
        name: 'Error',
    };
    if (raw instanceof Error) {
        base.message = raw.message || ctx.defaultMessage || 'Unexpected error';
        base.name = raw.name || 'Error';
        base.stack = trimStack(raw.stack);
        base.cause = (raw as any).cause;
    } else if (typeof raw === 'string') {
        base.message = raw;
        base.name = 'Error';
    } else {
        base.message = ctx.defaultMessage || 'Unknown error';
        base.name = 'Error';
        base.data = { raw: safeJson(raw) };
    }
    return err(ctx.code || 'ERR_INTERNAL', base.message || 'Error', {
        severity: ctx.severity || 'error',
        tags: ctx.tags,
        cause: base.cause,
    });
}
```

## UI Boundary Sketch

```vue
<template>
    <div v-if="fatalError" class="p-6 text-center">
        <h2 class="text-xl font-semibold">Something went wrong</h2>
        <p class="mt-2 text-sm opacity-80">Please reload or try again.</p>
        <button @click="reload">Reload</button>
        <details v-if="showDetails">
            <summary>Details</summary>
            <pre>{{ fatalError.message }} ({{ fatalError.code }})</pre>
        </details>
    </div>
    <slot v-else />
</template>
```

## Security Considerations

Do not log large prompt text unless explicitly tagged. Mask obvious secret keys.

## Configuration

Optional app config snippet (implemented):

```ts
errors: { showAbortInfo: false, maxToasts: 5 }
```

`maxToasts` retained (no-op with Nuxt UI toasts) for potential future cap logic.

## Rollback Plan

If needed, redefine `reportError` to just `console.error` and skip hooks.

## Open Questions

When to remove legacy chat hook? Need usage metrics first.
