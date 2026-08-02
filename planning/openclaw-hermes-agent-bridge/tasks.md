# Tasks

## 1. Add the minimal driver seam

- [x] 1.1 Add `ExternalAgentDriver = "intern" | "runs"` and an optional driver field to `ExternalAgentHost`.
      Requirements: R2.AC1, R2.AC3, R2.AC4, R5.AC2
      Done when: type tests compile and existing host fixtures remain valid without a driver field.

- [x] 1.2 Update External Agents persistence parsing and serialization so missing means `intern` and unknown driver values fail safely.
      Requirements: R2.AC3, R5.AC2, R7.AC2
      Done when: focused persistence tests cover legacy, `intern`, `runs`, and malformed records without a data migration.

- [x] 1.3 Extract the current Intern factory unchanged and replace the fixed bootstrap with a two-entry driver registry.
      Requirements: R2.AC1, R2.AC4, R8.AC4
      Done when: existing Intern controller and component tests pass through the registry with no behavior change.

- [x] 1.4 Add bounded connection detection using `/v1/capabilities` followed by the existing Intern verification path.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R2.AC2
      Done when: a valid Runs service and an existing Intern host select the correct driver, while ambiguous or unauthorized endpoints return a redacted error.

## 2. Implement the shared Runs client

- [x] 2.1 Add typed capability, session, run, and event DTOs beside the External Agents client adapter; do not create a new protocol package.
      Requirements: R2.AC1, R2.AC2, R7.AC3, R8.AC1
      Done when: runtime-neutral fixtures validate the minimum Sessions/Runs surface and reject missing required identities or terminal states.

- [x] 2.2 Implement authenticated no-store transport, health, capabilities, and a synthesized runner descriptor.
      Requirements: R1.AC2, R1.AC3, R1.AC4, R2.AC2, R7.AC1, R7.AC2
      Done when: unit tests cover success, 401, unreachable service, malformed JSON, abort, and redacted errors.

- [x] 2.3 Map session create/list/get and message history into the existing `ExternalRemoteSession` and `ExternalRemoteTurn` shapes.
      Requirements: R3.AC1, R3.AC3, R3.AC4, R5.AC2
      Done when: controller hydration tests can create, reopen, and list a Runs-backed session without replacing its runtime ID.

- [x] 2.4 Map run start and status into `startTurn()` and `getTurn()`, forwarding input—including slash commands—unchanged.
      Requirements: R3.AC1, R3.AC2, R5.AC1, R5.AC4
      Done when: fixtures prove ordinary text and `/command` use identical request construction and terminal statuses map exactly once.

- [x] 2.5 Implement incremental SSE parsing and pure event translation for text, tool progress, approvals, terminal completion, failure, and cancellation.
      Requirements: R4.AC1, R4.AC2, R4.AC3, R4.AC5, R5.AC1, R6.AC1, R7.AC3
      Done when: chunk-boundary, duplicate, unknown-event, redaction, and terminal-precedence fixtures pass through the existing event store.

- [x] 2.6 Implement cursor resume or status reconciliation without automatic run resubmission.
      Requirements: R4.AC4, R4.AC5, R5.AC3, R5.AC4
      Done when: a forced stream disconnect resumes or reconciles one run and never produces a second run-start request.

- [x] 2.7 Implement approval and stop operations with capability checks and acknowledged state transitions.
      Requirements: R6.AC2, R6.AC3, R6.AC4, R7.AC4
      Done when: approve, reject, stop, unsupported, rejected, and network-failure cases preserve canonical controller state.

- [x] 2.8 Capability-gate attachment and artifact operations without adding compatibility fallbacks.
      Requirements: R2.AC2, R3.AC4, R6.AC4
      Done when: supported operations use advertised endpoints and unsupported controls are absent rather than failing after user interaction.

## 3. Reuse the existing Agents connection and UI

- [x] 3.1 Update trusted-host enrollment to persist the detected driver while reusing the current URL, token, credential-vault, verification, and cleanup flow.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R1.AC4, R2.AC3
      Done when: adding, reconnecting, switching, and forgetting both driver kinds use the existing controller paths and never persist a raw token.

- [x] 3.2 Replace `or3-intern`-specific connection and error copy with `agent service` wording where the action now supports both drivers.
      Requirements: R1.AC1, R1.AC3, R5.AC3, R8.AC3
      Done when: connection, launcher, reconnect, and forget-host screens are accurate for Intern, OpenClaw, and Hermes without separate runtime pages.

