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

- Baseline: SQLite 8 new signup cases failed on missing methods; token framing failed on the extra-segment regression; shared rollback failed with no workspace. Convex 2 bridge cases failed on missing functions.
- SQLite store: 33/33 passed, including signup transaction rollback/replay, rejected invites, private membership, bounded retention and pagination.
- Host focused suites: 55/55 passed (session, token/cookie, rollback route, package promotion).
- Convex registered-function bridge: 23/23 passed.
- Basic Auth type-check and all three provider builds pass. Broader SQLite/Convex development type-checks reported unrelated existing background-job/document typing errors; standalone qualification and real backend/browser results follow below.

## Final qualification

- Host boundary owners: **78/78** pass for session/token handoff, shared rollback/promotion/lifecycle, all-workspace preflight, and explicit workspace settings/enablement targets.
- Marketplace consumer: **41/41** pass. Before its owner change, the canonical suite failed on omitted workspace query and the unrelated initiating workspace sent to global removal. Marketplace now explicitly requests its Chat workspace; shared rollback/uninstall omit that attribution.
- SQLite: **35/35** canonical store/migration cases and **9/9** startup cases pass. The native HTTP accept/revoke race has one winner; invalid preflight leaves the email usable for a valid registration. D1 does not advertise the five signup methods.
- Convex: **23/23** registered-function authorization cases pass. The actual disposable backend proves transaction rollback, concurrent acceptance, recipient-only membership, unchanged active selection on replay, canonical email rejection, accept/revoke conflict, pagination and bounded cleanup. [Backend receipt](evidence/convex-provider/signup.json).
- Basic Auth: **20/20** existing flow/modal owner cases pass; standalone types and its rebuilt artifact pass. The real browser proves manually pasted replacement-token handoff despite an old revoked cookie.
- Browser: the full named sign-in regression passed **15/15**, the admin-auth harness passed **3/3**, and the final changed journey run passed **8/8**, including Marketplace's explicit query. [Redacted receipts](evidence/browser.json), [instance signup page](evidence/instance-admin.png), [mobile signup completion](evidence/private-signup-mobile.png). Traces are disabled; artifacts contain no tokens or credentials.
- Full host type-check and provider standalone checks pass. Isolated **SSR build**, **static generation**, and existing production plugin-boundary checks pass. A final host type-check also covers the Marketplace compatibility change. [Build receipt](evidence/builds.json).
- `provider-host-contracts:check`, `check:docs` (112 files / 100 routes / 20 examples), and diff whitespace checks pass. All three sibling provider sources were rebuilt, and their installed local artifacts refreshed without changing package versions.

Repeat the browser evidence with:

```sh
bun run test:e2e:sign-in-gate -- --grep 'completes invite-only sign-up|instance admin controls|credential-first signup|preflight rejects|plugin workspace target' --output=planning/instance-workspace-admin/evidence/browser
bun run test:e2e:admin-auth
```

The named harness owns disposable Basic Auth, native SQLite, and filesystem storage databases. Rapid loopback contexts use the existing development-only rate-limit bypass; production rate limits remain enabled. The harness reserves separate HTTP/HTTPS ports. Browser body/path attachments are also saved explicitly so the line reporter retains reviewable files. The checked-in receipt/screenshots are compact copies of that successful output.

Convex transaction proof uses the provider's existing `scripts/test/backend-lifecycle.mjs` with the `signup` mode against a cached local-backend binary and the rebuilt template pack; no live backend or credentials are used. The normal backend upgrade guard remains intact: this source's changed digest must receive its normal distinct release before deployment. Provider release/publication, managed-image update, and live deployment are separate work and were not performed.

Broader SQLite/Convex development type configurations still contain the previously recorded background-job/document typing errors outside this change; the standalone provider contracts and complete isolated host type-check pass. The production plugin boundary continues to report its pre-existing trusted-host UI ABI as rebuild-required. No plugin lifecycle safety check was weakened to qualify this feature.

The implementation reuses the existing admin shell, registration/session resolver, canonical store registry, defaults helper, and plugin lifecycle. R9 remains deferred; no user directory, credential lifecycle/repair worker, extra plugin API version, scope registry, or initialization state machine was introduced.
