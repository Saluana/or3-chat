# Verification and failure cases

Tests are written before the implementation. Each case below guards a real boundary, using existing suites and production stores rather than test-local provisioning.

- SQLite canonical store: simultaneous accept must make one private workspace; same identity replay must preserve later active selection; a SQL trigger that refuses workspace insertion must roll back user/mapping and leave the invite usable. E2E cannot reliably schedule transaction failure.
- Persisted invitation: revoked/expired/wrong hash/wrong email must make no canonical workspace. An existing canonical email must never silently link a new identity. Bounded pagination must omit hashes; retention must delete at most 100 old rows per call.
- Token and HTTP handoff: extra segments, unknown purpose, invalid signature and expired links must not be stored. Legacy team links remain valid. Explicit signup invites on open-registration deployments must still be consumed.
- Session integration: signup results seed existing defaults exactly on creation and resolve current membership on retry. Provider credentials without canonical acceptance grant no sync/storage access.
- Browser journey: admin creates an invitation without a Chat workspace; recipient owns a different workspace with no inviter membership; sign-in can complete credential-first interrupted registration; desktop/mobile reload, legacy team invites, and actual sync/storage isolation remain covered by the named harness.
- Plugin boundary: instance inventory with no workspace must load; workspace grants/setup must not be fabricated. Restricted workspace admins cannot target other workspaces. Shared rollback/uninstall must work with zero workspaces and must retain digest/lock/preflight protection.
- Convex: trusted subject/email validation is checked at the actual registered function. Transaction conflict/rollback proof requires the existing disposable backend harness; unit mocks are not evidence of Convex transaction behavior.

No new test-only production seams are introduced. Provider source changes must be rebuilt before host browser verification.

## Results

Pending.
