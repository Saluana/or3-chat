# Tasks

Tasks are ordered by dependency and intended to fit approximately 1–4 hours each. Check boxes represent implementation work; creating this plan does not complete them. Start with a working vertical slice, then finish startup convenience and failure handling. Do not add a second loader, remote transport, or publication project to this work.

## 1. Prepare a safe development profile

- [ ] 1.1 Extend the dedicated launcher to accept `--plugin <root>` and resolve a stable project-specific profile.
      Components: C2. Requirements: R1.AC4, R2.AC1, R2.AC3, R6.AC4.
      Done when: `scripts/__tests__/dev-plugin.test.ts` covers canonical paths, profile separation, `OR3_ADMIN_DATA_DIR`, all existing storage roots, required local provider/feature flags, and rejected outside-profile/remote overrides; manual no-argument startup remains available.

- [ ] 1.2 Add the smallest environment-loading seam needed for managed plugin startup and initialize local credentials.
      Components: C2. Requirements: R2.AC2, R2.AC3, R6.AC4.
      Done when: startup succeeds with no checkout `.env`, generates/reuses restrictive profile-local bootstrap/admin secrets, and a poisoned checkout `.env` or generated provider file cannot select shared credentials/services. Existing ordinary developer startup tests still pass.

- [ ] 1.3 Supervise the profile and child processes, isolating generated Nuxt/HMR state where required.
      Components: C2. Requirements: R2.AC4, R7.AC2.
      Done when: profile ownership rejects a second live owner, abandoned ownership is recoverable, actual selected port is reported, an ordinary host can coexist, and Ctrl+C/child failure releases owned processes without deleting data or terminating another server.

## 2. Build a measured vertical slice

- [ ] 2.1 Implement one initial candidate build and the serialized source watcher.
      Components: C3. Requirements: R3.AC1, R3.AC2, R3.AC3, R4.AC2.
      Done when: a Bun SDK subprocess produces verified immutable outputs; 150 ms debounce and one pending rebuild handle save bursts, imported-file additions/deletions/renames, and external edits during a build; failed builds preserve the last good metadata. Extend existing script/SDK tests where appropriate.

- [ ] 2.2 Integrate standard profile generation, source exclusions, and actionable build diagnostics.
      Components: C1, C3. Requirements: R3.AC1, R3.AC3, R6.AC4, R4.AC2.
      Done when: `.authoring` changes regenerate descriptors without an event loop, `.or3-dev` and secrets cannot enter snapshots, missing dependencies identify `bun install`, and syntax errors preserve Bun's file/line information. Existing candidate and packing exclusion suites cover the new local metadata.

- [ ] 2.3 Implement the two authenticated status/artifact read routes.
      Components: C4. Requirements: R3.AC4, R6.AC1, R6.AC2.
      Done when: only launcher-owned run/generation files can be read with no-store responses and bounded size; tests reject unauthorized, production, remote/cross-origin, traversal, symlink, stale-run, and arbitrary-filename requests. No filesystem-root input is accepted from HTTP.

- [ ] 2.4 Add the first development page/controller using existing admission and browser canary helpers.
      Components: C5, C6. Requirements: R3.AC4, R4.AC1, R5.AC1, R6.AC3.
      Done when: one signed-in browser polls status, constructs multipart data automatically, displays the existing authority review when needed, runs the real browser canary, promotes the exact digest, and requests reconciliation. Workspace identity is passed explicitly to every existing helper/route; production guards remain intact.

- [ ] 2.5 Display real runtime readiness and measure the edit loop before further UI work.
      Components: C3, C5, C6. Requirements: R3.AC4, R4.AC1, R4.AC4, R7.AC4.
      Done when: the real `PortableClientView` updates after a source edit without page reload, “running” waits for activation readiness, and stage timings for 20 warmed edits are recorded against the 3-second p95 target. If it misses, document and fix the measured bottleneck before calling the loop complete; do not skip validation.

