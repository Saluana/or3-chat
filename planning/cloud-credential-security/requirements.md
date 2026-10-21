# Requirements

## Introduction
Authenticated Cloud must keep OpenRouter credentials in the existing server secret provider and expose only connection metadata to browsers. Reuse OR3 authentication, billing configuration, plugin grants, and the separately protected vault. Preserve local/static BYOK.

## Context
Inspected fetched default branches: Chat `or3-cloud` at c302859545cff5fa5794825adbe77b6dbac6ce8f and Secrets `main` at 5be25045eea086593ac539a0cd7e6963bd150a97. Chat already pins @or3/secrets 0.1.1 and registers its optional Nuxt provider. User keys hydrate from owner-tagged Dexie; OAuth exchanges in the browser. Chat, memory, workflow services and isolated plugin AI select credentials independently; isolated AI currently always selects the instance key. Trusted ai.provider returns a raw key; trusted ai.complete is unsupported. The vault has revisioned encrypted storage, tombstones, scoped expiring tokens, Unix transport and no replication. Existing Cloud backups cover only application data/configuration/assets, not vault custody.

## Assumptions
- Supported automatic provisioning is one managed Linux Docker Compose host. Other stateful hosts configure the existing provider explicitly; stateless/multi-host use requires a suitable replacement provider or server-managed-only operation.
- Internal SessionContext.user.id is canonical account identity. User OpenRouter scope spans authorized workspaces; workspace authorization remains mandatory at each use.
- This work authorizes synthetic local qualification and PRs, not package publication, production initialization, credential import or deployment.

## Out of Scope
Vault replication, generic API proxies, unrelated credential migrations, new grant systems, publishing and production acceptance. Trusted-host code remains privileged.

## Requirements

### R1: Vault custody and lifecycle
**User Story:** As an administrator, I want default private custody on supported Cloud installations.
**Acceptance Criteria:**
- R1.AC1: WHEN managed Cloud starts THEN it SHALL initialize an empty vault once, supervise it separately and give the app only socket access and scoped expiring service authority.
- R1.AC2: IF existing custody is incomplete, disabled or unavailable THEN credential operations SHALL fail closed without reinitializing or using browser storage.
- R1.AC3: WHEN upgrading, restarting or backing up THEN existing vault identity/data/key SHALL be preserved; recovery SHALL use the vault's fresh-key tooling and retain the source.

### R2: Account credentials and billing
**User Story:** As a user, I want one connection across devices and authorized workspaces.
**Acceptance Criteria:**
- R2.AC1: WHEN saving, exchanging OAuth, replacing or deleting THEN authenticated same-origin operations SHALL persist account-scoped credentials and return no key.
- R2.AC2: WHEN any OpenRouter operation runs THEN one resolver SHALL enforce BYOK-required, server-managed and user-override precedence; BYOK absence SHALL never spend the instance key.
- R2.AC3: WHEN forwarding credentials THEN destinations SHALL be server configured and redirects SHALL be refused.

### R3: Browser migration
**User Story:** As an existing Cloud user, I want migration without credential loss or account confusion.
**Acceptance Criteria:**
- R3.AC1: WHEN an owner-tagged legacy key matches the current account THEN the UI SHALL offer one-time import; successful persistence SHALL precede deletion.
- R3.AC2: IF import fails or ownership is unknown THEN existing storage SHALL be retained and SHALL NOT be used for Cloud inference.
- R3.AC3: WHEN another device observes an existing server record or deletion tombstone THEN it SHALL discard that account's stale copies and prevent rehydration.
- R3.AC4: WHILE running static/local deployments SHALL retain browser BYOK; Cloud credentials SHALL be excluded from exports/sync/session payloads.

### R4: Plugin mediation
**User Story:** As a plugin developer, I want existing AI and private-secret APIs with enforced policy.
**Acceptance Criteria:**
- R4.AC1: WHEN trusted or isolated plugins complete inference THEN existing grants, activation validity, budgets, deadlines and ownership SHALL apply with the central credential policy.
- R4.AC2: WHEN a Cloud plugin requests ai.provider THEN raw-key access SHALL be refused explicitly; ai.complete SHALL remain usable without credentials.
- R4.AC3: WHEN accessing plugin secrets THEN other users/workspaces/plugins and the reserved platform consumer SHALL be inaccessible.

### R5: Evidence
**User Story:** As a maintainer, I want reviewable proof and explicit limits.
**Acceptance Criteria:**
- R5.AC1: WHEN delivered THEN relevant tests, types/builds, real-vault lifecycle evidence, focused browser evidence and final security review SHALL be recorded with actual outcomes.
- R5.AC2: IF target-host isolation, power-loss, runtime advisory or independent-review gates remain unperformed THEN documentation SHALL distinguish these from code correctness and SHALL NOT claim production qualification.
