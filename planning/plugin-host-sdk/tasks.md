# Tasks

Work in dependency order. Each checkbox is intended as roughly 1–4 hours of focused engineering, including its stated local verification; split a task before starting if discovery makes it larger. These are work slices, not a calendar commitment. Provider/browser qualification may reveal additional work, which must be recorded rather than hidden in a completed checkbox.

The named components below are defined in `design.md`. Every implementation task includes failure behavior and a concrete completion condition. Tests should extend the nearest canonical suite. Build the harness alongside production adapters; never postpone all validation to the end.

A local implementation or harness test is not production qualification. Reopened
items below retain their original acceptance conditions. Prior evidence notes are
implementation pointers, not receipts for this working tree. Installed receipts
must identify source commit and dirty state, package/archive digests, profile and
version, host commit/runtime, browser name/version/platform, command, probe
results and output path. A missing binding leaves qualification open.

## 1. Establish the executable contract and early risk gates

- [ ] 1.1 Record the method/profile support inventory in the existing qualification registry (2h).
      Component: SDK Context, Activation Boundary. Requirements: R1.AC1, R1.AC4, R17.AC3.
      Done when: every proposed namespace has a current/proposed method list, production adapter, grant and test reference; portable setup is distinguished from generic trusted V2 activation.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Namespace/method contract inventory includes chat.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Method-level harness references and production/installed support remain to be audited.

- [ ] 1.2 Specify the context, result codes and registration acknowledgment contract (3h).
      Component: SDK Context. Requirements: R1.AC1–R1.AC3, R2.AC3.
      Done when: SDK type fixtures compile a command/pane example, normalize RPC errors, and reject private imports/unsupported registrations with actionable diagnostics.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Context/result/registration types exist.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: RPC normalization and actionable rejection require cross-boundary evidence.

- [x] 1.3 Specify new grants, feature versions and review deltas in existing schemas (3h).
      Component: Activation Boundary. Requirements: R1.AC4, R2.AC1, R2.AC4.
      Done when: manifest/policy tests deny undeclared authority and block expanded grants on an existing review; no proposed feature is advertised prematurely.
- [x] 1.4 Characterize current Agents behavior and its complete dependency graph (3h).
      Component: Agents Migration. Requirements: R18.AC1–R18.AC4.
      Done when: an inventory covers entry point, UI, controller, credentials, attachments, Connect inventory/removal and navigation, with existing tests mapped to each parity scenario.
- [x] 1.5 Prototype long-lived stream admission against the current budget ledger (4h).
      Component: Network Transport, Activation Boundary. Requirements: R11.AC3, R11.AC4.
      Done when: an injected-clock experiment demonstrates which lifetime limits must change and records bounded callback, stream, spend and revocation semantics before implementation.
- [ ] 1.6 Run the custom-view containment feasibility probes (4h).
      Component: Surface Adapters. Requirements: R3.AC3, R3.AC5, R2.AC1.
      Done when: supported browser candidates have explicit pass/fail evidence for parent access, self-navigation/URL exfiltration, forms, networking, storage and packaged assets; failures have a recorded blocking decision, not a trust fallback.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Containment probe requirements are specified.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: September 17 portable evidence is historical; current artifact and custom-view browser qualification are missing.

- [ ] 1.7 Add the recommended `createTestHost()` shell over real SDK dispatch (4h).
      Component: Test Host. Requirements: R16.AC1, R16.AC3.
      Done when: install/disable execute actual setup/cleanup, unknown calls fail, and one compiled fixture can use both this entry point and the existing portable dispatcher.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: createTestHost contract exists.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: A single compiled fixture must demonstrate actual SDK setup/cleanup and portable dispatch.

## 2. Make ownership, data and workspace transitions dependable

- [ ] 2.1 Bind all context clients to captured host identity and operation controllers (3h).
      Component: Activation Boundary. Requirements: R2.AC1, R2.AC2, R12.AC1.
      Done when: forged scope fields cannot alter authority and an old context cannot read/write after workspace or selected-package replacement.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Captured identity and lifecycle contracts exist.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Comprehensive stale-context read/write rejection needs production and harness evidence.