- [x] 3.3 Surface detected runtime product and capability summary using the existing host/session presentation.
      Requirements: R2.AC2, R4.AC3, R6.AC4
      Done when: the UI can label OpenClaw or Hermes from capabilities and only shows approval, stop, attachment, or artifact controls when supported.

- [x] 3.4 Extend controller and component tests for a Runs-backed host without duplicating the Intern fixture suite.
      Requirements: R1-R7
      Done when: one shared scenario covers connect, session, stream, `/command`, approval, stop, offline reload, reconnect, and forget-host behavior.

## 4. Build the small OpenClaw compatibility plugin

- [x] 4.1 Scaffold one installable OpenClaw plugin package with a pinned compatibility range and only the routes/lifecycle hooks required by the shared Sessions/Runs surface.
      Requirements: R2.AC1, R6.AC5, R8.AC2
      Done when: the package loads in a disposable Gateway and contains no relay client, database, enrollment service, or model execution code.

- [x] 4.2 Expose health, `/v1/capabilities`, session create/list/get/history, run create/status, and run SSE routes using deterministic OpenClaw session keys.
      Requirements: R2.AC2, R3.AC1, R3.AC3, R4.AC1, R5.AC4
      Done when: the shared Runs client fixtures pass against the plugin for connection, session continuity, streaming, and terminal status.

- [x] 4.3 Submit run input through OpenClaw's normal channel/Gateway message lifecycle and preserve slash commands unchanged.
      Requirements: R3.AC2, R7.AC4
      Done when: ordinary prompts and representative owner-authorized commands reach the same OpenClaw session and remain subject to native command policy.

- [x] 4.4 Translate text deltas, preview/final delivery, compact tool progress, failures, and cancellation into the shared event shape.
      Requirements: R4.AC1, R4.AC2, R4.AC3, R4.AC4, R5.AC1, R6.AC3
      Done when: the plugin passes shared sequencing, disconnect, terminal, and stop fixtures without emitting raw unbounded tool output.

- [x] 4.5 Translate OpenClaw exec/plugin approval requests and decisions into the shared run-approval shape.
      Requirements: R6.AC1, R6.AC2, R6.AC5, R7.AC4
      Done when: an actual pending OpenClaw approval appears in the existing OR3 approval card and approve/deny resumes or rejects the native operation.

- [ ] 4.6 Add a pinned disposable-Gateway smoke test and minimal install/configuration documentation.
      Requirements: R1.AC1, R1.AC2, R8.AC1, R8.AC2
      Done when: a clean Gateway can install the plugin, print the URL/token guidance, and complete stream, command, approval, and stop smoke cases.

## 5. Qualify Hermes through the same driver

- [x] 5.1 Capture Hermes `/v1/capabilities`, Sessions API, Runs API, SSE, stop, and approval fixtures from a pinned release.
      Requirements: R2.AC2, R3.AC3, R4.AC1, R6.AC1, R8.AC1, R8.AC3
      Done when: fixtures identify any schema differences without adding Hermes branches to the controller or UI.

- [ ] 5.2 Run the shared Runs client contract suite against a configured Hermes API server and fix only runtime-neutral mapping gaps.
      Requirements: R2.AC1, R3-R7, R8.AC3
      Done when: connect, sessions, stream, `/command`, approval, stop, reconnect, and terminal status pass using the same production client used by OpenClaw.

- [x] 5.3 Add concise Hermes setup guidance for enabling the API server, bearer key, host binding, and explicit OR3 CORS origin.
      Requirements: R1.AC1, R1.AC3, R1.AC4, R7.AC1, R8.AC3
      Done when: a user can obtain the URL and token needed by the unchanged Agents connection form without installing an OR3 Hermes package.

## 6. Final verification and simplification

- [x] 6.1 Run focused External Agents unit/controller/component tests and the shared Runs fixture suite.
      Requirements: R8.AC1, R8.AC4
      Done when: all affected Vitest projects pass and failures are classified as introduced or pre-existing.

- [ ] 6.2 Run the OpenClaw disposable-Gateway smoke test and Hermes API contract test against their pinned versions.
      Requirements: R6.AC5, R8.AC2, R8.AC3, R8.AC4
      Done when: both runtimes prove the four required behaviors through the same OR3 driver.

- [x] 6.3 Run `bun run type-check` and inspect the complete diff.
      Requirements: R2.AC3, R7.AC2, R8.AC4
      Done when: type-check passes and the diff contains no hosted relay, new persistence subsystem, duplicate controller/UI, or unused compatibility abstraction.

