# requirements.md

artifact_id: 7d3c8d4d-9a4e-4872-9d2b-4a6f3a6a3c0a

## Introduction

We will standardize and strengthen error handling across the or3-chat codebase. Current patterns include: ad-hoc `console.error`, swallowed `catch {}` blocks, hook-based reporting (`ai.chat.error:action`), and minimal user-facing feedback. Objectives: consistency, no silent failures, tiny API surface, easy plugin usage, and future telemetry readiness without heavy abstractions.

Scope covers frontend (Vue/Nuxt composables, components, pages), DB layer utilities, streaming logic, hook system, and integration boundaries (OpenRouter API, Dexie persistence, file operations). Out-of-scope: third-party library internals and major architectural rewrites.

## User Roles

-   Developer (DEV)
-   End User (USER)
-   Plugin / Extension Author (EXT)
-   QA / Tester (QA)

## Requirements

### 1. Unified Error Object Model

As a DEV, I want a standardized error shape so that all layers can reason about and display errors consistently.
Acceptance Criteria:

-   WHEN any module throws or propagates an error THEN it SHALL either be a native `Error` or an object implementing `{ name, message, code, cause?, severity, tags?, retryable?, data? }`.
-   IF a non-Error (string/unknown) is caught THEN it SHALL be wrapped via a helper producing a `StandardError`.
-   WHEN wrapping an error with a cause THEN the original SHALL be accessible via `error.cause`.
-   WHEN severity not provided THEN it SHALL default to `"error"`.

### 2. Error Classification & Codes

As a DEV, I want canonical error codes for filtering, routing, and analytics.
Acceptance Criteria:

-   WHEN creating a `StandardError` THEN it SHALL use a code from a central registry enum (e.g. `ERR_STREAM_ABORTED`, `ERR_NETWORK`, `ERR_DB_WRITE_FAILED`, `ERR_VALIDATION`).
-   IF an unknown domain occurs THEN a generic `ERR_INTERNAL` code SHALL be used.
-   WHEN adding a new domain code THEN it SHALL be added to registry + documented.

### 3. Helper Utilities

As a DEV, I want ergonomic helpers to create, wrap, assert, and serialize errors.
Acceptance Criteria:

-   A factory `createStandardError(opts)` SHALL exist with strong typing.
-   A guard `isStandardError(val)` SHALL return boolean.
-   A `normalizeError(e, context)` helper SHALL always return a `StandardError` and attach context.tags.
-   A `toLogPayload(error)` helper SHALL produce safe JSON (no circulars, truncated large strings >8KB).

### 4. Logging Consistency (Lightweight)

As a DEV, I want all logs to be structured and suppress duplicate noise.
Acceptance Criteria:

-   WHEN logging an error THEN it SHALL use `reportError` (internally prints once via `console`).
-   IF same code+message occurs within 300ms THEN duplicate console output SHALL be skipped.
-   Log object SHALL include: code, message, severity, retryable, tags (if any).

### 5. Hook Integration (Simplified)

As an EXT author, I want uniform hook firing for error events.
Acceptance Criteria:

-   All reported errors SHALL emit `error:raised`.
-   IF `tags.domain` exists THEN `error:<domain>` SHALL emit.
-   IF `domain==='chat'` THEN legacy `ai.chat.error:action` SHALL emit for compatibility.

### 6. UI Feedback

As a USER, I want clear, minimal, non-technical error feedback with optional detail.
Acceptance Criteria:

-   WHEN a recoverable action fails (send message, upload file) THEN a toast/banner SHALL appear with friendly text + optional Details expander.
-   WHEN an unrecoverable fatal client error occurs THEN a fallback error boundary view SHALL render with reload guidance.
-   IF `retryable=true` THEN a Retry action SHALL be shown.
-   Sensitive internals (stack traces, raw request headers) SHALL NOT be shown by default.

### 7. Retry Semantics (Minimal)

As a USER, I want consistent retry affordances.
Acceptance Criteria:

-   WHEN an error is flagged `retryable` THEN calling the provided retry function SHALL re-execute the original operation with prior inputs.
-   Manual retry closure MAY be provided; no mandatory backoff or attempt counters.

### 8. Abort vs Failure Distinction

As a DEV, I need to distinguish user aborts from genuine failures.
Acceptance Criteria:

-   WHEN a user aborts a streaming request THEN a `StandardError` with code `ERR_STREAM_ABORTED` and severity `info` SHALL be generated but NOT surfaced as a UI error toast.
-   Abort events SHALL still trigger a hook `error:stream:aborted`.

### 9. Swallowed Error Elimination

As a DEV, I want zero silent `catch {}` blocks.
Acceptance Criteria:

-   All `catch {}` blocks SHALL be replaced with `catch (e) { logHandled(e, context) }` or explicit comment `// intentionally ignored: <reason>`.
-   A lint rule SHALL fail the build on empty catches without justification comment.

### 10. Metrics Readiness (Basic)

As a DEV, I want structured data ready for future telemetry.
Acceptance Criteria:

-   Hook payload SHALL be plain object friendly; large strings MAY be truncated optionally.

### 11. Testing (Focused)

As QA, I want automated tests guaranteeing behavior.
Acceptance Criteria:

-   Unit: wrapping, duplicate suppression, scrubbing.
-   Integration: chat abort (no toast), network failure (toast + retry), file validation toast.

### 12. Migration & Backwards Compatibility (Incremental)

As a DEV, I need a safe incremental rollout.
Acceptance Criteria:

-   Only touch hot paths first (chat, auth callback, DB) then opportunistic replacements.
-   Legacy chat hook kept until explicit later decision; no deprecation warning required now.
-   No codemod.

### 13. Documentation

As a DEV/EXT author, I need concise docs.
Acceptance Criteria:

-   A `docs/error-handling.md` SHALL explain: model, codes, usage patterns, migration steps, examples.
-   Each code SHALL have a one-line description + typical mitigation.

### 14. Performance Constraints (Pragmatic)

As a DEV, I want minimal overhead.
Acceptance Criteria:

-   Duplicate suppression store SHALL prune entries older than 1s on access.
-   No formal benchmark required.

### 15. Security & Privacy

As a DEV, I want to avoid leaking secrets.
Acceptance Criteria:

-   Normalizer SHALL scrub values that match secret heuristics (API keys, tokens) replacing with `***`.
-   Logger SHALL never stringify full File/Blob contents.

### 16. DX Tooling (Existing ESLint)

As a DEV, I want ESLint support & type safety.
Acceptance Criteria:

-   Use `no-console` with override allow in `utils/errors.ts` only.
-   Use `no-empty` to prevent silent catches (allow comment justification).

### 17. Graceful Degradation (Simple)

As a DEV, I want fallback behavior if logger fails.
Acceptance Criteria:

-   IF `reportError` internal logic throws THEN fallback to `console.error('[reportError-fallback]', raw)`.

### 18. Thread & Stream Context Enrichment

As a DEV, I want automatic context.
Acceptance Criteria:

-   Chat and streaming helpers SHALL attach `threadId`, `streamId`, `modelId` (if known), and message counts to error tags.

### 19. File & Attachment Handling

As a USER, I want clear errors for file issues.
Acceptance Criteria:

-   IF a file exceeds size/type limits THEN a validation error toast SHALL appear with code `ERR_FILE_VALIDATION`.
-   IF file persistence fails THEN user-friendly message + retry (if transient) SHALL show.

### 20. DB Operation Handling

As a DEV, I want deterministic DB error mapping.
Acceptance Criteria:

-   Dexie / IndexedDB errors SHALL be mapped to codes: `ERR_DB_READ_FAILED`, `ERR_DB_WRITE_FAILED`, `ERR_DB_QUOTA_EXCEEDED`.
-   Quota exceeded SHALL show guidance to clear space.