- [ ] 2.2 Implement transactional registration activation and common disposal (4h).
      Component: Activation Boundary. Requirements: R1.AC2, R2.AC2, R2.AC3.
      Done when: setup failure, crash, double dispose and cleanup exceptions leave no live contribution/handler/operation in production and the harness.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Registration/disposal contract exists.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Production and harness failure/cleanup parity remains unqualified.

- [ ] 2.3 Add scoped storage revision/quota metadata and adapter boundary validation (3h).
      Component: Plugin Data. Requirements: R6.AC1–R6.AC3.
      Done when: values carry revisions and byte accounting without changing unrelated KV records; invalid/oversized writes retain the previous value.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Storage revision/quota contracts exist.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Adapter validation has local tests; installed boundary evidence is missing.

- [ ] 2.4 Implement storage CAS and paginated prefix listing (4h).
      Component: Plugin Data. Requirements: R6.AC1–R6.AC4.
      Done when: two tabs writing one revision produce one success/one conflict, paging stays scoped, and disable/update retains values.
      Evidence: host and portable test-host paths use the same deterministic
      cursor ordering; `ifRevision: null` is create-if-absent CAS and the
      transactional KV adapter rechecks the clock inside its write transaction.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: CAS/pagination contracts exist.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Local CAS tests do not establish installed two-tab races or update persistence.

- [ ] 2.5 Extend settings schemas for user preferences while preserving workspace configuration (3h).
      Component: Plugin Data. Requirements: R7.AC1–R7.AC3.
      Done when: schema/role tests distinguish user and workspace scope, validate defaults, and route credential fields away from ordinary settings.
      Evidence: setup descriptors preserve explicit `user`/`workspace` scope and
      `secret` markers; setup value/plan tests validate defaults and keep secret
      fields out of readiness and ordinary settings writes.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Schema preserves user/workspace and secret markers.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: User scope is reserved, not implemented user preference behavior.

- [ ] 2.6 Complete settings get/set/delete adapters and change delivery (3h).
      Component: Plugin Data, Public Events. Requirements: R7.AC2, R16.AC2.
      Done when: delete resets defaults, denied changes preserve old values, and real runtime/harness deliver the same scoped change event.
      Evidence: portable `settings.list`/`set`/`delete` are registered through the
      isolated RPC broker, host-authored `settings.changed` events carry the
      returned revision, and the test host covers default reset and denial behavior.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Settings methods and change-event contract exist.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Runtime/harness scoped event equivalence still needs qualification.

- [ ] 2.7 Implement workspace snapshots, change lifecycle and authorized switch requests (4h).
      Component: Public Events, Activation Boundary. Requirements: R12.AC1, R12.AC2, R12.AC4.
      Done when: success/cancel/failure switches preserve the documented authority boundary, new setup receives the right scope and delayed old writes are rejected.
      Harness evidence: successful, failed and concurrent authorized switches
      are transactional and stale contexts are rejected; production workspace
      manager integration and cancellation snapshots remain to be qualified.
- [ ] 2.8 Add two-plugin/two-workspace harness scenarios and typed event filtering (3h).
      Component: Test Host, Public Events. Requirements: R12.AC2, R12.AC3, R16.AC2, R16.AC4.
      Done when: shared tests prove isolation, disposal and content filtering; no test host can access another plugin's store through ordinary context methods.
      Evidence: the harness keys settings, storage, secrets, files and Activity
      registrations by workspace/plugin owner, scopes chat resources to the
      active workspace, and the conformance tests cover plugin replacement,
      workspace switching, stale contexts and cleanup.

  Evidence gates (the Done when condition above remains unchanged):

  - [x] Contract: Owner-scoping and typed event contracts exist.
  - [ ] Harness: qualify every stated behavior with named passing cases.
  - [ ] Production adapter: demonstrate the acceptance condition through the real dispatch path.
  - [ ] Installed qualification: record exact artifact/profile/host/runtime/browser evidence.

  Current gap: Harness coverage does not establish complete isolation across all contexts and production adapters.

## 3. Ship the first installed application milestone

