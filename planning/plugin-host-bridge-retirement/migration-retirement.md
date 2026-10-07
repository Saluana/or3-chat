# Migration retirement preparation

Prepared separately from the Cloud 0.1.77 cutover, on `feat/remove-retired-plugin-migration`. This change must remain unmerged until the cutover is published and known installations are confirmed upgraded. No such installation confirmation has been received yet.

The change deletes the data-only table, activation call, derived legacy-secret cleanup, gate exception, and migration-only tests/fixtures. Generic scoped storage, secrets, records, grants, activation fencing and state-version rollback checks stay intact. Public docs direct any installation with 0.1.1 data through Cloud 0.1.77 and External Agents 0.2.0 before using a host where migration is retired.

Test deletion evidence:

- `trusted-host-context.test.ts` / `copies opaque bytes before deletion and safely retries or refuses mismatches`: independently protected copy/readback/delete and retry of the retiring table. The only production caller was the trusted V2 activation loader. This contract deliberately ends at the confirmed upgrade milestone; cutover proof remains in `upgrade.json` and the 0.1.77 Git history.
- `plugin-host-upgrade.spec.ts` / `upgrades saved 0.1.1 hosts and encrypted credentials without token re-entry`, plus its two exclusive fixtures: owned the installed upgrade, origin approval, PIN decrypt, authenticated request, verified deletion and reload contract. It passed on the cutover host. No remaining code performs that migration after retirement, so keeping the active test would require retaining the retired implementation. `baseline-summary.json` and `upgrade.json` retain the historical proof.
- The loader fixture removes only its retired import stubs. Logout tests still verify scoped-secret deletion, generic old-prefix deletion, startup preservation, PKCE preservation, workspace cleanup and key-generation guards. They stop seeding/asserting the retired agent-specific vault key.

The table and tests were introduced together by implementation commit `b73f2a4b`. Source searches found no additional production callers or fixture consumers. Removal risk is loss of access to legacy data on an unupgraded install; that is why installation confirmation gates merging rather than being inferred from publication or the disposable E2E.

Verification: isolated frozen install; four affected test files / 23 tests passed; fixed-profile Nuxt typecheck passed; import gate, compatibility ledger/snapshots and docs gate passed (109 files, 97 routes, 20 examples). Final diff inspected and whitespace check passed. Production removal is 56 lines; tests/support removal is 135 lines; docs/gate changes record the prerequisite and remove the exception. No replacement tests or production seams were added.
