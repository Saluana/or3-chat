# Requirements

## Introduction

Eligible delegated research must continue after the user closes the site, and returning clients must show the actual child outcomes. Move ownership into the existing server job lifecycle, preserving canonical chat history and explicit cancellation. A browser disconnect must neither manufacture a failure nor start replacement work.

## Context

Today `delegate_chat` is a browser tool, even inside a background parent. `DelegatedChatRunner.vue` forces foreground execution and aborts on unmount; the browser claim and local receipt cannot prove a child's final outcome. The server already has admission, leases, checkpoints, cancellation, canonical history and reattachment, but no durable parent/child coordination. Its recovery can resend a model request after a lost worker; default completed-job retention is five minutes. The memory provider implements the existing “durable” method interface without persisting across restart. Removing `forceForeground`, increasing the claim timeout, or relying on the current capability predicate is insufficient.

## Assumptions

- First qualify persistent SQLite jobs with SQLite canonical sync on authenticated SSR. This is a proposed initial support profile, not an assertion about the VPS configuration. Verify installed package versions and profile before claiming production support.
- Version 1 supports new, text-only, project-free child chats, with existing model, variant and reasoning controls. The complete durable parent/child tool set must be server-executable under existing permissions. Continuing an existing child, projects, local-only data and browser-only tools retain their foreground path with a visible limitation; no automatic mid-call switch.
- A durable child uses the admitted effective system/developer context and allowed server tools, plus its explicit task. It does not silently copy the parent's whole conversation or depend on browser preparation hooks. Unsupported preparation makes the request ineligible.
- Closing a browser, losing a viewer connection, logging out or switching workspace is not Stop. Current access still gates server work and result delivery.
- Preserve the catalog-search and mobile-tab fixes. The in-progress durable-delegation implementation is not an advertised provider release.

## Out of Scope

- New orchestration services, general task graphs, recursive delegation, arbitrary system-prompt overrides, automatic retries of uncertain actions, or new plugin permissions.
- Changing canonical user/workspace authority, sync ordering/idempotency, the selected backend, or replacing existing data.
- Guaranteeing completion or exactly-once upstream billing through server crashes, provider outages or lost credentials. Recovery cannot reconstruct an unrecorded upstream result.
- Repairing legacy failures from partial text or deploying to the VPS. The user subsequently requested publication through the documented release workflows.

## Requirements

### R1: Durable delegation

**User Story:** As a user, I want eligible delegated chats to keep working after I leave, so that I can return to completed research.

**Acceptance Criteria:**

- R1.AC1: WHEN an eligible parent delegates THEN admitted children SHALL execute without an open browser, and the parent SHALL resume from a persisted ordered tool result once its children settle.
- R1.AC2: WHEN an authorized user reopens the site or signs in on another device THEN the parent, every child and their recorded outcomes SHALL be discoverable without the original browser's KV receipts.
- R1.AC3: IF the complete request is ineligible THEN the UI SHALL show the browser requirement before foreground execution; a durable call that discovers an unsupported target SHALL return a structured unsupported result before launching that child, without silently falling back.
- R1.AC4: WHEN durable delegation is advertised THEN the installed job provider SHALL explicitly support the versioned persistent coordination contract and the sync adapter SHALL support canonical admission, reads and finalization; memory and old providers SHALL NOT satisfy this gate merely by exposing similarly named methods.
- R1.AC5: WHEN preparing a child THEN the server SHALL bind its immutable task, exact model/variant, reasoning settings, effective prompt context and permitted tools to the originating parent authorization; unresolved context, browser-only preparation and nested delegation SHALL be rejected before child dispatch.

### R2: Accurate outcomes and recovery

**User Story:** As a user, I want the displayed result to reflect the actual child outcome, so that I can trust the parent conversation.

**Acceptance Criteria:**