- [x] 3.1 Define pane registration/data schemas and opaque instance routing (3h).
      Component: Surface Adapters, Pane Navigation. Requirements: R3.AC1, R4.AC1–R4.AC3.
      Done when: SDK/wire validators represent app versus pane instance and reject oversized/invalid restore data.
      Evidence: `pane-schema.ts` validates registration ids, targets, opaque
      instance keys, JSON depth/item limits and serialized restore bytes; the
      harness uses the same validator before creating pane refs.
- [ ] 3.2 Map pane/sidebar/card registrations to existing host adapters (4h).
      Component: Surface Adapters. Requirements: R3.AC1, R2.AC3.
      Done when: an installed fixture visibly registers each surface and teardown removes only its owned entries.
- [ ] 3.3 Implement pane open/focus/close and layout restoration (4h).
      Component: Pane Navigation. Requirements: R4.AC1, R4.AC3, R4.AC4.
      Done when: deduplication, explicit new/replace behavior, limits, missing apps and unsaved-work refusal follow host navigation rules.
- [ ] 3.4 Route render/events independently for two simultaneous panes (3h).
      Component: Pane Navigation, Surface Adapters. Requirements: R4.AC2, R2.AC2.
      Done when: editing either pane and reloading the layout cannot overwrite or misroute the other's state; closed-pane events are rejected.
- [ ] 3.5 Connect typed command registration/execution to the real palette (4h).
      Component: Surface Adapters. Requirements: R5.AC1–R5.AC3.
      Done when: availability, cancellation, duplicate IDs and cross-owner public-command permission behave identically in palette and test-host execution.
- [ ] 3.6 Add action buttons, accessible toast/confirm/progress adapters (3h).
      Component: Surface Adapters. Requirements: R3.AC1, R3.AC4, R15.AC3.
      Done when: mediated handlers work, progress disposes, keyboard focus returns correctly, and generic confirm cannot mint an operation approval.
- [x] 3.7 Extend harness pane/command/UI inspectors and shared conformance cases (3h).
      Component: Test Host. Requirements: R16.AC1, R16.AC4, R4.AC2, R5.AC1.
      Done when: the design's install → command → pane → storage example passes through real SDK dispatch with scoped assertions.
      Evidence: `PluginTestHost` exposes command, pane and UI registration
      inspectors and the install/command/pane/storage test exercises CAS,
      scoping, teardown and invalid restore data.
- [ ] 3.8 Build/install the command-pane-storage fixture in an external directory (4h).
      Component: Authoring Toolchain, Surface Adapters. Requirements: R1.AC4, R17.AC1.
      Done when: a named bounded SDK E2E script runs packed artifacts without sibling aliases through actual V2 installation, grants, activation, palette, two panes, reload and disable; **milestone 1 is complete**.

## 4. Provide host secrets and files

- [x] 4.1 Define secret-owner records, reference revisions and provider contract (3h).
      Component: Secret Custody. Requirements: R8.AC1–R8.AC3.
      Done when: types/validation distinguish own secrets, managed connections, memory, persistent, locked and missing states; no storage fallback is permitted.
      Evidence: `secret-schema.ts` and `PluginSecretRef` carry owner,
      persistence and state metadata; settings validation rejects secret fields,
      and the harness has no storage fallback for secret reads.
- [ ] 4.2 Adapt the existing memory/encrypted browser vault behind host custody (4h).
      Component: Secret Custody. Requirements: R8.AC3, R8.AC4.
      Done when: unlock/reload/lock tests pass and wrong PIN/corrupt ciphertext never exposes or overwrites a valid token.
- [ ] 4.3 Implement host-owned credential entry/unlock and scoped SDK methods (4h).
      Component: Secret Custody, Surface Adapters. Requirements: R8.AC1, R8.AC4, R7.AC3.
      Done when: secret-read and secret-use are separately enforced, host UI owns PIN entry, and secrets never enter settings save payloads.
- [ ] 4.4 Reuse server connection encryption/store providers for supported custody (4h).
      Component: Secret Custody. Requirements: R8.AC2, R8.AC3, R8.AC5.
      Done when: a supported durable provider survives restart and configured missing-key/store failures fail closed; unsupported providers expose truthful status.
