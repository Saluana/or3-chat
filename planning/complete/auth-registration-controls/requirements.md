# requirements.md

artifact_id: 6a4b6d63-26e8-473a-92ff-e213ad444c78

## Overview

Add a provider-agnostic registration control system for OR3 SSR auth so operators can:

1. Enable/disable self-service registrations.
2. Run invite-only registration.
3. Let users register across any enabled auth provider.
4. Keep admin invite workflows available when public sign-up is not open.

This work must preserve current auth/session invariants:

- `can()` remains the only authorization gate on SSR routes.
- Canonical users/workspaces remain in the selected `AuthWorkspaceStore` backend.
- Static builds remain unchanged.

## Roles

- End User: signs up/signs in to access a workspace.
- Workspace Owner/Admin: invites users and manages invite lifecycle.
- Instance Operator: configures registration policy.
- Provider Maintainer: implements optional provider-specific registration UX without breaking shared contracts.

## Requirements

### 1. Registration Policy Model

1.1 As an Instance Operator, I want explicit registration policy modes, so that account onboarding behavior is predictable.

- The system SHALL support `open`, `invite_only`, and `disabled` registration modes.
- WHEN mode is `open` THEN unknown users SHALL be allowed to provision through any enabled auth provider.
- WHEN mode is `invite_only` THEN unknown users SHALL be rejected unless a valid invite is present.
- WHEN mode is `disabled` THEN unknown users SHALL be rejected regardless of invite token.

1.2 As an Instance Operator, I want backward compatibility with existing config, so that upgrades are safe.

- Existing `OR3_AUTH_AUTO_PROVISION` behavior SHALL remain supported.
- WHEN new registration mode env/config is unset THEN legacy behavior SHALL be preserved.
- Misconfiguration SHALL produce actionable strict-mode errors and safe non-strict warnings.

### 2. Provider-Agnostic New User Provisioning

2.1 As an End User, I want registration to work with any enabled auth provider, so that onboarding is not provider-specific.

- WHEN provider session resolves and user mapping does not exist THEN registration policy SHALL be enforced before `getOrCreateUser`.
- Providers SHALL not need hardcoded logic in core `resolveSessionContext()` beyond shared registration gate checks.
- Provider session identity fields (`provider`, `providerUserId`, `email`) SHALL be used consistently for registration checks.

2.2 As a Systems Engineer, I want no auth regressions, so that existing sign-in flows remain stable.

- Existing users SHALL always be able to sign in regardless of registration mode.
- Unknown users denied by policy SHALL receive a deterministic 403 response shape.
- Session caching/invalidation semantics SHALL remain unchanged for authenticated users.

### 3. Invite-Only Onboarding

3.1 As a Workspace Owner/Admin, I want to invite users when public registration is closed, so that access remains controlled.

- Admin APIs SHALL support create/list/revoke invites with expiration and audit metadata.
- Invites SHALL target normalized email and desired workspace role.
- Invite create/revoke/list SHALL require admin auth and existing admin guards.

3.2 As an Invited User, I want to join securely, so that invite links cannot be abused.

- Invite tokens SHALL be signed, short-lived, and one-time use.
- Invite acceptance SHALL bind to invite email and provider identity at first successful registration.
- Replayed/expired/revoked invites SHALL be rejected with safe errors.

3.3 As a Security Reviewer, I want invite flows to be auditable and bounded, so that abuse is detectable.

- Invite lifecycle events SHALL be logged with redaction-safe metadata.
- Invite tables SHALL include status (`pending`, `accepted`, `revoked`, `expired`) and timestamps.
- Cleanup/GC for expired invites SHALL be defined.

### 4. Basic Auth Registration UX and API

4.1 As a Basic Auth user, I want first-class registration UI, so that I can create an account without bootstrap-only setup.

- `or3-provider-basic-auth` SHALL expose registration UI alongside sign-in.
- Provider SHALL add a registration endpoint (`/api/basic-auth/register`) with validation and policy checks.
- Registration SHALL create account credentials, issue session cookies, and trigger session refresh signaling.

4.2 As a Security Reviewer, I want secure password registration, so that credential storage is safe.

- Password policy validation SHALL be enforced on registration.
- Duplicate email registration SHALL be rejected safely without leaking internals.
- Password hashing and cookie hardening SHALL follow existing provider security patterns.

### 5. Admin Operations and UI

5.1 As an Admin, I want invite management surfaced in admin tools, so that invite-only mode is usable operationally.

- Admin UI SHALL support creating invites by email + role + expiry.
- Admin UI SHALL display invite status and allow revoke.
- Admin UI SHALL show registration policy mode and effective onboarding behavior.

5.2 As an Operator, I want provider capability visibility, so that unsupported invite flows are clear.

- Admin/system status SHALL expose whether active stack supports invites and self-service registration.
- Unsupported operations SHALL fail with clear capability errors, not silent no-ops.

### 6. Data Model and Provider Store Contracts

6.1 As a Maintainer, I want canonical invite data in the selected backend, so that behavior is consistent across providers.

- Invite metadata SHALL live in the selected `AuthWorkspaceStore` backend (Convex/SQLite).
- Wire field naming for sync-facing payloads SHALL remain snake_case where applicable.
- Store contract extensions SHALL remain provider-agnostic and type-safe.

6.2 As a Maintainer, I want minimal contract drift, so that provider updates remain predictable.

- New store methods for invite lifecycle SHALL be introduced with clear optional/required semantics.
- Existing provider packages SHALL fail fast in strict mode if required invite capabilities are missing for configured policy.

### 7. Error Handling and Security

7.1 As a Security Reviewer, I want safe errors, so that auth internals are not exposed.

- Registration/invite failures SHALL return bounded error codes/messages.
- Responses SHALL not reveal secret material or sensitive account existence details beyond acceptable UX constraints.

7.2 As a Systems Engineer, I want invariant-preserving authorization, so that policy changes do not bypass permissions.

- Invite/admin endpoints SHALL continue to use admin auth guards and `can()`-aligned permission checks.
- No new SSR endpoint SHALL bypass existing same-origin/rate-limit/no-store protections.

### 8. Testing and Verification

8.1 As a Maintainer, I want policy matrix coverage, so that onboarding behavior is correct.

- Unit tests SHALL cover `open` vs `invite_only` vs `disabled` for unknown/existing users.
- Unit tests SHALL cover invite token validation, expiry, revocation, and one-time use.
- Unit tests SHALL cover basic-auth registration endpoint validation and password policy.

8.2 As a Maintainer, I want integration/e2e coverage, so that real provider flows are validated.

- Integration tests SHALL verify first-login provisioning behavior for basic-auth and clerk providers.
- Integration tests SHALL verify admin invite create/revoke/list and acceptance path.
- E2E SHALL verify invite-only onboarding across at least one direct auth provider and one gateway-backed stack.

### 9. Documentation

9.1 As an Operator, I want clear docs for registration controls, so that rollout is low risk.

- Cloud config docs SHALL include registration mode/env references and migration notes from `OR3_AUTH_AUTO_PROVISION`.
- Provider docs (`basic-auth`, `clerk`) SHALL document how registration behaves under each policy mode.
- Admin docs SHALL document invite workflow and operational checks.
