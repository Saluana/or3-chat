# Tasks

## 1. Preferences
- [x] 1.1 Add AI default and guarded per-chat/draft preference storage with reactive lifecycle ownership.
      Requirements: R2, R3
      Done when: defaults sanitize to off and writes preserve origin and revision.

## 2. Integration and controls
- [x] 2.1 Apply preferences to request preparation, retry, preview and execution; transfer draft state to created chats.
      Requirements: R1.AC2, R3.AC2
      Done when: disabled chats advertise and execute no tools.
- [x] 2.2 Replace the Tools count with a master switch, preserve category controls, and add the dashboard default.
      Requirements: R1.AC1, R1.AC3, R2.AC2, R3.AC1, R3.AC3
      Done when: independent chats restore selections and failed saves are visible.

## 3. Verification and documentation
- [x] 3.1 Add browser regression coverage before implementation; run targeted suites and typecheck; inspect and simplify the final diff.
      Requirements: R1, R2, R3
      Done when: repeatable browser artifacts and proportionate checks pass.
- [x] 3.2 Update the public tool guide, first-chat guide and docmap.
      Requirements: R1, R2, R3
      Done when: documentation matches the shipped controls and defaults.

## 4. Verification results
- Targeted settings, dashboard, registry, popover and native admission suites: 154 passed; one existing skipped case.
- Application typecheck and changed-file lint: passed.
- Browser journey: passed, including injected save failure, provider payloads, per-chat isolation, defaults after reload and draft transfer.
- Evidence: `test-results/tool-preferences/**/tool-preferences.png` and `provider-requests.json`.
- Repeat the browser journey from the repository root:
  ```sh
  OR3_LOCAL_PROVIDERS=false OR3_USE_LOCAL_PACKAGES=false OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true OR3_CHAT_TOOLS_TEST_HARNESS=true SSR_AUTH_ENABLED=false OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false OR3_BACKGROUND_STREAMING_ENABLED=false PW_PORT=3117 bunx playwright test tests/e2e/chat-tool-preferences.spec.ts --workers=1 --reporter=line --output=test-results/tool-preferences
  ```

## Traceability Matrix
| Requirement | Design component | Task |
| --- | --- | --- |
| R1 | Chat controls; request/execution gates | 2.1, 2.2, 3.1, 3.2 |
| R2 | AI defaults; chat preferences | 1.1, 2.2, 3.1, 3.2 |
| R3 | Chat preferences; request/execution gates | 1.1, 2.1, 2.2, 3.1, 3.2 |

## Definition of Done
Acceptance criteria pass, verification commands are green, artifacts are retained and traceability has no gaps. No release or deployment is requested.
