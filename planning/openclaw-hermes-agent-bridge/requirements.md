# Requirements

## Introduction

OR3 Chat needs a simple way for a user to connect an agent runtime that is already running on another machine, beginning with OpenClaw and later Hermes. The connection must use the runtime's messaging/channel surface rather than make the OR3 browser a privileged Gateway client. The result is an Agents experience that receives streamed replies, compact tool progress, runtime-owned commands, and supported approval/cancel controls without requiring the user to expose a Gateway URL or paste a long-lived Gateway token into OR3.

## Context

OR3 Chat is a Nuxt 4/Bun application with workspace-scoped Dexie data, a typed Activity registry, and a mature `app/core/external-agents` controller currently coupled to the `@or3/intern-client` HTTP contract. Its existing OR3 Connect device-code flow securely pairs computers but provisions a Cloudflare tunnel and an `or3-intern` environment, so it cannot be reused as-is. OpenClaw channels normalize inbound traffic, route replies deterministically, and provide channel-specific streaming previews; Hermes has the same adapter-to-session-to-agent shape and an experimental outbound Relay connector with negotiated capabilities. Sources: [OpenClaw Discord](https://docs.openclaw.ai/channels/discord), [OpenClaw Telegram](https://docs.openclaw.ai/channels/telegram), [OpenClaw channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins), [Hermes messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/), and [Hermes gateway internals](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals/).

## Assumptions

- The feature is available only for deployments that opt into an OR3 Agent Relay endpoint; static/local-only builds remain unchanged.
- OR3 operates or the self-hoster deploys the stateful relay endpoint. Agent runtimes make the outbound connection, so their local Gateway does not need a public listener or tunnel.
- OpenClaw support ships as a separately installable `@or3/openclaw-channel` package. Hermes support will use its Relay connector contract rather than a browser-facing API token.
- The first release supports text, streamed reply/progress, session history, runtime commands conveyed as text, cancellation when advertised, and approval decisions when advertised. Attachments, reactions, voice, and runtime configuration are deferred.
- OR3 owns its rendered delivery projection and connection metadata; each runtime remains authoritative for execution, tool policy, command authorization, and its native session state.
- One enrolled runtime connection belongs to one OR3 workspace. A user may enroll multiple connections and selectively make one active in Agents.

## Out of Scope

- Direct browser-to-OpenClaw Gateway connections, Gateway device-key storage, and Gateway administration.
- Starting, supervising, updating, or configuring OpenClaw, Hermes, models, or provider CLIs from OR3.
- Replacing, removing, or changing the current `or3-intern` External Agents transport.
- A universal abstraction for every runtime before OpenClaw is qualified.
- Platform-specific messaging features such as Discord buttons, Telegram reactions, file upload, voice, and arbitrary native channel actions.
- Persisting raw runtime logs, credentials, command arguments, or provider configuration in OR3.

## Requirements

### R1: Low-friction connection enrollment

**User Story:** As an OR3 workspace member, I want to connect my OpenClaw installation with one short-lived code and a documented CLI command, so that I do not have to expose or manually configure my Gateway in the browser.

**Acceptance Criteria:**

- R1.AC1: WHEN an authorized workspace member starts enrollment THEN OR3 SHALL create a single-use code that expires within 10 minutes and identifies the target workspace without exposing its internal ID.
- R1.AC2: WHEN an OpenClaw channel presents a valid unused code THEN OR3 SHALL require the workspace member to approve the named runtime connection before granting a scoped connection credential.
- R1.AC3: IF a code is expired, already consumed, malformed, or exceeds five failed redemption attempts THEN OR3 SHALL reject enrollment without disclosing workspace or account information.
- R1.AC4: WHILE a connection credential is active THEN the runtime SHALL initiate an outbound TLS connection to the Agent Relay and OR3 SHALL NOT require an inbound Gateway URL from the user.
- R1.AC5: WHEN OR3 is in static/local-only mode or no Agent Relay is configured THEN Agents SHALL explain that remote agent connections are unavailable and SHALL NOT show an unusable enrollment flow.

### R2: Runtime-specific connectors with one shared contract

**User Story:** As the product team, I want OpenClaw and Hermes to use one versioned OR3 bridge protocol, so that adding Hermes does not duplicate enrollment, browser projection, reliability, or security code.

**Acceptance Criteria:**

- R2.AC1: WHEN a connector joins the relay THEN it SHALL identify its runtime kind, protocol version, stable instance ID, and capability descriptor before receiving work.
- R2.AC2: IF a connector's protocol major version or required capability schema is unsupported THEN the relay SHALL fail closed and report an actionable compatibility error without accepting turns.
- R2.AC3: WHEN OpenClaw is connected THEN the `@or3/openclaw-channel` package SHALL translate OR3 bridge messages to and from OpenClaw's supported channel inbound/outbound lifecycle rather than reimplement model execution.
- R2.AC4: WHEN Hermes support is added THEN its Relay-connector adapter SHALL translate the Hermes Relay descriptor, inbound, follow-up, and interrupt semantics to the same OR3 bridge contract.
- R2.AC5: WHILE a runtime capability is not advertised THEN OR3 SHALL hide or disable the corresponding UI control and SHALL NOT attempt a best-effort fallback.

### R3: Session routing and runtime-owned commands

**User Story:** As an agent user, I want each OR3 Agent conversation to retain its intended runtime context and commands, so that an instruction, `/command`, or cancellation affects only that conversation.

**Acceptance Criteria:**

- R3.AC1: WHEN OR3 creates a conversation THEN it SHALL issue an opaque bridge session key scoped to the enrolled connection and active workspace.
- R3.AC2: WHEN a user sends text beginning with `/` THEN OR3 SHALL forward it unchanged as an ordinary inbound message and the runtime SHALL remain responsible for parsing and authorizing the command.
- R3.AC3: WHEN a runtime acknowledges a submitted turn THEN OR3 SHALL record the runtime turn ID and display the user message as accepted; IF the runtime rejects it THEN OR3 SHALL display a retryable error and SHALL NOT invent a running turn.
- R3.AC4: WHEN the connector reconnects THEN it SHALL resume each active bridge session from the last acknowledged delivery cursor and SHALL NOT create a replacement runtime session merely because the network reconnects.
- R3.AC5: IF a bridge session belongs to another workspace or another enrolled connection THEN the relay SHALL reject access before forwarding the message to a runtime.

### R4: Streamed reply and tool-progress projection

**User Story:** As an agent user, I want to see useful live progress and the final response in OR3, so that long-running tool calls feel responsive without exposing sensitive runtime details.

**Acceptance Criteria:**

- R4.AC1: WHEN a connector emits a streamed reply THEN it SHALL include a stable event ID, connection ID, session ID, turn ID, monotonic sequence, timestamp, and a typed event kind.
- R4.AC2: WHEN OR3 receives text deltas THEN it SHALL update one live assistant segment in sequence order and replace it with the terminal message when the runtime confirms completion.
- R4.AC3: WHEN a connector advertises tool progress THEN OR3 SHALL render compact title/status updates by default and SHALL omit raw command arguments, environment paths, credentials, and unbounded output.
- R4.AC4: IF an event is duplicated, arrives after a terminal state, or is older than the stored cursor THEN OR3 SHALL ignore it without altering the rendered terminal result.
- R4.AC5: WHEN a runtime does not advertise streaming or tool progress THEN OR3 SHALL show normal pending and final states without synthesizing token streaming.

### R5: Delivery, recovery, and truthful history

**User Story:** As an agent user, I want conversations to survive a browser reload or a connector restart, so that I can distinguish a recovered delivery from a newly executed turn.

**Acceptance Criteria:**

- R5.AC1: WHEN a runtime event is accepted by the relay THEN OR3 SHALL durably record the bounded display projection before exposing it to the browser.
- R5.AC2: WHEN an unacknowledged event is redelivered after reconnect THEN OR3 SHALL deduplicate it by its stable delivery/event identity.
- R5.AC3: IF a connector cannot establish or resume a connection THEN OR3 SHALL mark the connection offline, preserve prior history, and reject new turns with a retryable offline state rather than silently queueing execution.
- R5.AC4: WHEN a connector explicitly reports a possibly duplicated recovered final delivery THEN OR3 SHALL surface that recovery state to the user.
- R5.AC5: WHILE a turn is active THEN the relay SHALL retain only a bounded live preview and compact lifecycle events; final messages and terminal state SHALL remain available through the workspace's normal retention policy.

### R6: Safe controls and connection visibility

**User Story:** As an agent user, I want a clear connection status and only the controls my runtime can honor, so that I understand when OR3 can safely act on a remote session.

**Acceptance Criteria:**

- R6.AC1: WHEN an enrolled connector reports health and capabilities THEN Agents SHALL show its name, runtime kind, connection state, last successful connection time, and supported controls.
- R6.AC2: WHEN a selected session has advertised cancellation support THEN OR3 SHALL offer Cancel; IF cancellation fails or is not acknowledged THEN OR3 SHALL retain the prior running state and display a retryable error.
- R6.AC3: WHEN a selected session has advertised approval-decision support THEN OR3 SHALL render Approve and Deny only for the runtime's pending approval identifier and SHALL retain the pending state until the runtime acknowledges a decision.
- R6.AC4: WHEN a workspace member disconnects or revokes a connection THEN the relay SHALL revoke its credential, close active sockets, prevent new work, and preserve the OR3 display history.

### R7: Security and data minimization

**User Story:** As a workspace owner, I want the bridge to grant minimal, revocable access, so that connecting an agent does not expose Gateway credentials or allow a runtime to access unrelated workspaces.

**Acceptance Criteria:**

- R7.AC1: WHEN OR3 issues a connector credential THEN it SHALL be connection-scoped, revocable, stored only as a domain-separated hash server-side, and never appear in a URL, conversation, Activity event, or browser workspace storage.
- R7.AC2: WHEN connector frames are received THEN the relay SHALL enforce a maximum frame size, validate the versioned schema, rate-limit enrollment and turn submission, and close invalid connections.
- R7.AC3: WHEN the relay persists an event THEN it SHALL redact or reject credential-like fields and SHALL bound all text, metadata, and tool-output fields before storage.
- R7.AC4: IF an unauthorized OR3 user, connector, or workspace attempts to read or mutate a bridge resource THEN the server SHALL enforce the existing workspace authorization boundary and return a non-secret error.
- R7.AC5: WHILE a runtime executes a tool or command THEN its own policy remains authoritative; OR3 SHALL NOT bypass, broaden, or emulate runtime authorization.

### R8: Hermes-ready, deletion-friendly rollout

**User Story:** As the product team, I want OpenClaw to prove the bridge before Hermes is enabled, so that the shared protocol is useful without committing to unsupported abstraction or runtime behavior.

**Acceptance Criteria:**

- R8.AC1: BEFORE the OpenClaw package is published THEN the bridge protocol SHALL have fixture-based contract tests for enrollment, capabilities, turn lifecycle, reconnect replay, cancel, approval, and malformed frames.
- R8.AC2: WHEN OpenClaw is initially released THEN the only runtime-specific production component SHALL be its channel package; the OR3 relay, enrollment, projection, and browser client SHALL be runtime-neutral.
- R8.AC3: BEFORE Hermes is enabled THEN its documented Relay connector contract SHALL be qualified against the same fixture suite and capability mapping; IF its experimental protocol cannot meet the contract THEN Hermes support SHALL remain disabled rather than use an undocumented compatibility shim.
