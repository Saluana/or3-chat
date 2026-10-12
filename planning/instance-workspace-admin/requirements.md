# Requirements

## Introduction

Separate instance administration from workspace administration, and add signup invites that give a new user their own private workspace. Implement this through the existing admin pages, auth flow, and provider stores. This revision replaces the larger first draft with the smallest complete scope; it is a plan, not an implementation report.

## Context

OR3 uses Nuxt, Vue, Nuxt UI, TypeScript, Bun, and provider registries. The Plugins page currently requires a workspace before loading both instance and workspace controls. Existing invitation tokens always name a destination workspace. Canonical users/workspaces live in the selected sync backend; Basic Auth already creates credentials separately and core session resolution decides whether that identity receives OR3 access. SQLite and Convex implement the canonical store in sibling provider packages; this checkout consumes their built artifacts. Existing invite handoff, plugin lifecycle, workspace provisioning, authorization, and test harnesses provide the necessary foundations.

## Assumptions

- Signup invitations are email-bound, single-use links with a 72-hour default and 30-day maximum lifetime. Reuse the existing full-token/link delivery pattern; no automated email or reusable public codes.
- A private workspace starts with the recipient as its only member and owner. The inviter receives no membership. Existing host-operator privileges are unchanged.
- Keep `/admin/plugins` and its existing API. Make its workspace input optional for instance controls and show workspace controls in an explicitly selected Workspace tab. No new admin routing framework is needed.
- Keep the existing separation between provider authentication and OR3 authorization. A credential account can exist before canonical signup completes; it receives no OR3 workspace/data access until canonical admission succeeds.
- Preserve requirement IDs from the initial draft. R9 is explicitly deferred rather than renumbering the remaining requirements.
- Support native SQLite and Convex through the same host contract. Unsupported driver/provider versions fail explicitly; support is not simulated with sequential writes.

## Out of Scope

- A new user directory, account suspension, password reset, or identity linking.
- A new pending-account state machine, credential activation protocol, signup repair console, or background reconciliation worker.
- A new admin-scope registry, replacement plugin lifecycle engine, duplicate plugin-page APIs, or a broad page-route migration.
- A separate admin-host invitation configuration feature; retain the existing deployment link-origin behavior and full-token fallback.
- Changing sync/Dexie schemas, copying workspace data, changing administrator authority, or deploying/publishing during planning.

## Requirements

### R1: Clear admin scopes

**User Story:** As an administrator, I want to see which controls apply to the instance and which apply to a workspace.

**Acceptance Criteria:**
- R1.AC1: WHEN a super admin opens instance controls with no selected workspace or Chat session THEN those controls SHALL load without requesting a workspace.
- R1.AC2: WHEN workspace controls open THEN the selected workspace SHALL be explicit in the URL and displayed beside the controls; switching targets SHALL update that URL.
- R1.AC3: WHEN existing admin/plugin/rollout links are opened THEN they SHALL retain their destination and identifiers; existing admin extensions SHALL remain compatible.

### R2: Preserve server authorization

**User Story:** As an operator, I want the server to enforce scope regardless of the selected UI tab.

**Acceptance Criteria:**
- R2.AC1: WHEN an instance mutation executes THEN it SHALL use the existing super-admin, host, origin, intent, rate-limit, and no-store patterns.
- R2.AC2: WHEN a workspace mutation executes THEN its explicit target SHALL pass existing admin-context and `can()`/`requireCan()` checks; a Chat workspace change SHALL NOT retarget it.
- R2.AC3: WHEN a super admin creates a signup invite without a Chat session THEN attribution SHALL use that admin principal without borrowing a workspace owner or creating a canonical user.

### R3: Remove unnecessary plugin workspace requirements

**User Story:** As an operator, I want instance plugin administration to work without selecting an unrelated workspace.

**Acceptance Criteria:**
- R3.AC1: WHEN the Instance tab opens THEN catalog approval, installed packages, future-workspace defaults, and existing rollout entry points SHALL work without a selected workspace.
- R3.AC2: WHEN setup, permissions, enablement, or canary testing requires a workspace THEN the operation SHALL ask for that target explicitly and retain existing checks.
- R3.AC3: WHEN a shared package is rolled back or uninstalled THEN the action SHALL identify its instance-wide effect, derive affected workspaces server-side, and retain existing lifecycle/preflight/digest protections without an arbitrary initiating workspace.

### R4: Keep workspace controls scoped

**User Story:** As an administrator, I want workspace membership and plugin settings to affect only the named workspace.

**Acceptance Criteria:**
- R4.AC1: WHEN a workspace is managed THEN members, roles, team invites, and shared-resource guest access SHALL remain on its existing detail page, with a link to its workspace plugin controls.
- R4.AC2: WHEN plugin grants, setup, credentials, activation, or data deletion are changed THEN only the explicitly authorized workspace SHALL be targeted; late reads SHALL NOT display another workspace's state.
- R4.AC3: WHEN a member is removed THEN the UI SHALL describe removal from that workspace, without implying account suspension.

### R5: Simple signup-invite administration

**User Story:** As an operator, I want to invite someone to use OR3 with their own workspace.

**Acceptance Criteria:**
- R5.AC1: WHEN opening Signup invites THEN the form SHALL require email and expiry, with no workspace or role input, and explain that the recipient becomes the owner of a new private workspace.
- R5.AC2: WHEN creation succeeds THEN the link/full token SHALL be available to copy once; clipboard errors SHALL offer manual copy and the UI SHALL NOT claim an email was sent.
- R5.AC3: WHEN listing invitations THEN results SHALL be bounded to at most 100 per page, show lifecycle status, and omit tokens/hashes. Pending invitations SHALL be revocable; already accepted invitations SHALL NOT become account-revocation controls.
- R5.AC4: WHEN create loses its response THEN refresh and revoke/create SHALL recover the admin workflow without claiming the original token can be retrieved.

