# Requirements

## Introduction

Fix restored OpenClaw agent sessions appearing under Today with the time the Gateway reconnected instead of their real historical activity time. The change belongs in the `@or3/openclaw` Sessions/Runs bridge; the OR3 sidebar should continue rendering the timestamp it receives.

## Context

OR3 Chat is a Nuxt application using a shared external-agent controller and an ESM OpenClaw plugin. The plugin keeps session records in memory, while OR3 persists lightweight session references. On restart, `GET /api/sessions/:id` currently calls `ensureSession()`, assigning `createdAt` and `updatedAt` from `Date.now()`. The controller accepts and persists that synthetic timestamp. The package uses Node's built-in test runner and already has bridge tests in `packages/openclaw-or3/test/bridge.test.js`.

## Assumptions

- OpenClaw's `sessions.list` Gateway RPC is the authority for persisted session metadata.
- The displayed session time should represent meaningful session activity, preferring `lastActivityAt` and falling back to `updatedAt`.
- OR3's saved reference remains the safest fallback when OpenClaw cannot resolve a historical session.

## Out of Scope

- Sidebar formatting or date-group changes.
- Persistence schema changes or migration of timestamps already overwritten in existing OR3 data.
- General session discovery across a new browser/device, release work, or OpenClaw upgrades.

## Requirements

### R1: Authoritative restoration

**User Story:** As an OR3 user, I want restored OpenClaw sessions to retain their real activity dates, so that old sessions do not appear as newly active.

**Acceptance Criteria:**
- R1.AC1: WHEN a saved session is restored after the bridge memory has been cleared THEN the bridge SHALL resolve its deterministic OpenClaw session key through `sessions.list`.
- R1.AC2: WHEN native metadata exists THEN the bridge SHALL use `lastActivityAt`, falling back to `updatedAt`, rather than the current time.
- R1.AC3: IF no native session row exists THEN the read endpoint SHALL return a not-found error and SHALL NOT create an in-memory session stamped with the current time.

### R2: Safe timestamp normalization

**User Story:** As a maintainer, I want timestamp formats normalized at the bridge boundary, so that seconds, milliseconds, and ISO strings retain the same instant.

**Acceptance Criteria:**
- R2.AC1: WHEN a valid timestamp is supplied as epoch seconds, epoch milliseconds, or an ISO string THEN the bridge SHALL preserve its represented instant.
- R2.AC2: IF a historical message omits a timestamp THEN normalization SHALL use the resolved session activity timestamp and SHALL NOT default to the current time.

### R3: Preserve current behavior

**User Story:** As an OR3 user, I want new and active agent sessions to keep updating normally after historical restoration is fixed.

**Acceptance Criteria:**
- R3.AC1: WHEN a new session or run is created THEN its bridge timestamp SHALL reflect the creation or run activity time.
- R3.AC2: WHEN a run emits an event THEN the session's activity timestamp SHALL continue advancing.
- R3.AC3: WHEN the fix is complete THEN it SHALL require no sidebar, controller, persistence-schema, or dependency changes.
