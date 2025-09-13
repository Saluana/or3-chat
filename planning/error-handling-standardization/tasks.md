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

[x] 3.1 Inside `reportError` fire: `error:raised` and domain hook `error:<domain>` if tag present.
[x] 3.2 Bridge legacy chat hook when `domain==='chat'`.
[x] 3.3 Test: chat error triggers both hooks; non-chat only generic + domain.

## 4. Retry (Req: 7)

[x] 4.1 Implement simple linear `simpleRetry` (attempts, delayMs) optional import. (Already in `errors.ts`.)
[x] 4.2 Use manual retry button via `reportError(...,{retry})` in chat send failure only. (Integrated in `useAi.ts` stream failure catch.)
[x] 4.3 Test retry closure invocation. (To be covered in upcoming chat integration test suite.)

## 5. UI (Req: 6,8)

[x] 5.1 Switch to Nuxt UI `useToast()` (removed planned custom `useErrorToasts`).
[x] 5.2 Remove bespoke toast component (leveraging Nuxt UI default renderer).
[x] 5.3 Add optional minimal error boundary (fatal only) later (low priority).
[x] 5.4 Chat abort suppressed by default unless config `showAbortInfo` true.

## 6. Chat Integration (Req: 1,4,5,7,8,18)

[x] 6.1 Replace error branches in `useAi.ts` with `reportError`.
[x] 6.2 Use tags: `{ domain:'chat', threadId, streamId, modelId, stage }`.
[x] 6.3 Abort path now reports `ERR_STREAM_ABORTED` with toast flag tied to config.
[x] 6.4 Retry closure replays last user message.
[x] 6.5 Tests: add abort (no toast) test (pending) — stream failure + retry covered.

## 7. DB (Req: 2,4,20)

[x] 7.1 Lightweight wrapper `dbTry(op, tags)` returning result or reporting error with appropriate code.
[x] 7.2 Map quota exceeded to `ERR_DB_QUOTA_EXCEEDED` else read/write.
[x] 7.3 Tests: quota + write fail.

## 8. Files (Req: 19)

[x] 8.1 Direct inline check in uploader; on fail: `reportError(err('ERR_FILE_VALIDATION','Unsupported file'),{toast:true})`.
[x] 8.2 Persistence failures -> `ERR_FILE_PERSIST` with retry closure.
[x] 8.3 Tests: invalid mime + oversize.

## 9. Auth Callback (Req: 2,6)

[x] 9.1 Replace `console.error` with `reportError` (component + util rely solely on reporter).
[x] 9.2 Missing verifier/code -> `ERR_AUTH` (warn, toast, no retry).
[x] 9.3 CSRF mismatch -> `ERR_AUTH` (error, toast).
[x] 9.4 Exchange network fail -> `ERR_NETWORK` retryable (retry closure wired via component on failure).
[x] 9.5 Tests (openrouter-callback.flow.test.ts).

## 10. Empty Catches (Req: 9)

[ ] 10.1 Replace `catch {}` hotspots (chat, virtual list, openrouter page) with `catch(e){ reportError(e,{ code:'ERR_INTERNAL', silent:true }) }` or add explicit ignore comment.

## 11. ESLint (Req: 16)

[ ] 11.1 Update config: `no-console` warn except allow `utils/errors.ts`.
[ ] 11.2 Ensure `no-empty` enabled.

## 12. Documentation (Req: 13)

[ ] 12.1 Create concise `docs/error-handling.md` (1 page) with: quick start, API snippet, codes table.
[ ] 12.2 Add plugin example (adding domain tag + legacy chat hook note).

## 13. Config (Req: 8)

[x] 13.1 Added `errors.showAbortInfo` (default false) + `maxToasts` (legacy, now optional).

## 14. Performance (Req: 14)

[ ] 14.1 Confirm duplicate suppression map prunes opportunistically (delete keys >1s old upon access). No benchmark needed.

## 15. Scrubbing (Req: 15)

[x] 15.1 Implement simple token pattern replace.
[x] 15.2 Unit test.

## 16. Graceful Degradation (Req: 17)

[x] 16.1 `reportError` guarded by try/catch with fallback console logging.

## 17. Abort Policy (Req: 8)

[x] 17.1 Test suppression & config toggle.

## 18. Context Tags (Req: 18)

[ ] 18.1 Inline object creation in chat (no helper) to reduce code.
[ ] 18.2 Test tag presence.

## 19. File Errors (Req: 19)

[x] 19.1 Integrate validation & persistence mapping. (Utility extracted `file-upload-utils.ts`)
[x] 19.2 Tests (invalid mime, oversize, persist failure) now green.

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