- R2.AC1: WHEN a child completes THEN the parent SHALL consume that exact generation's retained result only after canonical finalization confirms it; reconnecting or restarting SHALL NOT substitute another message or partial response.
- R2.AC2: IF a viewer transport is interrupted THEN the UI SHALL show reconnecting while preserving authoritative job state; IF execution may have occurred without a recorded result THEN it SHALL show outcome unknown, distinct from confirmed failure or cancellation.
- R2.AC3: WHEN an admission or checkpoint is delivered again THEN it SHALL reuse its scoped child identity and saved settlement; IF a model request may already have been dispatched THEN recovery SHALL NOT automatically dispatch it again. Reusing an identity with different arguments SHALL fail closed. An unknown child settlement SHALL block further delegation in that parent turn until a new user request.
- R2.AC4: WHEN children settle with different outcomes THEN the parent and activity UI SHALL retain each outcome and a link whenever a child exists, including completed children alongside failed, stopped, unknown or unavailable children.
- R2.AC5: WHILE a parent still needs a child result THEN cleanup SHALL retain the evidence needed for reconciliation; WHEN the parent records its tool result THEN canonical history SHALL retain bounded child identity/outcome metadata so reopening after job retention expires remains correct.
- R2.AC6: IF history delivery is pending, blocked, superseded or deleted THEN the UI SHALL distinguish that state from a model failure; recovery SHALL NOT overwrite a newer generation or recreate deleted content.

### R3: Safe orchestration

**User Story:** As a user, I want independent tasks to run together and dependent tasks to wait for their inputs, without losing control of cancellation.

**Acceptance Criteria:**

- R3.AC1: WHEN a batch contains up to four valid independent tasks THEN the server SHALL admit children up to available global/user capacity without waiting for earlier results and SHALL return outcomes in input order. With one available execution slot, the batch SHALL still make progress.
- R3.AC2: WHEN a later task depends on earlier work THEN it SHALL start only when the parent receives the prior result and requests the later task; separate tool calls SHALL retain their current ordered semantics.
- R3.AC3: WHEN an authorized user stops the parent THEN durable cancellation intent SHALL prevent further child admission and parent continuation and SHALL propagate to active children despite restarts or concurrent admission; already completed results SHALL remain intact.
- R3.AC4: IF capacity is full or one child fails THEN other children SHALL retain their identities and results; capacity retries SHALL only reconsider admission, not repeat paid execution.
- R3.AC5: WHILE a parent waits THEN it SHALL release its model execution slot, count against a separate bounded parked-job limit, and use the existing bounded reconciliation loop. Each delegation SHALL have a persisted two-hour maximum deadline; provider execution limits may shorten actual runs. Expiry SHALL stop new admission, request cancellation and report unresolved work honestly, without fabricating upstream failure.
- R3.AC6: WHEN workers race, lose leases, or shut down THEN checkpoint/admission/settlement writes SHALL be fenced, the aggregate tool result SHALL be appended once, and waiting/canceling/history-pending work SHALL remain visible to shutdown and cleanup accounting.

### R4: Access, experience and validation

**User Story:** As a user, I want a clear and secure mobile experience, including model selection and access to child chats.

**Acceptance Criteria:**

- R4.AC1: WHEN a model name is unfamiliar or ambiguous THEN both foreground and eligible server tool loops SHALL expose the same bounded catalog search and exact-ID resolution; ambiguity SHALL return candidates without silently picking a model.
- R4.AC2: WHEN a user taps any child activity on mobile THEN the app SHALL open or activate its workspace chat tab; desktop SHALL retain supported pane navigation. Single and batch calls SHALL both expose child links.
- R4.AC3: WHEN a client reconnects or changes account/workspace THEN visibility, notifications and actions SHALL remain scoped to the originating authorized account/workspace, stale responses SHALL be discarded, and reconnection SHALL NOT duplicate terminal notifications.
- R4.AC4: WHEN dispatching work or delivering results THEN the server SHALL revalidate current membership, canonical project ownership and tool/provider policy, preserve encrypted credential handling, and fail closed without leaking content; cancellation cleanup SHALL not require another paid operation.
- R4.AC5: WHEN qualifying this feature THEN tests SHALL prove browser-closed completion, restart recovery at safe checkpoints, unknown outcomes after uncertain dispatch, concurrency, cancellation, bounded capacity, retention, mobile navigation and authorization isolation against the actual persistent provider artifact.
- R4.AC6: WHEN upgrading or rolling back THEN unsupported checkpoint versions SHALL refuse execution; enablement SHALL require matching host/provider artifacts and a safe drain procedure for older workers, documented through the existing release workflow.