- [ ] 4.5 Verify rotation, deletion, sign-out and export boundaries (3h).
      Component: Secret Custody, Test Host. Requirements: R8.AC1–R8.AC5, R16.AC2.
      Done when: cross-owner calls fail, decrypted state clears, reference revisions invalidate, and normal plugin exports/logs contain no token plaintext.
- [ ] 4.6 Define file handles and host-selected-file admission (3h).
      Component: File Access. Requirements: R9.AC1, R9.AC5.
      Done when: picker cancellation, scoped metadata, invalid handles and selection-only grants behave identically in host and harness.
- [ ] 4.7 Implement bounded file reads and staged writes using existing storage services (4h).
      Component: File Access. Requirements: R9.AC2, R9.AC3.
      Done when: chunked transfer supports configured sizes, replacement conflicts are explicit and interruption leaves no partially visible file.
- [ ] 4.8 Integrate workspace attachment references and file lifecycle cleanup (3h).
      Component: File Access, Chat and Models. Requirements: R9.AC2, R9.AC4, R9.AC5.
      Done when: attaching/releasing files uses host reference accounting and workspace switch/revocation stops unauthorized access without deleting accepted remote attachments.

## 5. Provide governed networking and long-lived sessions

- [ ] 5.1 Extend policy/setup schemas with declared destinations and reachability (3h).
      Component: Network Transport. Requirements: R10.AC1, R10.AC3, R2.AC4.
      Done when: a new service can be declared without a host provider, while methods/paths/origins and user-configured endpoint changes still require appropriate review.
- [ ] 5.2 Implement approved browser/server HTTP routing and response bounds (4h).
      Component: Network Transport. Requirements: R10.AC1, R10.AC3, R10.AC4.
      Done when: fixtures prove correct network location, no internal-cookie forwarding, redirect refusal and server resolved-address/private-target enforcement.
- [ ] 5.3 Add credential-reference injection and bounded multipart upload (4h).
      Component: Network Transport, Secret Custody, File Access. Requirements: R8.AC2, R8.AC5, R9.AC4, R10.AC1.
      Done when: credentials reach only their approved endpoint and a staged selected-file upload can cancel without a whole-file RPC envelope.
- [x] 5.4 Define stream/socket control envelopes and lifetime budgets (3h).
      Component: Network Transport, Activation Boundary. Requirements: R11.AC1, R11.AC3, R11.AC4.
      Done when: stream IDs, owner checks, pull/ack/cancel/terminal messages and rolling versus cumulative limits have validated schemas and deterministic ledger tests.
      Evidence: `stream-protocol.ts` validates versioned control envelopes,
      `StreamOwnershipRegistry` enforces activation ownership, and
      `StreamBudgetLedger` has injected-clock tests for queue, rolling and
      cumulative byte/chunk limits.
- [ ] 5.5 Implement raw-byte streaming and slow-consumer behavior (4h).
      Component: Network Transport. Requirements: R11.AC1, R11.AC3.
      Done when: bytes arrive before response completion, bounded queues backpressure upstream, abort reaches the transport and terminal settlement occurs once.
- [ ] 5.6 Implement SSE parsing and bounded opt-in reconnect (4h).
      Component: Network Transport. Requirements: R11.AC1–R11.AC3.
      Done when: split UTF-8/CRLF/multiline/heartbeat fixtures pass, Last-Event-ID resumes under rechecked authority, and POST is not automatically replayed.
- [ ] 5.7 Implement the fetch adapter and test actual intern/runs client integration (4h).
      Component: Network Transport, Agents Migration. Requirements: R10.AC2, R9.AC4, R11.AC2.
      Done when: requests, FormData, streaming Response and AbortSignal work with the real injected client interface and exactly one layer owns retries.
- [ ] 5.8 Implement WebSocket send/receive/close with bounded buffering (4h).
      Component: Network Transport. Requirements: R11.AC3, R11.AC5.
      Done when: binary/text delivery, overflow, close codes, unsupported transport and generation teardown pass conformance without automatic send replay.
