# Persistent Projects review receipt

Implementation remains isolated and unmerged. No embeddings, release, or production deployment was added.

## Review checkouts

- Chat: `/Users/brendon/Documents/or3/or3-chat-projects`, branch `codex/persistent-projects`, base `988310e28ebbbb06795195e159fe8257feb8e395`.
- SQLite: `/Users/brendon/Documents/or3/or3-provider-sqlite-projects`, branch `codex/persistent-projects`, base `328887a052aa59951f973378aa8077c31db7abfa`.
- Convex: `/Users/brendon/Documents/or3/or3-provider-convex-projects`, branch `codex/persistent-projects`, base `8e7797f5ad6e9823f6bab3fefc0d80804d1a5038`.

Local preview: <http://127.0.0.1:3120/>. Open Projects in the sidebar. This preview uses local persistence; its deterministic journey routes are test-only. A normal chat still uses the user's OpenRouter connection.

## Verification

- 165 host runtime/integration tests passed; one pre-existing conditional test skipped.
- SQLite contract suite: 81 passed, two conditional tests skipped. Convex scaffold contract suite: 58 passed. Both standalone provider typechecks and builds passed; the updated Convex template pack deployed to a disposable local backend with backend typechecking enabled.
- Eight browser journeys passed, including Project Home, PDF/DOCX/scanned-file handling, failed replacement, full backup restore of source bytes and memories, project A streaming while B opens, same-ID recovery, context inspection after reload, reviewed handoff/exclusion, existing compaction family/navigation, and source Trash refusal. Final native admission/pane checks passed again after the workspace receipt guard. Additional real retry/mobile/keyboard checks passed.
- Authenticated SQLite and Convex sync with filesystem storage each passed both browser tests, including complete settings/memory/source revision round trips to a second session.
- Full Nuxt typecheck, documentation check (including mapped examples), registry-clean lock check, static generation, fixed Basic Auth + SQLite + filesystem cloud build, and final local preview build passed. Cloud qualification used disposable paths, generated secrets, and invite-only registration. Its first attempt lacked required filesystem configuration; it passed after configuring the disposable profile.
- Final diffs inspected; whitespace checks passed in all three repositories. Simplification reused internal posts, existing file reference accounting/backups, lexical search, and compaction rather than adding a new index or memory service.

Reports, screenshots, submitted-request captures, exported backup bytes, and logs are under `output/persistent-projects/`. Reproduce browser checks against the preview:

```sh
OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true PW_SKIP_WEB_SERVER=true PW_PORT=3120 bun x playwright test tests/e2e/persistent-projects.spec.ts --reporter=line
```

Provider cloud qualification uses the existing `test:e2e:workspace-cloud` launcher with `OR3_PROJECT_SQLITE_SOURCE` and `OR3_PROJECT_CONVEX_SOURCE` pointing at the isolated provider checkouts. Deploy the rebuilt Convex scaffold to a disposable backend for that lane.

## Known limits and follow-up

- One Convex-native-storage warm-upload test returns HTTP 403 from presign-upload. The same test fails with unchanged base application code against a fresh disposable backend and the same provider scaffold. The project round-trip test passes with native Convex storage, and both tests pass with filesystem storage. This pre-existing authorization failure remains separate from Projects; it was not waived or hidden.
- Provider ownership changes are not published. Cloud server execution needs the matching SQLite adapter or deployed Convex scaffold; older providers fail closed until upgraded. Project turns use browser execution. Unadapted server tools/background jobs and workflow/plugin inference refuse project execution.
- Arbitrary external tools require approval for each action; tool names alone cannot safely classify external side effects. Resource-limited tools must expose concrete repository arguments. Project settings narrow existing permissions.
- Extraction is bounded and does not perform OCR. Worker cancellation was inspected; no artificial timeout seam was added. Manual acceptance should include leaving Knowledge while a larger document processes and retrying any interrupted record.
- Dedicated project ACL sharing, connected-source refresh, larger retrieval, and project-only bundles are not implemented in this review. Phase 3 first defines their permission and preservation contracts, as scoped by R7.AC2; existing workspace sync and full workspace backups already preserve Projects.

## Suggested acceptance

Create two projects. Save instructions and a decision, upload a PDF and image, replace a file with a broken version, retry and inspect history, and exercise all three context modes. Send with temporary attachments, promote one explicitly, remember a response, continue in a new chat, review its brief/memory suggestions, and exclude its evidence chat. Switch projects while a response streams, reload the inspector, and export/restore a disposable workspace. Test cloud copies only with the corresponding review providers/scaffold. Do not merge or publish until user acceptance.
