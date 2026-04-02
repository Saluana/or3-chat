---
title: Tasks - OR3 Net remaining work
status: draft
owner: chat-platform
date: 2026-04-01
---

# Purpose

This file tracks the remaining `or3-chat` work for the OR3 Net integration after the current product slice shipped.

What is already done is intentionally not repeated here. This file is only the backlog that remains after the audit of the current integration.

Primary references:

- `planning/or3-net-plan.md`
- `../or3-net/planning/chat-v1-integration/tasks.md`
- `../or3-net/planning/production/2-or3-chat/README.md`

## 1. Freeze the chat ↔ host auth exchange contract

This is the highest-value remaining work because the current code and docs drift in annoying ways.

- [ ] 1.1 Replace stale `workspace_hint` wording with the shipped `workspace_id` request field everywhere in `or3-chat` planning/docs.
- [ ] 1.2 Add a short contract note documenting the actual request shape consumed by chat:
	- `provider`
	- `session_proof`
	- optional `workspace_id`
- [ ] 1.3 Document the actual `session_proof` emitted by `or3-chat` today:
	- provider: `or3-chat`
	- proof format: `or3-chat-assertion-v1`
	- proof fields owned by the server bridge, not the browser
- [ ] 1.4 Keep provider-specific auth details behind existing server/session abstractions and explicitly document that the browser remains provider-agnostic.
- [ ] 1.5 Update `planning/or3-net-plan.md` so the deferred contract section matches the real runtime contract instead of stale pre-ship assumptions.

## 2. Document the workspace-switch invalidation contract

The behavior exists. The contract write-up does not.

- [ ] 2.1 Document when cached OR3 Net auth state is invalidated on workspace change.
- [ ] 2.2 Document when bound OR3 Net session state is invalidated on workspace change.
- [ ] 2.3 Document which workspace-scoped UI state is torn down during a workspace switch:
	- active job stream attachment
	- selected preview pane state
	- preview/service action state
	- agent/preset editor state that should not bleed across workspaces
- [ ] 2.4 Add a short note describing the expected rebind flow after invalidation so `or3-net` can rely on chat-side cleanup semantics.

## 3. Finish error-envelope adoption in the UI layer

The transport layer already parses canonical envelope fields. The UI mostly throws those away.

- [ ] 3.1 Audit all OR3 Net page actions and identify where `Or3NetRequestError` metadata is dropped in favor of plain message strings.
- [ ] 3.2 Use canonical `code` values in user-facing states where they materially improve recovery guidance.
- [ ] 3.3 Use `retryAfterMs` for any retryable `429` handling instead of fixed or implicit retry timing.
- [ ] 3.4 Add a small helper for OR3 Net request error presentation if needed, but only if it removes duplication rather than creating more sludge.
- [ ] 3.5 Add focused tests covering at least:
	- `429` with `retry_after_ms`
	- expired preview/resource codes
	- missing scope / forbidden host responses

## 4. Add chat-side contract fixtures

`or3-net` already has fixture-backed contract tests. `or3-chat` still does not.

- [ ] 4.1 Create a fixture directory for OR3 Net consumer contracts in `or3-chat`.
- [ ] 4.2 Add exchange request fixture matching the frozen chat-owned request shape.
- [ ] 4.3 Add exchange response fixture matching the host token payload shape consumed by chat.
- [ ] 4.4 Add fixture coverage for the normalized host error envelope shapes chat depends on.
- [ ] 4.5 Keep fixture names aligned with the platform-standardization vocabulary so cross-repo comparison stays sane.

## 5. Add fixture-backed contract tests in `or3-chat`

These should validate the consumer boundary without inventing a shared runtime package.

- [ ] 5.1 Add a contract test for exchange request fixtures.
- [ ] 5.2 Add a contract test for exchange response fixtures.
- [ ] 5.3 Add a contract test for error-envelope fixtures used by the client wrapper.
- [ ] 5.4 Add a contract test for the normalized job stream event shapes chat consumes.
- [ ] 5.5 Ensure the tests validate the real consumer-facing TypeScript shapes in `app/composables/or3-net/types.ts` and related parsing logic.

## 6. Add CI coverage for the contract suite

Right now `or3-chat` barely has workflow coverage at all.

- [ ] 6.1 Add a GitHub Actions workflow that runs the OR3 Net contract tests for `or3-chat`.
- [ ] 6.2 Make sure the workflow uses Bun and the repo’s normal install/test path.
- [ ] 6.3 Keep the workflow narrow enough to be reliable instead of turning CI into a garbage fire.
- [ ] 6.4 Document the workflow briefly if the execution path is non-obvious.

## 7. Clean up stale planning/task wording

Some docs still describe pre-ship uncertainty as if it were active implementation work.

- [ ] 7.1 Update `planning/or3-net-plan.md` so the deferred section distinguishes:
	- shipped product surface
	- unfinished contract hardening
	- future config alignment work
- [ ] 7.2 Update `or3-net/planning/chat-v1-integration/tasks.md` to stop describing the remaining contract items as blockers “before UI work”.
- [ ] 7.3 Remove or rewrite any wording that implies the browser acquires provider-specific OR3 Net proof directly.
- [ ] 7.4 Keep `client_kind: 'chat'` wording consistent anywhere older docs still drift.

## 8. Deferred future work

This is real backlog, but not urgent for the current shipped slice.

- [ ] 8.1 Align any future `or3-chat` wizard/env emission with the canonical cross-repo config naming when that wizard/config work resumes.

## Recommended order

1. Freeze and document the exchange contract.
2. Document workspace-switch invalidation.
3. Finish error-envelope adoption in the page UX.
4. Add fixtures.
5. Add fixture-backed contract tests.
6. Add CI coverage.
7. Clean up stale planning wording.
8. Leave future config alignment deferred unless wizard work is actively in scope.

## Definition of done for this backlog

- The exchange contract is documented consistently and matches shipped code.
- The workspace invalidation/rebind contract is written down, not implied by tests.
- Chat consumes canonical OR3 Net error metadata all the way to user-facing states where useful.
- Chat owns fixture-backed consumer contract tests for the OR3 Net boundary.
- CI runs those contract checks.
- The remaining planning docs no longer lie.