### R6: Atomic private workspace admission

**User Story:** As an invited user, I want one private workspace even if registration is retried.

**Acceptance Criteria:**
- R6.AC1: WHEN a signup invite is accepted THEN one canonical transaction SHALL create the user, provider mapping, new workspace, sole owner membership, active-workspace pointer, and consumed-invite result.
- R6.AC2: WHEN acceptance is retried or races with another request THEN the same authenticated identity SHALL resolve to the same committed result; a different identity SHALL be denied and a competing revoke SHALL have only one winning outcome.
- R6.AC3: IF canonical provisioning fails before commit THEN none of those writes SHALL remain. An existing canonical user SHALL NOT acquire an extra workspace or have their active workspace reset through a signup invite.
- R6.AC4: WHEN signup succeeds and reloads THEN the session SHALL retain the private workspace/owner role and select its existing workspace-scoped Dexie DB. No inviter membership, data, keys, or credentials SHALL be copied.
- R6.AC5: WHEN a new workspace is created THEN the existing default-provisioning helper SHALL be invoked; its failure SHALL NOT undo signup or bypass plugin prerequisites. Use current repair behavior rather than adding an exactly-once initialization protocol.

### R7: Reuse provider login and retry

**User Story:** As an invited user, I want interrupted registration to be recoverable through ordinary sign-in.

**Acceptance Criteria:**
- R7.AC1: WHEN Basic Auth receives a signup request THEN invalid invitations SHALL be rejected before credential creation, and canonical invite state SHALL be checked again at acceptance. Provider cookies alone SHALL NOT grant OR3 workspace/data access.
- R7.AC2: IF credentials were created but canonical admission did not finish THEN signing in with the same credentials and reopening a valid invite SHALL retry with the same provider identity; an expired/revoked invite SHALL require a replacement. No cross-database compensating deletion SHALL occur.
- R7.AC3: WHEN Clerk authenticates THEN the existing verified subject/email and secure invite handoff SHALL drive the same canonical acceptance. Existing-user login after a committed signup SHALL not need the invite again.

### R8: Preserve existing invites and registration policy

**User Story:** As an operator, I want old workspace links and registration settings to retain their meaning.

**Acceptance Criteria:**
- R8.AC1: WHEN a token is verified THEN a signed purpose SHALL distinguish new signup invites; legacy tokens SHALL remain workspace invitations. Malformed, tampered, wrong-email, expired, revoked, or wrong-purpose tokens SHALL grant no new access.
- R8.AC2: WHEN registration mode is `disabled` THEN new signup admission SHALL be denied; `invite_only` SHALL require a valid invite; `open` SHALL preserve ordinary registration and consume explicitly presented signup invites through their own flow. Existing-user and bootstrap login SHALL remain supported.
- R8.AC3: WHEN the link is handed to an auth provider THEN existing cookie/body handling SHALL be reused, raw tokens SHALL stay out of preferences/logs/evidence, and invalid links SHALL NOT replace a valid invite cookie.

### R9: Instance user directory — deferred

**Status:** Deferred by the simplicity revision. A general user directory was extra scope in the first draft. Keep the existing Administrators page and make it directly discoverable; no new user-list store/API is required by this implementation.

### R10: Minimal provider persistence

**User Story:** As an operator, I want signup invites stored with canonical users and workspaces without changing old invite records.

**Acceptance Criteria:**
- R10.AC1: WHEN adding signup invites THEN providers SHALL add one canonical signup-invite table and optional methods on the existing `AuthWorkspaceStore`; old workspace invite contracts SHALL remain compatible.
- R10.AC2: IF the provider/driver lacks atomic signup support THEN the new feature SHALL fail explicitly; native SQLite and Convex implementations SHALL pass actual backend transaction checks before being described as supported.
- R10.AC3: WHEN terminal signup-invite records exceed 90 days THEN bounded cleanup of at most 100 records per maintenance call SHALL make them eligible for removal; replay SHALL never recreate access after later user/workspace removal.

### R11: Reuse existing architecture

**User Story:** As a maintainer, I want this implemented with the current stack and clear, small changes.

**Acceptance Criteria:**
- R11.AC1: WHEN static/local builds run THEN existing SSR boundaries SHALL continue excluding server auth/provider modules from clients.
- R11.AC2: WHEN instance plugin controls load THEN the API SHALL skip workspace grant/setup queries unless a target was explicitly requested; lists and cleanup SHALL remain bounded.
- R11.AC3: WHEN implementing the feature THEN existing Nuxt UI variants, provider registries, session refresh, typed hooks, and plugin/provisioning services SHALL remain the integration points.

### R12: Focused verification and documentation

**User Story:** As a maintainer, I want repeatable proof for the behavior being changed.

**Acceptance Criteria:**
- R12.AC1: BEFORE changing production behavior THEN failure cases and primary test owners SHALL be recorded and necessary isolated tests written; existing suites SHALL be extended rather than duplicated.
- R12.AC2: WHEN qualifying the feature THEN named disposable harnesses SHALL prove no-workspace admin use, private signup on desktop/mobile, ordinary-user isolation, interrupted retry, reload, and legacy invite compatibility, with redacted repeatable evidence.
- R12.AC3: WHEN completing the work THEN provider artifacts, focused backend tests, type/static/SSR checks, affected docs/docmap, and task status SHALL reflect what was actually verified. Missing provider proof SHALL remain explicit.