- [x] 6.4 Perform a simplification pass and remove runtime-name branches, duplicate fixtures, unused DTO fields, and unsupported speculative options.
      Requirements: R2.AC4, R7.AC3, R8.AC2, R8.AC3
      Done when: OpenClaw-specific code is confined to its plugin, Hermes has no OR3-specific client, and OR3 Chat has exactly the `intern` and `runs` drivers.

## 7. OpenClaw live-test polish

- [x] 7.1 Canonicalize OpenClaw session identity, preserve incremental whitespace deltas, and register runs before dispatch.
      Done when: contract coverage proves OpenClaw's canonical session and public run IDs stream deltas into the matching OR3 run.

- [x] 7.2 Keep quiet SSE streams alive and continue bounded `agent.wait` polling until a terminal result, with history reconciliation as the completion fallback.
      Done when: a long wait result cannot turn into a silent terminal-less OR3 conversation.

- [x] 7.3 Discover OpenClaw's configured models, supported thinking levels, and live command catalog through public Gateway methods.
      Done when: the shared runner exposes runtime-owned model and command data without OpenClaw branches in OR3 UI code.

- [x] 7.4 Hide mode, isolation, and workspace controls when Runs capabilities mark them unsupported.
      Done when: the OpenClaw settings panel contains only controls that affect its next message.

- [x] 7.5 Add runtime-driven slash-command suggestions and bounded follow-up buttons for commands with choices.
      Done when: component and plugin contract tests cover command completion and sending a returned option through the normal follow-up path.

- [x] 7.6 Advertise and forward OpenClaw's native inline attachments through the shared Runs transport.
      Done when: the existing attachment picker appears for capable runtimes and a transient authenticated request delivers file name, MIME type, and content to OpenClaw.

- [x] 7.7 Consume OpenClaw's client-correlated live chat deltas and keep fallback waits alive beyond each server wait window.
      Done when: the route-owned Gateway event client streams chat deltas immediately and a long successful run cannot be falsely failed by the Gateway client's default 30-second timeout.

- [x] 7.8 Send and abort OpenClaw runs through the same Gateway connection, and contain rejected actions in the conversation pane.
      Done when: stopping a live stream succeeds without OpenClaw ownership errors, and a rejected stop or approval cannot reach the app-wide error boundary.

## Traceability Matrix

| Requirement | Design component                                      | Tasks                                                      |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| R1          | Existing enrollment, credential vault, Runs transport | 1.4, 2.2, 3.1-3.2, 4.6, 5.3                                |
| R2          | Driver discriminator, registry, Runs client           | 1.1-1.4, 2.1-2.2, 2.8, 3.1, 3.3, 4.1-4.2, 5.1-5.2, 6.3-6.4 |
| R3          | Runs sessions/history mapping, runtime command path   | 2.3-2.4, 2.8, 3.4, 4.2-4.3, 5.1-5.2                        |
| R4          | Runs SSE translator, existing event store             | 2.5-2.6, 3.3-3.4, 4.2, 4.4, 5.1-5.2                        |
| R5          | Existing persistence, run reconciliation              | 1.1-1.2, 2.3-2.6, 3.2, 3.4, 4.2, 4.4, 5.2                  |
| R6          | Existing approval/cancel UI, Runs controls            | 2.5, 2.7-2.8, 3.3-3.4, 4.1, 4.4-4.5, 5.1-5.2, 6.2          |
| R7          | Credential vault, redaction, capability boundary      | 1.2, 2.1-2.2, 2.5, 2.7, 3.4, 4.3-4.5, 5.2-5.3, 6.3-6.4     |
| R8          | Shared fixtures, runtime qualification, final checks  | 1.1-1.3, 2.1, 3.2-3.4, 4.1, 4.6, 5.1-5.3, 6.1-6.4          |

## Definition of Done

- Every R1-R8 acceptance criterion passes and the traceability matrix has no gaps.
- A user can connect OpenClaw with a URL and token, stream a response, send a slash command, approve or deny a native request, and stop a run in the existing Agents UI.
- The same production Runs client completes those behaviors against Hermes's native API without a Hermes-specific controller, store, UI, or plugin.
- Existing Intern hosts load without migration and the current `or3-intern` Agents behavior remains green.
- Targeted tests, pinned runtime contract/smoke tests, and `bun run type-check` pass.
- The final diff contains no hosted relay, new OR3 server service, new persistence layer, second Agents controller, or speculative generic framework.