- [ ] 5.9 Add scoped Cloud connection projection and management navigation (4h).
      Component: Network Transport, Public Events. Requirements: R10.AC5, R12.AC3.
      Done when: Agents can discover/refetch Cloud hosts and open authorized host removal UI without session cookies, config imports or private endpoint calls.
- [ ] 5.10 Qualify long-lived sessions and revocation under load (4h).
      Component: Network Transport, Test Host. Requirements: R2.AC2, R11.AC3, R11.AC4, R16.AC2.
      Done when: fake-time and one real-duration >120-second smoke pass, slow-consumer memory remains within recorded bounds, and lock/revoke/switch closes old transport ownership.

## 6. Complete conversation, model and activity integration

- [x] 6.1 Define public transcript/composer/approval DTOs from Agents scenarios (3h).
      Component: Surface Adapters, Chat and Models. Requirements: R3.AC2, R14.AC4.
      Done when: DTO fixtures cover streaming text, tool events, attachments, model choices and approval prompts without host component imports or unapproved chat content.
      Evidence: `chat-schema.ts` defines transcript/composer/approval DTOs and
      validates roles, bounded content, file ids and attachment metadata; the
      harness covers retry idempotency and malformed messages.
- [ ] 6.2 Implement host transcript and composer adapters (4h).
      Component: Surface Adapters. Requirements: R3.AC2, R3.AC4.
      Done when: existing theme/message/composer behavior is reachable through public primitives, with keyboard/narrow-pane fixtures and per-pane state.
- [ ] 6.3 Integrate attachment/model/approval controls into those primitives (4h).
      Component: Surface Adapters, File Access. Requirements: R3.AC2, R9.AC2, R15.AC3.
      Done when: selections and submit/cancel/approval events reach only their current pane/operation and protected approvals retain host authority.
- [x] 6.4 Add context AI model/completion facades and shared error mapping (3h).
      Component: Chat and Models. Requirements: R13.AC1, R13.AC3.
      Done when: approved/unavailable models, limits, real usage, spend and denial behavior match the current governed implementation.
      Evidence: portable `context.ai.models()`/`complete()` route through the
      host capability bridge under the reviewed `network.http` authority; the
      SDK maps structured refusal codes and the portable harness covers catalog,
      completion usage/spend and unconfigured responses.
- [ ] 6.5 Add AI streaming with final accounting and cancellation (4h).
      Component: Chat and Models, Network Transport. Requirements: R13.AC2, R11.AC3.
      Done when: partial output/abort/error retains accurate outcome and accounting, and unsupported hosts advertise the missing feature.
- [ ] 6.6 Implement chat create/open/append with resource checks and retry IDs (4h).
      Component: Chat and Models. Requirements: R14.AC1, R14.AC4.
      Done when: retries do not duplicate messages, attachments are authorized and navigation alone cannot read/write message content.
- [ ] 6.7 Complete chat tool/action and supported editor contribution mappings (4h).
      Component: Chat and Models, Surface Adapters. Requirements: R14.AC2, R14.AC3.
      Done when: installed tools remain opt-in, handlers cancel/dispose, supported editor actions render, and arbitrary host-executed extensions are explicitly unsupported.
- [ ] 6.8 Bridge scoped chat/settings/connection/resume events (3h).
      Component: Public Events. Requirements: R7.AC2, R12.AC2, R12.AC3, R14.AC4.
      Done when: payloads are versioned plain data, inaccessible content is filtered and reload recovery uses snapshots rather than assumed event replay.
- [x] 6.9 Add SDK Activity source mapping and action dispatch (4h).
      Component: Activity Projection. Requirements: R15.AC1, R15.AC2.
      Done when: replay/terminal-state behavior matches the existing registry, failed actions preserve canonical state and one broken source cannot stop others.
      Evidence: `app/core/activity/adapters/plugin-sdk.ts` maps SDK summaries,
      details, events and actions into the existing registry; adapter tests cover
      dispatch, disposal and isolation of a broken source.