## 3. Finish daily-loop behavior

- [ ] 3.1 Add digest no-op handling and structured pre-/post-promotion errors.
      Components: C3, C5, C6. Requirements: R3.AC5, R4.AC2, R4.AC3.
      Done when: source-only edits with identical package bytes do not restart/re-admit or rewrite provenance; build/admission/canary failures preserve selection; failed post-promotion activation is shown distinctly with existing recovery controls and no claimed data rollback.

- [ ] 3.2 Complete permission/setup resolution and invalidation of stale decisions.
      Components: C5, C6. Requirements: R5.AC1, R5.AC2, R5.AC3.
      Done when: unchanged authority proceeds automatically under current host policy; expanded authority prompts for exact displayed digests; a newer edit invalidates that prompt; missing setup, dependencies, and incompatible state have an actionable path without automatic state reset or plugin first-action execution.

- [ ] 3.3 Add one-controller ownership, disconnection recovery, and state-aware retries.
      Components: C4, C5. Requirements: R7.AC1, R7.AC2, R6.AC3.
      Done when: Web Lock ownership prevents two tabs mutating concurrently; unsupported browsers are explained; run/workspace/session changes cancel obsolete work; a lost promotion response is resolved by server state; closing/reopening the controller processes the newest pending candidate without selecting an older generation afterward.

- [ ] 3.4 Adjust development admission limits and implement bounded artifact cleanup.
      Components: C3, C4, C6. Requirements: R7.AC3, R7.AC2, R6.AC2, R6.AC4.
      Done when: the fully gated development path supports 60 edits, reports retry metadata, and uses existing pointer-aware GC plus watch-owned candidate/evidence cleanup; tests prove current/previous/candidate/in-flight artifacts, explicit exports, and application data cannot be deleted. Cleanup failure and the 512 MiB disposable-artifact budget pause new work with a visible diagnostic.

- [ ] 3.5 Verify real surface replacement and fix only observed lifecycle gaps.
      Components: C5, C6. Requirements: R4.AC4, R7.AC3.
      Done when: repeated reloads dispose old workers, callbacks, tools, panes, and sidebar contributions; persisted plugin settings/storage and supported field drafts survive; another plugin continues running. Existing portable runtime/component suites hold the regressions.

## 4. Remove first-run setup friction

- [ ] 4.1 Add the SDK `dev` command and starter `dev` script.
      Components: C1, C2. Requirements: R1.AC2, R1.AC3, R1.AC4, R6.AC4.
      Done when: an installed SDK in an external directory delegates to the remembered host, explicit `--host` links/relinks it, incompatible/missing hosts have concrete errors, signals/exits propagate, and local association is ignored/excluded. Existing CLI tests and a packed-SDK invocation pass.

- [ ] 4.2 Add host `--create` orchestration and beginner output.
      Components: C1, C2. Requirements: R1.AC1, R1.AC3.
      Done when: one command safely derives/accepts the ID, creates the portable template, prepares the local SDK, installs dependencies, records the association, starts the profile, and opens/prints the browser URL; nonempty directories are refused before any writes and partial install failures identify the recovery step.

- [ ] 4.3 Connect guided local sign-in and return navigation.
      Components: C2, C5. Requirements: R2.AC2, R7.AC2, R6.AC1, R6.AC4.
      Done when: the existing admin login page's dev-only mode accepts the printed password once, obtains normal app/admin sessions through existing login APIs, resolves the workspace, and returns to the protected preview. Test partial login failures, expiry, safe return-target validation, and production absence; no anonymous candidate access or token-bearing URL is introduced.

- [ ] 4.4 Polish accessible status and recovery affordances.
      Components: C5. Requirements: R4.AC1, R4.AC2, R4.AC3, R5.AC3.
      Done when: status is compact and announced accessibly, errors identify the next action, review/setup controls are keyboard usable, there is no success-toast flood, and a link opens the real plugin in Chat. Internal candidate mechanics remain in optional details rather than the primary flow.

