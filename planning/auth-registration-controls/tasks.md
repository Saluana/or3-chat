# tasks.md

artifact_id: 4a20025f-ece2-496b-b5fc-11f3f0f8b6d9

## 1. Preflight and Scope Lock

- [ ] Confirm existing registration behavior baseline (`OR3_AUTH_AUTO_PROVISION`, unknown user 403 path)
  - Requirements: 1.2, 2.2
- [ ] Confirm current provider capabilities and gaps (basic-auth missing register endpoint/UI)
  - Requirements: 4.1
- [ ] Capture baseline test snapshots for auth/session/admin flows
  - Requirements: 8.1, 8.2

## 2. Add Registration Policy Configuration

- [ ] Add `auth.registrationMode` to cloud config types and env parser
  - Requirements: 1.1, 1.2
- [ ] Implement precedence rules (`registrationMode` over legacy `autoProvision`)
  - Requirements: 1.2
- [ ] Add strict/non-strict validation messaging for invalid mode values
  - Requirements: 1.2, 7.1
- [ ] Add config reference docs for new env/settings
  - Requirements: 9.1

## 3. Implement Core Registration Gate in Session Resolution

- [ ] Refactor unknown-user branch in `resolveSessionContext()` to use policy evaluator
  - Requirements: 2.1, 2.2
- [ ] Introduce deterministic registration denial errors (`invite_required`, `disabled`, etc.)
  - Requirements: 2.2, 7.1
- [ ] Preserve existing-user sign-in behavior across all modes
  - Requirements: 2.2
- [ ] Keep shared session cache and provisioning failure modes behavior unchanged for successful logins
  - Requirements: 2.2

## 4. Extend Store Contracts for Invites

- [ ] Extend `AuthWorkspaceStore` with invite lifecycle methods (`createInvite`, `listInvites`, `revokeInvite`, `consumeInvite`)
  - Requirements: 6.1, 6.2
- [ ] Add provider capability checks at boot/runtime for invite-only mode
  - Requirements: 5.2, 6.2
- [ ] Add typed invite entities and shared DTOs in core server types
  - Requirements: 6.1

## 5. Provider Backend Implementations (Canonical Store)

### 5.1 SQLite provider

- [ ] Add migration for `auth_invites` table and indexes
  - Requirements: 6.1
- [ ] Implement invite CRUD/consume methods in sqlite auth workspace store
  - Requirements: 3.1, 6.1
- [ ] Add invite expiry cleanup utility
  - Requirements: 3.3

### 5.2 Convex provider

- [ ] Add `auth_invites` schema and indexes in convex backend
  - Requirements: 6.1
- [ ] Implement invite lifecycle functions and adapter bindings
  - Requirements: 3.1, 6.1
- [ ] Add compatibility coverage for existing admin/sync store behavior
  - Requirements: 2.2, 6.2

## 6. Invite Token Service

- [ ] Implement token sign/verify/hash helper with dedicated secret + TTL
  - Requirements: 3.2, 3.3
- [ ] Ensure one-time token consumption semantics with atomic backend update
  - Requirements: 3.2
- [ ] Add safe logging/redaction for invite events
  - Requirements: 3.3, 7.1

## 7. Admin API for Invite Management

- [ ] Create `POST /api/admin/workspace/invites/create`
  - Requirements: 3.1, 5.1
- [ ] Create `GET /api/admin/workspace/invites/list`
  - Requirements: 3.1, 5.1
- [ ] Create `POST /api/admin/workspace/invites/revoke`
  - Requirements: 3.1, 5.1
- [ ] Enforce owner/admin guards, no-store headers, same-origin checks, and rate limits
  - Requirements: 7.2
- [ ] Add endpoint tests for validation, authz, and error mapping
  - Requirements: 8.1, 8.2

## 8. Basic Auth Provider Registration Feature

- [ ] Add `POST /api/basic-auth/register` endpoint with policy + invite checks
  - Requirements: 4.1, 4.2
- [ ] Implement duplicate email handling and safe response mapping
  - Requirements: 4.2, 7.1
- [ ] Add `BasicAuthRegisterModal.client.vue` and wire into existing auth button/modal UX
  - Requirements: 4.1
- [ ] Dispatch session refresh event after successful registration
  - Requirements: 4.1
- [ ] Add endpoint and component tests for register flows
  - Requirements: 8.1, 8.2

## 9. Provider-Agnostic Behavior Validation

- [ ] Validate first-login onboarding with Clerk in `open` mode
  - Requirements: 2.1
- [ ] Validate first-login denial with Clerk in `invite_only` mode without invite
  - Requirements: 1.1, 2.1
- [ ] Validate first-login allow with Clerk in `invite_only` mode with invite
  - Requirements: 2.1, 3.2
- [ ] Ensure custom provider path remains contract-compatible (no provider hardcoding)
  - Requirements: 2.1, 6.2

## 10. Admin UI Additions

- [ ] Add invite management panel under admin workspace page
  - Requirements: 5.1
- [ ] Add registration policy status and capability indicators
  - Requirements: 5.1, 5.2
- [ ] Add revoke/create interactions and optimistic refresh handling
  - Requirements: 5.1
- [ ] Add UI tests for invite panel states and actions
  - Requirements: 8.1

## 11. Error Handling and Observability

- [ ] Standardize registration/invite error codes and user-safe messages
  - Requirements: 7.1
- [ ] Add telemetry hooks/log lines for invite issued/accepted/revoked/expired
  - Requirements: 3.3
- [ ] Verify no secret/token leakage in logs and API payloads
  - Requirements: 7.1

## 12. Documentation and Migration Notes

- [ ] Update cloud config docs (`registrationMode`, legacy fallback behavior)
  - Requirements: 9.1
- [ ] Update provider docs (`provider-basic-auth`, `provider-clerk`) for mode behavior
  - Requirements: 9.1
- [ ] Add admin invite workflow docs (create/revoke/accept)
  - Requirements: 9.1
- [ ] Add migration notes from `OR3_AUTH_AUTO_PROVISION` to `OR3_AUTH_REGISTRATION_MODE`
  - Requirements: 1.2, 9.1
- [ ] Update docmap entries for any new/changed docs
  - Requirements: 9.1

## 13. Verification Matrix and Release Readiness

- [ ] Unit: policy evaluator + invite token + invite store + basic-auth register
  - Requirements: 8.1
- [ ] Integration: session resolution by mode, admin invite APIs, provider onboarding
  - Requirements: 8.2
- [ ] E2E: open registration, invite-only registration, existing-user unaffected
  - Requirements: 8.2
- [ ] Regression: auth/session/workspace/sync/storage smoke for default SSR stacks
  - Requirements: 2.2, 8.2
- [ ] Final rollout checklist and rollback notes
  - Requirements: 9.1