- [ ] 6.10 Connect safe diagnostics and integration fixture qualification (4h).
      Component: Surface Adapters, Test Host, Authoring Toolchain. Requirements: R15.AC4, R16.AC4, R1.AC4.
      Done when: a clean installed fixture combines secret/file/network/stream/activity/chat capabilities, denied cases expose safe actionable errors, and **milestone 2 is complete**.

## 7. Extract Agents without behavior or data loss

- [ ] 7.1 Move pure Agents types/controller/presentation logic into the package (4h).
      Component: Agents Migration. Requirements: R18.AC1.
      Done when: existing characterization tests pass with relative imports and injected persistence/transport/clock dependencies.
- [ ] 7.2 Replace Agents storage/workspace/vault adapters with SDK clients (4h).
      Component: Agents Migration, Plugin Data, Secret Custody. Requirements: R18.AC1, R18.AC2.
      Done when: local and authenticated setup, saved host metadata and locked-vault resume work without database/auth imports.
- [ ] 7.3 Replace driver detection and Intern/runs network paths (4h).
      Component: Agents Migration, Network Transport. Requirements: R18.AC1, R18.AC2, R10.AC2.
      Done when: all outbound requests use approved transport and fixture tests cover driver detection, reconnect, cancel and ambiguous remote outcomes.
- [ ] 7.4 Port session panes and composer/transcript behavior to public UI (4h).
      Component: Agents Migration, Surface Adapters, Pane Navigation. Requirements: R18.AC1, R18.AC2, R4.AC2.
      Done when: two independent sessions retain transcript, draft, attachments and model controls without private ChatMessage/composer/theme imports.
- [ ] 7.5 Port sidebar, commands, Activity and Cloud host management (4h).
      Component: Agents Migration, Activity Projection. Requirements: R18.AC1, R18.AC2, R10.AC5.
      Done when: launcher/session navigation and host discovery/removal work from the installed package with no private Connect calls.
- [ ] 7.6 Port file staging and preserve provider-owned cleanup semantics (3h).
      Component: Agents Migration, File Access. Requirements: R9.AC4, R18.AC2.
      Done when: upload failure rolls back known staging, accepted turns retain files and ambiguous release outcomes show the existing safe warning behavior.
- [ ] 7.7 Implement host-owned metadata migration and verification receipt (4h).
      Component: Agents Migration. Requirements: R18.AC3, R6.AC4.
      Done when: a repeated migration copies scoped connection/session references once, verifies target data and never overwrites newer plugin revisions or deletes the source.
- [ ] 7.8 Implement unlocked credential migration and recovery cases (4h).
      Component: Agents Migration, Secret Custody. Requirements: R8.AC5, R18.AC3.
      Done when: successful unlock imports into the right owner scope, failed/cancelled unlock preserves old ciphertext and plugin references resolve after reload.
- [ ] 7.9 Add single-owner activation cutover and reversal (3h).
      Component: Agents Migration, Activation Boundary. Requirements: R18.AC4, R2.AC2.
      Done when: bundled/package implementations cannot register simultaneously, reverse rollout retains both data sets and unreadable new state is reported honestly.
- [ ] 7.10 Run clean external-package Agents parity and static/local checks (4h).
      Component: Agents Migration, Authoring Toolchain. Requirements: R18.AC1–R18.AC4.
      Done when: the full graph import check and local/Cloud/provider fixture matrix pass from the installed artifact, including migration/restart/two-pane/reconnect cases; **milestone 3 is complete**.

## 8. Complete custom application UI and developer workflow

This section depends on the feasibility result in 1.6 and the service/lifecycle foundations above. A failed containment gate blocks custom-UI qualification and milestone 4; it does not justify bypassing isolation.

- [ ] 8.1 Implement the versioned custom-UI package profile and asset validation (4h).
      Component: Authoring Toolchain, Surface Adapters. Requirements: R3.AC3, R3.AC5, R17.AC1.
      Done when: only the new profile admits bundled view dependencies, asset paths/digests are verified and the existing portable profile's restrictions remain intact.
