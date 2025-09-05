# tasks.md

artifact_id: 9d2d85a3-6e71-4ec3-905c-fca9b4adfd92

## 1. Canonical Message Abstraction

-   [ ] 1.1 Define `UiChatMessage` interface (Requirements: 1,2)
-   [ ] 1.2 Implement `partsToText` helper with tolerant parsing (Requirements: 3)
-   [ ] 1.3 Implement `ensureUiMessage` helper (Requirements: 1,3)
-   [ ] 1.4 Add non-reactive `rawMessages` store + `getRawMessages` accessor (Requirements: 4)
-   [ ] 1.5 Wire normalization into `sendMessage` (user message + assistant placeholder) (Requirements: 2)
-   [ ] 1.6 Wire normalization into `retryMessage` path (Requirements: 2)
-   [ ] 1.7 Dev warning when normalization produces empty text for user input (Requirements: 6)

## 2. UI & Hook Integration Simplification

-   [ ] 2.1 Replace mapped message list in `ChatContainer.vue` with direct reactive `messages` (Requirements: 5)
-   [ ] 2.2 Remove array/string defensive branches in `ChatMessage.vue` (Requirements: 5)
-   [ ] 2.3 Ensure streaming token append mutates `.text` only (Requirements: 2)
-   [ ] 2.4 Add dev-only deprecation warning on legacy hook access (Requirements: 4)
-   [ ] 2.5 Smoke test: send, stream, retry flows unchanged (Requirements: 6)

## 3. Testing & Validation

-   [ ] 3.1 Unit tests for `partsToText` edge cases (Requirements: 3)
-   [ ] 3.2 Unit tests for `ensureUiMessage` variants (Requirements: 3)
-   [ ] 3.3 Integration test confirming canonical shape in UI messages (Requirements: 1,2)
-   [ ] 3.4 Integration test verifying rawMessages retains original content arrays (Requirements: 4)
-   [ ] 3.5 Performance snapshot (token append latency baseline vs post) (Requirements: 6)
-   [ ] 3.6 Documentation update referencing migration + helpers (Requirements: 4,5)
-   [ ] 3.7 Final acceptance checklist verification (all requirements) (All)
