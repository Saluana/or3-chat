# Requirements

## Introduction

OR3 Chat shall connect directly to compatible agent services in the existing Agents section, beginning with OpenClaw and then Hermes. The integration shall reuse the existing External Agents controller and UI while providing streamed output, runtime-owned slash commands, approvals, cancellation, and a URL-plus-token connection flow without requiring `or3-intern`.

## Context

OR3 Chat is a Nuxt 4/Bun application whose `app/core/external-agents` subsystem already defines `ExternalAgentClient`, stores trusted hosts and credentials, persists session references, projects streamed events, and renders approvals and cancellation. The remaining bootstrap in `app/plugins/external-agents.client.ts` is hardcoded to `@or3/intern-client`. Hermes already exposes authenticated session and Runs APIs with reconnectable SSE, stop, approval, and capability endpoints. OpenClaw exposes authenticated OpenResponses SSE and Gateway approval events, but needs a small plugin compatibility surface to present the same Runs API used by Hermes. Sources: [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/), [OpenClaw OpenResponses API](https://docs.openclaw.ai/gateway/openresponses-http-api), [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol), and [OpenClaw approval forwarding](https://docs.openclaw.ai/tools/exec-approvals-advanced).

## Assumptions

- The user's browser can reach the configured service URL through loopback, LAN, Tailscale, or HTTPS, and the runtime is configured to allow the OR3 origin when browser CORS applies.
- A connection uses the existing OR3 credential vault and consists of a service URL plus bearer token. OAuth, device pairing, tunneling, and a hosted relay are not required.
- The shared non-intern driver is named `runs`; OpenClaw and Hermes are runtime identities discovered through capabilities, not separate OR3 client implementations.
- Existing host records without a driver remain `intern` records. No database migration or server-side persistence is needed.
- Commands are ordinary user input beginning with `/` and are forwarded unchanged. The runtime remains authoritative for parsing and authorization.
- Attachments, artifacts, and runtime configuration remain capability-gated and are not prerequisites for the first OpenClaw or Hermes release.

## Out of Scope

- A hosted OR3 relay, connector enrollment service, new database tables, or new long-lived OR3 server process.
- A second Agents controller, transcript store, Activity source, or runtime-specific Agents UI.
- Starting, installing, updating, or administering OpenClaw or Hermes from OR3.
- Browser-side OpenClaw Gateway device identity and pairing support.
- Normalizing every runtime command into OR3-owned commands.
- Voice, reactions, native Discord/Telegram affordances, and arbitrary runtime administration.

## Requirements

### R1: Direct, low-friction connection

**User Story:** As an OR3 user, I want to connect an existing agent service with its URL and token, so that I can start using it without deploying OR3 infrastructure.

**Acceptance Criteria:**

- R1.AC1: WHEN a user adds an agent service THEN OR3 SHALL request only a display name, service URL, and bearer token, with the name optional.
- R1.AC2: WHEN valid connection details are submitted THEN OR3 SHALL verify health and capabilities before saving the host.
- R1.AC3: IF the service is unreachable, unauthorized, CORS-blocked, or incompatible THEN OR3 SHALL reject the connection and display a redacted actionable error.
- R1.AC4: WHEN the connection is saved THEN OR3 SHALL store the token through the existing External Agents credential vault and SHALL NOT place it in a URL, workspace transcript, Activity event, or ordinary host persistence.

### R2: One shared Runs driver

**User Story:** As a maintainer, I want OpenClaw and Hermes to use one OR3 driver, so that runtime support does not duplicate the Agents integration.

**Acceptance Criteria:**

- R2.AC1: WHEN a non-intern service is connected THEN OR3 SHALL access it through one `runs` implementation of `ExternalAgentClient`.
- R2.AC2: WHEN the service exposes `/v1/capabilities` THEN the driver SHALL use advertised session, streaming, stop, approval, and attachment features rather than runtime-name checks.
- R2.AC3: IF a persisted host has no driver field THEN OR3 SHALL load it as `intern` without changing its credential or session references.
- R2.AC4: WHEN a driver is selected THEN the External Agents client factory SHALL resolve it from a small driver registry and SHALL NOT import runtime-specific behavior into the controller or UI.

### R3: Sessions and runtime-owned commands

**User Story:** As an agent user, I want OR3 conversations and slash commands to remain attached to the correct runtime session, so that context and control are predictable.

**Acceptance Criteria:**

- R3.AC1: WHEN OR3 creates or resumes a conversation THEN the Runs driver SHALL associate the existing OR3 session reference with the runtime session identifier.
- R3.AC2: WHEN user input begins with `/` THEN OR3 SHALL submit it unchanged through the same turn-start operation used for ordinary messages.
- R3.AC3: WHEN OR3 reconnects or reloads a known session THEN the driver SHALL retrieve available runtime session, turn, and message history without creating a replacement session.
- R3.AC4: IF the runtime cannot provide a history operation THEN its capability response SHALL mark that operation unavailable and OR3 SHALL preserve its existing local projection without inventing remote history.

### R4: Streamed replies and progress

**User Story:** As an agent user, I want live text and tool progress in the existing Agents transcript, so that long-running work remains understandable.

**Acceptance Criteria:**

- R4.AC1: WHEN a run starts THEN the Runs driver SHALL consume its SSE event stream and translate supported events into the existing `ExternalRemoteStreamEvent` model.
- R4.AC2: WHEN text deltas arrive THEN the existing event store SHALL update one live assistant projection and preserve terminal-event precedence.
- R4.AC3: WHEN tool lifecycle events arrive THEN OR3 SHALL render the existing compact tool projection and SHALL NOT expose unbounded raw command output or credentials.
- R4.AC4: IF the stream disconnects THEN the driver SHALL resume from the runtime's supported event cursor or reconcile with run status; it SHALL NOT restart the run automatically.
- R4.AC5: IF an event is duplicated or arrives after a terminal event THEN the existing deduplication and terminal-state rules SHALL prevent duplicate or regressed UI state.

### R5: Truthful lifecycle and history

**User Story:** As an agent user, I want the existing Agents history to remain accurate across reloads and failures, so that I can distinguish completed, cancelled, failed, and still-running work.

**Acceptance Criteria:**

- R5.AC1: WHEN a run reaches a terminal state THEN the driver SHALL map it to exactly one existing external-agent status: `succeeded`, `failed`, or `cancelled`.
- R5.AC2: WHEN OR3 reloads THEN existing host records, credential references, session references, and locally projected events SHALL remain usable without a new persistence subsystem.
- R5.AC3: IF a runtime is offline THEN OR3 SHALL preserve prior history and reject new work with a retryable connection error rather than silently queueing it.
- R5.AC4: WHEN a runtime reports a running or waiting state after reconnect THEN OR3 SHALL display that state without claiming the run completed.

### R6: Approvals and cancellation

**User Story:** As an agent user, I want to approve, deny, or stop runtime work from the existing Agents controls, so that dangerous or unwanted actions remain under my control.

**Acceptance Criteria:**

- R6.AC1: WHEN an SSE stream reports an approval request THEN the driver SHALL project its stable approval identifier and allowed decisions into the existing approval card.
- R6.AC2: WHEN the user approves or rejects a request THEN the driver SHALL call the runtime's run-approval operation and SHALL retain the pending state until the runtime acknowledges the decision.
- R6.AC3: WHEN the user cancels an active run THEN the driver SHALL call the runtime's stop operation and SHALL retain the running state until cancellation is acknowledged or reconciled.
- R6.AC4: IF approval or stop is not advertised THEN OR3 SHALL hide or disable the corresponding control and SHALL NOT synthesize success.
- R6.AC5: WHEN OpenClaw requests an exec or plugin approval THEN the OpenClaw compatibility plugin SHALL expose it through the same Runs approval event and decision shape used by Hermes.

### R7: Security and bounded compatibility

**User Story:** As a user, I want OR3 to treat my agent credential and streamed data carefully, so that direct connectivity does not leak privileged access.

**Acceptance Criteria:**

- R7.AC1: WHEN the Runs driver sends a request THEN it SHALL use bearer authentication in a header and SHALL use `cache: "no-store"` for authenticated reads.
- R7.AC2: WHEN an HTTP or SSE error is shown to the user THEN OR3 SHALL redact tokens, authorization headers, URLs containing credentials, and raw runtime payloads.
- R7.AC3: IF a runtime returns an unknown event THEN the driver SHALL ignore it or retain it only as bounded diagnostic metadata and SHALL continue processing known events.
- R7.AC4: WHILE a runtime executes a command or tool THEN its native policy and approval system SHALL remain authoritative; OR3 SHALL NOT weaken or bypass it.

### R8: Minimal OpenClaw-first, Hermes-ready delivery

**User Story:** As a maintainer, I want to prove the shared path with OpenClaw and then enable Hermes without rewriting OR3, so that the integration remains small and deletion-friendly.

**Acceptance Criteria:**

- R8.AC1: BEFORE OpenClaw support is enabled THEN one fixture suite SHALL cover capabilities, sessions, run start, streaming, commands, approval, stop, terminal states, malformed events, and reconnect behavior for the Runs driver.
- R8.AC2: WHEN OpenClaw support ships THEN its only runtime-specific production code SHALL be the small compatibility plugin that presents the shared Runs/session surface.
- R8.AC3: WHEN Hermes support is enabled THEN it SHALL use the same Runs driver against Hermes's native API and SHALL NOT add a Hermes-specific controller, store, or UI path.
- R8.AC4: BEFORE completion THEN existing `or3-intern` External Agents tests, targeted Runs driver tests, relevant component tests, and the OR3 Chat type-check SHALL pass.