- [ ] 8.2 Implement the qualified contained-view runtime and SDK bridge (4h).
      Component: Surface Adapters, Activation Boundary. Requirements: R3.AC3, R2.AC1, R2.AC2.
      Done when: view code uses its own document and the same host authority/lifecycle, with no private host imports, direct network or parent access.
- [ ] 8.3 Integrate theme, focus, resize and host-mediated interactions (3h).
      Component: Surface Adapters, Pane Navigation. Requirements: R3.AC4, R4.AC2.
      Done when: two custom views operate independently and theme/keyboard/narrow-layout tests pass without access to host Vue state.
- [ ] 8.4 Qualify a non-agent rich application against reachable containment probes (4h).
      Component: Surface Adapters, Test Host. Requirements: R3.AC3–R3.AC5, R18.AC5, R16.AC4.
      Done when: a file-backed data viewer with bundled interactive visualization uses public services, and each advertised browser passes the full escape/exfiltration suite.
- [ ] 8.5 Update starter templates and executable recipes (3h).
      Component: Authoring Toolchain. Requirements: R17.AC1, R17.AC3, R16.AC1.
      Done when: simple app, service integration and qualified custom-view examples compile and test from the packed SDK using the documented API/result shapes.
- [ ] 8.6 Add preview/watch over the existing development candidate flow (4h).
      Component: Authoring Toolchain. Requirements: R17.AC2, R2.AC2.
      Done when: edits replace the development activation, dispose old handles and preserve plugin storage without bypassing install/review policy or claiming a production release.
- [ ] 8.7 Refresh public documentation and affected provider READMEs (3h).
      Component: Authoring Toolchain. Requirements: R17.AC3, R17.AC4, R1.AC4.
      Done when: SDK, portable profile, runtime overview, CLI, grants, streams/secrets/files and Agents migration docs accurately describe qualified behavior, and `docmap.json` links resolve.
- [ ] 8.8 Prepare SDK release integration and clean artifact qualification (4h).
      Component: Authoring Toolchain. Requirements: R17.AC1, R17.AC4.
      Done when: publication workflow changes follow `docs/releasing.md`, packed ESM/types/examples have no private aliases, and a clean tarball consumer passes build/test/install. Publication itself awaits explicit release intent.

## 9. Final verification and simplification

- [ ] 9.1 Run the cross-boundary permission/lifecycle regression matrix (4h).
      Component: Activation Boundary, Test Host. Requirements: R1.AC4, R2.AC1–R2.AC4, R16.AC2–R16.AC4.
      Done when: cross-owner calls, update/revoke/sign-out/workspace races, corrupt state, duplicate disposal and partial setup fail safely through real installed packages.
- [ ] 9.2 Run relevant SDK/host/provider typechecks, builds and test lanes (4h).
      Component: Authoring Toolchain, Test Host. Requirements: R1.AC4, R17.AC4, R18.AC2.
      Done when: the command set below passes, introduced failures are fixed and independently demonstrated pre-existing failures are recorded without waiving affected acceptance criteria.
- [ ] 9.3 Inspect the final APIs, diff, bundles, tarballs and docs for unnecessary surface (3h).
      Component: SDK Context, Authoring Toolchain. Requirements: R1.AC3, R17.AC1, R17.AC3.
      Done when: duplicate wrappers, unused grants/options, private imports, unqualified capability claims and extra infrastructure are removed; all examples run as written.
- [ ] 9.4 Record milestone 4 qualification and rollout limits (2h).
      Component: Authoring Toolchain, Agents Migration. Requirements: R1.AC4, R17.AC4, R18.AC3–R18.AC5.
      Done when: the method/profile support matrix includes installed evidence, Agents and non-agent apps pass, migration reversal is verified and no unresolved required capability is labeled complete.

### Verification commands

During each slice use the relevant existing test file(s), adding cases to their canonical suites. Examples include SDK unit tests, `app/composables/plugins/__tests__/`, `shared/plugins/isolation/__tests__/`, connection dispatch tests and `app/core/external-agents/__tests__/`.

At final integration run the following existing checks once, then rerun only affected checks after fixes:

