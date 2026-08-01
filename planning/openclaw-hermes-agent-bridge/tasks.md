# Tasks

## 1. Lock the deployment and trust boundary

- [ ] 1.1 Define the supported Agent Relay deployment targets and health contract.
      Requirements: R1.AC4, R1.AC5, R5.AC3, R7.AC4
      Done when: the relay URL, TLS requirement, control-plane authentication, health response, and static-build feature gate are documented and accepted; no UI assumes a relay exists.

- [ ] 1.2 Define the enrollment code format, expiry, attempt limit, approval state machine, and revocation semantics.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R6.AC4, R7.AC1
      Done when: a state-transition table covers pending, approved, consumed, revoked, expired, and rejected paths, including concurrent redemption and approval.

- [ ] 1.3 Define the v1 capability matrix and explicitly mark deferred features.
      Requirements: R2.AC5, R4.AC5, R6.AC2, R6.AC3, R8.AC2
      Done when: OpenClaw v1 capabilities, unavailable control behavior, and deferred attachments/reactions/voice/configuration are represented as a checked-in compatibility fixture.

- [ ] 1.4 Write the user-facing connection copy and exact OpenClaw setup command.
      Requirements: R1.AC1, R1.AC2, R1.AC4
      Done when: the flow explains code expiry, approval, outbound connection, online status, and revocation without asking for a Gateway URL or long-lived token.

## 2. Create the shared Agent Bridge protocol

- [ ] 2.1 Scaffold `packages/agent-bridge-protocol` as a framework-free workspace package with Bun build/test scripts.
      Requirements: R2.AC1, R2.AC4, R8.AC1, R8.AC2
      Done when: OR3 Chat, a Node connector package, and a future Hermes adapter can import the package without Nuxt/OpenClaw/Hermes dependencies.

- [ ] 2.2 Implement validated v1 hello, enrollment, capability, heartbeat, resume, acknowledgement, result, and error envelopes.
      Requirements: R1.AC2, R2.AC1, R2.AC2, R5.AC2, R7.AC2
      Done when: malformed and unknown-major envelopes fail with safe typed errors; bounded extension fields remain available for additive compatible data.

- [ ] 2.3 Implement turn, cancel, approval, and typed event envelopes with stable IDs and monotonic sequence rules.
      Requirements: R3.AC1, R3.AC2, R3.AC3, R4.AC1, R6.AC2, R6.AC3
      Done when: protocol tests reject missing identity/cursor fields and accept only the documented v1 event kinds.

- [ ] 2.4 Add protocol-level payload limits and secret-like field redaction helpers.
      Requirements: R4.AC3, R5.AC5, R7.AC2, R7.AC3
      Done when: oversized text/metadata fails before storage; fixtures prove known credential fields and oversized tool output cannot enter a projection payload.

- [ ] 2.5 Freeze runtime-neutral JSON fixtures for happy path, replay, gap, capability loss, cancel, approval, malformed frame, and recovered delivery.
      Requirements: R2.AC2, R4.AC4, R5.AC2, R5.AC4, R8.AC1
      Done when: every fixture validates in both directions and is used by the relay, OpenClaw, and future Hermes test suites.

## 3. Implement relay persistence and control-plane contracts

- [ ] 3.1 Define `AgentBridgeStore` and register it through the existing server registry convention.
      Requirements: R1.AC1, R5.AC1, R6.AC4, R7.AC1, R7.AC4
      Done when: the interface exposes only enrollment, connection, projection, cursor, and revocation operations; it contains no tunnel or `or3-intern` fields.

- [ ] 3.2 Implement enrollment and connection persistence with atomic code consumption and credential-hash storage.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R6.AC4, R7.AC1
      Done when: concurrent redemption produces one approved connection at most, raw code/credential values are never persisted, and revocation prevents reuse.

- [ ] 3.3 Implement session, turn, event, and live-preview projection persistence with the required uniqueness constraints.
      Requirements: R3.AC1, R4.AC2, R4.AC4, R5.AC1, R5.AC5
      Done when: `eventId` and `(turnId, sequence)` deduplicate replay, live preview remains one bounded row per active turn, and terminal projection can be queried in transcript order.

