# tasks.md

artifact_id: c40b0dcb-25ce-4c6b-9a36-d1c1dbe9f6a4

## 0. Meta

-   Status: Initial plan
-   Goal: Implement standardized error handling (requirements 1–20)

## 1. Core Utility (Req: 1,2,3,15)

[x] 1.1 Create single file `utils/errors.ts` with: types, `err`, `isAppError`, `asAppError`, `reportError`, `simpleRetry`, light scrub & duplicate suppression.
[x] 1.2 Add minimal unit tests (err/asAppError/reportError duplicate suppression + scrub).
[x] 1.3 Export functions for plugin authors via existing auto-import (add to d.ts if needed). Added `app/composables/useErrorApi.ts`.

## 2. Logging (Req: 4,17)

[x] 2.1 Use inline console in `reportError`; remove / ignore prior ad-hoc `console.error` after migration.
[x] 2.2 Replace high-noise spots (`useAi.ts`, openrouter callback) first.

## 3. Hooks (Req: 5,12,18)

[ ] 3.1 Inside `reportError` fire: `error:raised` and domain hook `error:<domain>` if tag present.
[ ] 3.2 Bridge legacy chat hook when `domain==='chat'`.
[ ] 3.3 Test: chat error triggers both hooks; non-chat only generic + domain.

## 4. Retry (Req: 7)

[ ] 4.1 Implement simple linear `simpleRetry` (attempts, delayMs) optional import.
[ ] 4.2 Use manual retry button via `reportError(...,{retry})` in chat send failure only.
[ ] 4.3 Test retry closure invocation.

## 5. UI (Req: 6,8)

[ ] 5.1 Add `useErrorToasts` composable (array + pushToast function used by `reportError`).
[ ] 5.2 Simple toast renderer component (iterate; show code + message + Retry if provided).
[ ] 5.3 Add optional minimal error boundary (fatal only) later (low priority).
[ ] 5.4 Chat abort suppressed unless config `showAbortInfo` true.

## 6. Chat Integration (Req: 1,4,5,7,8,18)

[ ] 6.1 Replace error branches in `useAi.ts` with `reportError`.
[ ] 6.2 Use tags: `{ domain:'chat', threadId, streamId, modelId }`.
[ ] 6.3 Abort path: `reportError(..., { silent: true })`.
[ ] 6.4 Provide retry closure that replays last user message.
[ ] 6.5 Tests: stream failure -> toast + retry; abort -> no toast.

## 7. DB (Req: 2,4,20)

[ ] 7.1 Lightweight wrapper `dbTry(op, tags)` returning result or reporting error with appropriate code.
[ ] 7.2 Map quota exceeded to `ERR_DB_QUOTA_EXCEEDED` else read/write.
[ ] 7.3 Tests: quota + write fail.

## 8. Files (Req: 19)

[ ] 8.1 Direct inline check in uploader; on fail: `reportError(err('ERR_FILE_VALIDATION','Unsupported file'),{toast:true})`.
[ ] 8.2 Persistence failures -> `ERR_FILE_PERSIST` with retry closure.
[ ] 8.3 Tests: invalid mime + oversize.

## 9. Auth Callback (Req: 2,6)

[ ] 9.1 Replace `console.error` with `reportError`.
[ ] 9.2 Missing verifier/code -> `ERR_AUTH` (no retry).
[ ] 9.3 CSRF mismatch -> `ERR_AUTH` (severity error, toast).
[ ] 9.4 Exchange network fail -> `ERR_NETWORK` retryable.
[ ] 9.5 Tests.

## 10. Empty Catches (Req: 9)

[ ] 10.1 Replace `catch {}` hotspots (chat, virtual list, openrouter page) with `catch(e){ reportError(e,{ code:'ERR_INTERNAL', silent:true }) }` or add explicit ignore comment.

## 11. ESLint (Req: 16)

[ ] 11.1 Update config: `no-console` warn except allow `utils/errors.ts`.
[ ] 11.2 Ensure `no-empty` enabled.

## 12. Documentation (Req: 13)

[ ] 12.1 Create concise `docs/error-handling.md` (1 page) with: quick start, API snippet, codes table.
[ ] 12.2 Add plugin example (adding domain tag + legacy chat hook note).

## 13. Config (Req: 8)

[ ] 13.1 Optional: add `errors.showAbortInfo` with default false.

## 14. Performance (Req: 14)

[ ] 14.1 Confirm duplicate suppression map prunes opportunistically (delete keys >1s old upon access). No benchmark needed.

## 15. Scrubbing (Req: 15)

[ ] 15.1 Implement simple token pattern replace.
[ ] 15.2 Unit test.

## 16. Graceful Degradation (Req: 17)

[ ] 16.1 If `reportError` itself throws wrap in try/catch and fallback to `console.error` raw.

## 17. Abort Policy (Req: 8)

[ ] 17.1 Test suppression & config toggle.

## 18. Context Tags (Req: 18)

[ ] 18.1 Inline object creation in chat (no helper) to reduce code.
[ ] 18.2 Test tag presence.

## 19. File Errors (Req: 19)

[ ] 19.1 Integrate validation & persistence mapping.
[ ] 19.2 Tests.

## 20. DB Tags (Req: 20)

[ ] 20.1 Add read/write tag when calling `dbTry`.
[ ] 20.2 Quota guidance message (string constant) added.

## 21. Legacy Hook (Req: 12)

[ ] 21.1 Keep bridge; add doc note only (no warn yet to avoid noise).

## 22. Cleanup

[ ] 22.1 Manual scan leftover `console.error` -> replace or justify.
[ ] 22.2 Remove unused codes.
[ ] 22.3 Run tests & lint.
[ ] 22.4 Add README short section link to docs.

## 23. Deferred (Optional Only)

[ ] 23.1 Persist last 20 errors (future if needed).
[ ] 23.2 Telemetry adapter stub.

## Mapping Summary

-   Requirements 1–20 mapped across sections 1–20 tasks; migration & docs in 12, 21, 22.

## Risk Mitigation

-   Guarded rollout via feature flag.
-   Incremental PRs per section (limit surface area).
-   Fallback logger ensures visibility.

## Dependencies

-   Section 1 precedes all.
-   Logger (2) required before integrations (6–11).
-   UI (5) after primitives but before mapping tasks for visual validation.

## Completion Criteria

-   All tasks through 22 complete.
-   Lint passes with zero violations of legacy patterns.
-   Tests green; documented codes stable.