## 5. Verify and document the complete experience

- [ ] 5.1 Add and run a named local browser harness for fresh-project development.
      Components: C1–C6. Requirements: R1.AC1, R1.AC2, R2.AC1–R2.AC4, R3.AC1–R3.AC5, R4.AC1–R4.AC4, R5.AC1–R5.AC3, R7.AC1–R7.AC4, R8.AC3.
      Done when: an external starter with a fresh profile and no external credentials passes create/login/review, 60 edits, syntax-error recovery, permission expansion, storage persistence, multiple tabs/surfaces, disconnection, and restart; recorded warmed latency meets the budget. Add `test:e2e:plugin-development` following the repository's named-harness pattern; do not run a broad Playwright lane.

- [ ] 5.2 Complete boundary, SDK packaging, and host validation.
      Components: C1–C6. Requirements: R6.AC1–R6.AC4, R7.AC3, R1.AC4.
      Done when: affected Vitest tests, SDK typecheck/build and packed external smoke, host type-check, and production/static boundary checks pass. Include destructive cleanup tests and simultaneous ordinary/dev-host isolation. Compare failures with the unchanged baseline and report pre-existing failures separately.

- [ ] 5.3 Update public documentation and SDK/starter instructions.
      Components: C7. Requirements: R8.AC1, R8.AC2, R1.AC1, R1.AC2.
      Done when: README and all design-listed public pages/docmap reflect the verified commands and host prerequisite, manual workflow remains documented, state reset limits are clear, and explicit candidate creation/verification/qualification is the submission handoff. Preserve concurrent edits; update provider READMEs only if provider behavior was changed.

- [ ] 5.4 Perform final simplification and diff review.
      Components: C1–C7. Requirements: R1–R8.
      Done when: acceptance evidence is recorded, every task maps to implemented components, and unnecessary options/abstractions/test scaffolding are removed. Inspect the final diff and SDK tarball; confirm no credentials, machine-specific links, disposable outputs, unrelated changes, or claims of unpublished registry availability ship.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 | C1, C2, C7 | 1.1, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4 |
| R2 | C2, C5 | 1.1, 1.2, 1.3, 4.3, 5.1, 5.2, 5.4 |
| R3 | C3, C4, C5, C6 | 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 5.1, 5.4 |
| R4 | C3, C5, C6 | 2.1, 2.2, 2.4, 2.5, 3.1, 3.5, 4.4, 5.1, 5.4 |
| R5 | C5, C6 | 3.2, 4.4, 5.1, 5.4 |
| R6 | C2, C4, C6 | 1.1, 1.2, 2.2, 2.3, 2.4, 3.3, 3.4, 4.1, 4.3, 5.2, 5.4 |
| R7 | C3, C4, C5, C6 | 1.3, 2.5, 3.3, 3.4, 3.5, 4.3, 5.1, 5.2, 5.4 |
| R8 | C1, C7 | 5.1, 5.3, 5.4 |

## Definition of Done

- All R1–R8 acceptance criteria have passing tests or recorded browser/latency evidence; the matrix has no gaps.
- The beginner reaches a working real plugin from the documented command and subsequently edits with `bun run dev`, without repeated uploads or administrative clicks.
- Permissions, isolation, immutable package verification, and explicit release qualification remain enforced.
- Proportionate final verification is green: affected `bunx vitest run` project/file selections; `bun run --cwd packages/plugin-sdk typecheck`; `bun run --cwd packages/plugin-sdk build`; `bun run type-check`; packed-SDK smoke; the new `bun run test:e2e:plugin-development`; and the repository production/static checks appropriate to the changed Nuxt/auth boundaries. Resolve exact test selections during implementation from `vitest.config.ts` and the named harnesses; do not invent a broad all-project gate.
- The final diff, tarball, documentation, and deletion boundaries have been reviewed. No release, deployment, or publication is part of this task.