- [ ] 3.4 Add an SQLite store implementation and its focused contract suite.
      Requirements: R1.AC1, R3.AC5, R5.AC1, R5.AC2, R7.AC4
      Done when: atomic enrollment, workspace isolation, cursor persistence, projection-before-ack behavior, and revocation pass against SQLite.

- [ ] 3.5 Add a Convex store implementation and run the same contract suite.
      Requirements: R1.AC1, R3.AC5, R5.AC1, R5.AC2, R7.AC4
      Done when: Convex passes the identical contract cases without a provider-specific alternate behavior.

## 4. Implement the stateful OR3 Agent Relay

- [ ] 4.1 Scaffold the relay service with TLS-only WebSocket upgrade, health endpoint, connector authentication, and explicit configuration.
      Requirements: R1.AC4, R1.AC5, R7.AC1, R7.AC2
      Done when: an unauthenticated, non-TLS, or disabled connection cannot reach routing code and health reports whether the service is ready for enrollments.

- [ ] 4.2 Implement authenticated socket registration keyed by connection ID, runtime kind, and stable instance ID.
      Requirements: R2.AC1, R3.AC5, R6.AC1, R7.AC1
      Done when: one active socket can represent a connection, a duplicate instance is handled deterministically, and connection presence updates last-seen state.

- [ ] 4.3 Implement frame validation, rate limits, heartbeat deadlines, safe close reasons, and abuse counters.
      Requirements: R2.AC2, R7.AC2, R7.AC3
      Done when: bad frames are not forwarded/stored, safe diagnostics omit payloads, and reconnect after a valid close remains possible.

- [ ] 4.4 Implement cursor resume, store-before-ack, duplicate suppression, sequence-gap detection, and recovered-delivery metadata.
      Requirements: R3.AC4, R4.AC4, R5.AC1, R5.AC2, R5.AC4
      Done when: a fake connector can reconnect and replay any suffix without duplicate UI projection; a gap causes an explicit resume request rather than reordered output.

- [ ] 4.5 Implement relay control operations for turn submit, cancellation, approval resolution, and connection revocation.
      Requirements: R3.AC2, R3.AC3, R6.AC2, R6.AC3, R6.AC4
      Done when: control messages require a live matching connection and return acknowledged/rejected results; revocation terminates existing sockets and blocks future work.

## 5. Add OR3 Chat server APIs and browser projection

- [ ] 5.1 Add SSR enrollment create, approve, status, connection list, and revoke endpoints behind `can()` and no-store responses.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R6.AC1, R6.AC4, R7.AC4
      Done when: API tests cover unauthenticated, cross-workspace, rate-limited, expired, approved, and revoked requests without leaking secrets.

- [ ] 5.2 Add SSR session list/detail, turn submit, cancel, and approval endpoints that call the relay control plane.
      Requirements: R3.AC1, R3.AC2, R3.AC3, R5.AC3, R6.AC2, R6.AC3
      Done when: each route is workspace-scoped, rejects offline or unsupported controls honestly, and returns a typed retryable error rather than queuing hidden execution.

- [ ] 5.3 Add a browser-safe projection subscription endpoint with cursor resume and bounded payloads.
      Requirements: R4.AC1, R4.AC2, R4.AC4, R5.AC2, R5.AC5
      Done when: the subscriber receives only authorized projection updates, can resume after reload, and cannot request unbounded raw runtime logs.

- [ ] 5.4 Implement `app/core/agent-channels` DTOs, store client, snapshot publisher, and `AgentChannelController`.
      Requirements: R3.AC3, R4.AC2, R4.AC4, R5.AC3, R6.AC1
      Done when: controller tests prove workspace changes abort stale requests, preview replacement is monotonic, terminal states win, and connection states are derived from server data.

- [ ] 5.5 Register a separate Agent Channel Activity source using the existing owned registry and HMR cleanup pattern.
      Requirements: R4.AC3, R5.AC4, R6.AC1, R6.AC3
      Done when: Activity lists only actionable supported controls, maps stable bridge IDs to source/run/event IDs, and reconnect replay never duplicates terminal rows.

## 6. Build the OR3 Agents UI integration