```sh
bun run plugin-runtime:sdk:check
bun run plugin-runtime:contracts:check
bun run plugin-runtime:v2-conformance:check
bun run plugin-runtime:isolation:check
bun run plugin-runtime:containment:qualify
bun run test:plugin-compatibility
bun run type-check
bun run --cwd packages/plugin-sdk build
bun run check:docs
```

Also run all affected core/integration tests, the named SDK installed-package E2E script added in task 3.8, the Agents fixture matrix, and builds/typechecks/tests for changed providers. Run the application build with the applicable fixed production profile plus a static/local build to verify SSR boundaries. Public authorization/schema changes warrant all relevant checks; publishing additionally requires the clean-worktree gates and exact package/registry checks in `docs/releasing.md`. Do not substitute a broad Playwright command that runs unrelated live/credential/visual suites. These are future implementation checks; this planning-only change needs document/traceability/link inspection.

## Traceability Matrix

| Requirement | Design components | Tasks |
| --- | --- | --- |
| R1 | SDK Context, Activation Boundary, Authoring Toolchain | 1.1–1.3, 2.2, 3.8, 6.10, 8.7, 9.1–9.4 |
| R2 | Activation Boundary, Test Host | 1.2–1.3, 2.1–2.2, 3.4, 5.1, 5.10, 7.9, 8.2, 8.6, 9.1 |
| R3 | Surface Adapters, Authoring Toolchain | 1.6, 3.1–3.2, 3.6, 6.1–6.3, 8.1–8.4 |
| R4 | Pane Navigation | 3.1, 3.3–3.4, 3.7, 7.4, 8.3 |
| R5 | Surface Adapters | 3.5, 3.7 |
| R6 | Plugin Data | 2.3–2.4, 7.7 |
| R7 | Plugin Data, Public Events, Secret Custody | 2.5–2.6, 4.3, 6.8 |
| R8 | Secret Custody, Network Transport | 4.1–4.5, 5.3, 7.8 |
| R9 | File Access, Network Transport, Agents Migration | 4.6–4.8, 5.3, 5.7, 6.3, 7.6 |
| R10 | Network Transport | 5.1–5.3, 5.7, 5.9, 7.3, 7.5 |
| R11 | Network Transport, Activation Boundary | 1.5, 5.4–5.8, 5.10, 6.5 |
| R12 | Public Events, Activation Boundary | 2.1, 2.7–2.8, 5.9, 6.8 |
| R13 | Chat and Models | 6.4–6.5 |
| R14 | Chat and Models, Surface Adapters, Public Events | 6.1, 6.6–6.8 |
| R15 | Activity Projection, Surface Adapters | 3.6, 6.3, 6.9–6.10 |
| R16 | Test Host | 1.7, 2.6, 2.8, 3.7, 4.5, 5.10, 6.10, 8.4–8.5, 9.1 |
| R17 | Authoring Toolchain | 1.1, 3.8, 8.1, 8.5–8.8, 9.2–9.4 |
| R18 | Agents Migration, Authoring Toolchain | 1.4, 7.1–7.10, 8.4, 9.2, 9.4 |

## Definition of Done

- Every requirement and acceptance criterion is implemented or explicitly remains incomplete; unsupported optional operations are documented as such rather than passed as successful implementations.
- All four milestone gates pass. General availability requires the custom-UI gate as well as standalone Agents and the non-agent reference app.
- Every advertised method has its production adapter, authorization, cleanup, harness behavior and installed-package evidence.
- Plugin builds require no OR3 checkout, private imports, Nuxt globals, shared node_modules or developer-only configuration.
- Secrets, files, storage and streams pass cross-workspace/user/plugin and revocation-race tests; UI supports two independent panes and accessible interaction.
- Agents preserves connection/session/attachment/approval behavior, migration is idempotent, legacy rollback data remains and only one implementation is active.
- Relevant tests, typechecks, builds, containment and documentation checks are green; the final diff and package contents are inspected.
- Public docs and provider READMEs describe actual runtime/profile support, limits and errors. The traceability matrix has no gaps.
- Release preparation and production publication remain distinct. No version is consumed or production state changed by completion of this plan alone.
