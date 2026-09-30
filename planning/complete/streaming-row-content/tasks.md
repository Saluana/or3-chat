# Tasks

## 1. Establish the scroller contract

- [x] 1.1 Add a failing same-array, same-key rendered-content regression to the existing scroller component suite, then implement and document optional `rowContentRevision` in the scroller component/types/README.
      Requirements: R1, R2.AC1, R2.AC3, R3.AC2.
      Done when: revision changes refresh mounted DOM, offscreen rows mount with current content, keyed row instances survive, and structural reconciliation stays untouched in both mutation modes. Existing callers without the prop still pass. Build and lint the package.

## 2. Integrate chat with the built contract

- [x] 2.1 Validate the built scroller artifact in chat and update the chat projection to use same-slot replacement plus revision under the stable-snapshot/length/same-key guard. Keep all other assignments and deduplication behavior. Extend the existing chat suite with real-scroller rendering coverage.
      Requirements: R1, R2, R3.AC3.
      Done when: repeated text, reasoning, pending, tool, and attachment updates render with the same array; insertion/removal, id/stream_id deduplication, changed keys, completion/abort, history edits/prepends, workflow changes, and thread/tab changes show correct rows. The stale-rendering regression fails if the revision is disconnected.

## 3. Verify behavior and bounded work

- [x] 3.1 Update the existing scroll fixture to stream through a shallow list and revision; extend its browser tests and add the bounded-work case to the existing component coverage.
      Requirements: R1, R2.AC3, R3.AC1, R3.AC2.
      Done when: `bun run test:e2e:scroll` verifies rendered streaming growth, bottom following, browsing/edit suspension, offscreen updates, and content resets. The 100/10,000-row cases retain array identity and avoid history-wide work after setup; existing image-prefetch and arbitrary-mutation cases pass.

## 4. Qualify the dependency and document the contract

- [x] 4.1 Through the normal package release process, make the validated scroller contract available; pin that exact version in chat with its lockfile update. Document the display contract in the existing `useChat` documentation and refresh its docmap summary if needed. Inspect the final dependency/code diff and run the design's final validation commands once.
      Requirements: R1, R2, R3.
      Done when: the actual installed exports/types support the revision, targeted tests/browser canary/typecheck/lint/build pass, and the dependency update ships together with the chat change. No direct `node_modules` patch or unpublished sibling-source assumption remains. Package publication belongs to implementation/release work, not execution of this planning request.

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | Chat projection; scroller content contract; regression harnesses | 1.1, 2.1, 3.1, 4.1 |
| R2 | Chat projection; scroller content contract; regression harnesses | 1.1, 2.1, 3.1, 4.1 |
| R3 | Scroller content contract; existing scroll/measurement handling; package integration | 1.1, 2.1, 3.1, 4.1 |

## Definition of Done

All acceptance criteria pass, the verification commands are green, and the matrix has no gaps. Streaming updates render correctly without replacing the combined list or scanning history; structural changes and existing scroll behavior remain covered. Implementation checklist items remain unchecked until that work is performed.