- [ ] 6.1 Add a primary **Connect OpenClaw** enrollment panel and a relay-unavailable static fallback to Agents.
      Requirements: R1.AC1, R1.AC2, R1.AC4, R1.AC5
      Done when: a user can copy the exact command/code, observe expiry/pending/approved/offline state, and never sees a Gateway URL or connector credential.

- [ ] 6.2 Add connection inventory cards with runtime kind, capability summary, last-seen state, reconnect guidance, and revoke confirmation.
      Requirements: R2.AC5, R5.AC3, R6.AC1, R6.AC4
      Done when: unavailable features are visibly unavailable, offline history remains openable, and revoke requires intentional confirmation.

- [ ] 6.3 Add the Agent Channel session pane and bounded transcript projection.
      Requirements: R3.AC1, R3.AC3, R4.AC2, R5.AC1, R5.AC5
      Done when: accepted user messages, one live assistant segment, terminal answers, compact tool entries, terminal errors, and recovered-delivery labels render in order after refresh.

- [ ] 6.4 Add capability-gated cancel and approval cards with acknowledged state transitions.
      Requirements: R6.AC2, R6.AC3, R7.AC5
      Done when: controls are absent without capability support; failed actions retain the canonical prior state; no UI path sends a synthetic command override.

- [ ] 6.5 Add focused component and visual regression coverage without modifying existing `or3-intern` Agents behavior.
      Requirements: R4.AC3, R4.AC5, R5.AC3, R6.AC1
      Done when: tests cover progress redaction, offline recovery, disabled controls, and the existing external-agent visual suite still passes unchanged.

## 7. Implement and qualify `@or3/openclaw-channel`

- [ ] 7.1 Scaffold the package manifest, OpenClaw channel metadata, setup entry, runtime entry, and exact peer/version policy.
      Requirements: R1.AC2, R2.AC1, R2.AC3, R8.AC2
      Done when: the documented install-plus-add command can configure the channel, and a future catalog entry could discover its setup-safe metadata without importing a listener or agent runtime code.

- [ ] 7.2 Implement enrollment configuration, safe local credential storage, relay dial-out, heartbeat, and reconnect/resume.
      Requirements: R1.AC3, R1.AC4, R3.AC4, R5.AC2, R7.AC1, R7.AC2
      Done when: a connector uses only its scoped credential, no secret appears in command output/logging, and restart resumes its prior connection without user re-enrollment.

- [ ] 7.3 Map bridge session/turn messages into OpenClaw's channel inbound lifecycle with stable `or3:<connection>:<session>` conversation grammar.
      Requirements: R2.AC3, R3.AC1, R3.AC2, R3.AC5, R7.AC5
      Done when: text and slash commands reach the selected OpenClaw session unchanged and all execution/command authorization remains inside OpenClaw.

- [ ] 7.4 Map OpenClaw delivery, preview edits, final messages, tool progress, failures, and cancellation into bridge events.
      Requirements: R4.AC1, R4.AC2, R4.AC3, R4.AC5, R5.AC4, R6.AC2
      Done when: event fixtures prove stable sequencing and final state; raw command detail is omitted by default; media is rejected as unsupported in v1.

- [ ] 7.5 Implement advertised capability and approval-decision mapping without guessing unsupported OpenClaw behavior.
      Requirements: R2.AC5, R6.AC2, R6.AC3, R7.AC5
      Done when: the plugin's descriptor only exposes qualified controls, and an approval/cancel request is acknowledged or rejected by OpenClaw rather than locally simulated.

- [ ] 7.6 Run package unit/contract tests and a disposable Gateway smoke test against the pinned OpenClaw release.
      Requirements: R2.AC2, R2.AC3, R4.AC4, R8.AC1, R8.AC2
      Done when: channel discovery, enrollment, command pass-through, stream/final delivery, replay, cancel, malformed data, and restart are qualified before publishing.

## 8. Operate and release the OpenClaw integration

- [ ] 8.1 Add deployment, self-hosting, enrollment, revoke, recovery, and compatibility documentation.
      Requirements: R1.AC4, R1.AC5, R5.AC3, R6.AC4, R7.AC1
      Done when: docs clearly distinguish OR3 Agent Relay from `or3-intern` and from a direct OpenClaw Gateway connection.

- [ ] 8.2 Add relay metrics/logs containing only safe connection, protocol, replay, and action outcome metadata.
      Requirements: R5.AC3, R7.AC2, R7.AC3
      Done when: operators can diagnose offline/replay/protocol failures without message bodies, command text, or credentials in telemetry.

- [ ] 8.3 Add an opt-in live qualification lane and release gates for the relay and OpenClaw channel package.
      Requirements: R2.AC2, R5.AC2, R8.AC1, R8.AC2
      Done when: the normal unit suite remains offline/deterministic, while publishing requires a named real-Gateway smoke workflow and exact package version checks.

## 9. Qualify Hermes without duplicating the bridge

- [ ] 9.1 Capture the Hermes Relay connector descriptor/inbound/follow-up/interrupt wire fixtures for a pinned Hermes release.
      Requirements: R2.AC1, R2.AC4, R8.AC3
      Done when: fixtures identify all session, capability, stream, cancel, approval, and reconnect facts required by v1 without relying on undocumented fields.

- [ ] 9.2 Implement a Hermes Relay-to-Agent-Bridge adapter in the relay service behind a disabled feature flag.
      Requirements: R2.AC4, R3.AC1, R3.AC2, R4.AC1, R6.AC2
      Done when: the adapter imports only the shared bridge protocol and does not modify enrollment, browser controller, persistence, or OpenClaw code.

- [ ] 9.3 Run the shared protocol, relay, and browser fixture suites through the Hermes adapter and record the compatibility matrix.
      Requirements: R2.AC2, R2.AC5, R4.AC5, R6.AC3, R8.AC3
      Done when: each capability is marked supported/unsupported with evidence; missing behavior keeps the Hermes enrollment action disabled.

- [ ] 9.4 Publish Hermes setup and operational guidance only after the feature flag passes qualification.
      Requirements: R1.AC4, R5.AC3, R8.AC3
      Done when: Hermes users receive the same code/approval/outbound-connection experience as OpenClaw without a separate OR3 UI path.

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | Enrollment service, SSR API, relay | 1.1-1.4, 3.1-3.2, 4.1, 5.1, 6.1, 7.1-7.2, 8.1, 9.4 |
| R2 | Bridge protocol, OpenClaw channel, Hermes adapter | 1.3, 2.1-2.5, 4.2-4.3, 7.1, 7.3, 7.5-7.6, 9.1-9.3 |
| R3 | Relay control plane, session projection, controller | 2.3, 3.3, 4.2, 4.4-4.5, 5.2, 5.4, 6.3-6.4, 7.3, 9.2 |
| R4 | Event protocol, projection store, Agent session pane | 1.3, 2.3-2.5, 3.3, 4.4, 5.3-5.5, 6.3, 6.5, 7.4, 9.2-9.3 |
| R5 | Relay resume, projection store, subscription | 2.2, 2.5, 3.3-3.5, 4.4, 5.2-5.4, 6.2-6.3, 7.2, 7.4, 8.2-8.3 |
| R6 | Capability descriptor, controller, UI controls | 1.3, 2.3, 3.1-3.2, 4.2, 4.5, 5.1-5.2, 5.4-5.5, 6.2, 6.4-6.5, 7.4-7.5, 9.2-9.3 |
| R7 | Enrollment/store, relay validation, server authorization | 2.2-2.4, 3.1-3.5, 4.1-4.3, 5.1-5.3, 6.4, 7.2-7.5, 8.1-8.2 |
| R8 | Fixtures, version gates, capability matrix | 1.3, 2.1-2.5, 7.1, 7.6, 8.3, 9.1-9.4 |

## Definition of Done

- All R1-R8 acceptance criteria pass through deterministic protocol, store, relay, API, controller, and UI tests.
- The OpenClaw channel passes its pinned-version Gateway smoke test and its documented install-plus-add flow imports setup metadata safely before runtime activation.
- A user can complete code creation, approval, outbound connection, stream/progress/final delivery, browser reload, connector reconnect, cancel or approval when advertised, and revoke without exposing a Gateway URL or long-lived Gateway credential.
- Static/local-only OR3 remains unchanged, `or3-intern` External Agents regression tests pass, and the traceability matrix has no gaps.
- Hermes remains disabled until it passes the same shared fixture suite against a pinned Relay connector contract.
