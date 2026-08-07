# Tasks

## Implementation status

The repository implementation is complete through the package, operator CLI,
deployment assets, release workflows, documentation, and focused local checks.
The remaining unchecked tasks require external registry/account authority or a
successful remote Docker/CI run; they are deliberately not marked complete by
local edits.

Current release blocker: `@or3/cloud@0.1.12` and
`ghcr.io/saluana/or3-chat:0.1.12` are not published yet, and the local Docker
daemon cannot resolve the Dockerfile frontend before the build starts. No
registry publication or destructive VPS action was attempted.

## 1. Release and package foundation

- [ ] 1.1 Reserve the public package and verify artifact access
      Requirements: R2.AC1, R2.AC5, R6.AC1
      Done when: `@or3/cloud` is available to the OR3 npm organization with GitHub trusted-publisher settings documented, `ghcr.io/saluana/or3-chat` is confirmed publicly pullable from a clean environment, and the release-tag/version convention is recorded in the release runbook.

- [x] 1.2 Add the `packages/or3-cloud` package skeleton and its single `or3` executable
      Requirements: R1.AC1, R4.AC5, R6.AC1
      Done when: the package has a compiled `npx @or3/cloud --help` entrypoint, ships only CLI code and static deployment assets, has no OR3 source template or `node_modules` in its packed file list, and its package tests run under Bun.

- [x] 1.3 Add a release-version contract shared by the root application, Cloud package, and image tag
      Requirements: R2.AC1, R2.AC3, R6.AC3
      Done when: a release check rejects mismatched application/package versions, accepts only complete unused semantic versions, and the release metadata can supply the image reference for the current CLI version.

- [x] 1.4 Refactor the container workflow to build the fixed cloud image from repository root
      Requirements: R2.AC1, R2.AC2, R2.AC4, R6.AC2
      Done when: the workflow builds from root using registry-clean dependency preparation, passes the fixed Basic Auth/SQLite/filesystem build arguments, publishes an exact version tag and digest, and fails when login, persistence, file storage, or deep health smoke fails.

- [ ] 1.5 Sequence image publication before Cloud package publication in one release workflow
      Requirements: R2.AC1, R2.AC4, R2.AC5
      Done when: a tagged release refuses npm publish unless the exact image has been pushed and qualified; the packed CLI is smoke-tested against that image; and post-publish verification retries exact npm lookup and `npx` with online cache revalidation.

## 2. Managed deployment initialization

- [x] 2.1 Implement typed managed-state, pending-operation, and atomic owner-only file helpers
      Requirements: R2.AC3, R3.AC6, R4.AC5
      Done when: tests cover valid/invalid state parsing, atomic write failure, restrictive permissions, pending-operation persistence, and redaction of all known secret values.

- [x] 2.2 Add static base/public Compose and Caddy deployment assets plus a constrained environment renderer
      Requirements: R1.AC1, R1.AC2, R1.AC3, R6.AC2
      Done when: local rendering creates loopback-only OR3 plus the named `/data` volume, public rendering adds only Caddy and public ports, and rendered `.env` contains the default profile's required runtime keys but no application build configuration.

- [x] 2.3 Implement Docker/Compose command execution, image digest resolution, and deep-health probing
      Requirements: R1.AC5, R2.AC3, R4.AC4
      Done when: command failures return typed redacted results, a successful pull resolves a `sha256:` digest, Compose wait is followed by the existing deep health contract, and test fakes cover timeout and non-OK health responses.

- [x] 2.4 Implement `init --local` and supported credential bootstrap
      Requirements: R1.AC1, R1.AC3, R1.AC4, R1.AC5, R4.AC5
      Done when: a clean target produces a no-source local deployment, accepts an administrator email/password file or generated private credentials, refuses unsafe targets, starts the exact image, and commits state only after deep health passes.

- [x] 2.5 Implement `init --public --domain` preflight and Caddy deployment
      Requirements: R1.AC2, R1.AC4, R1.AC5, R4.AC2, R4.AC3
      Done when: hostname/DNS/public-port checks run before start, the CLI never changes firewall/DNS/Cloudflare settings, Caddy uses the existing reverse-proxy contract, and errors provide the one copyable diagnostics command.

## 3. Backup, update, recovery, and diagnostics

- [x] 3.1 Implement stopped-volume backup creation and validation
      Requirements: R3.AC1, R3.AC4, R4.AC5
      Done when: the command stops only OR3, archives `/data` and deployment config into a unique owner-only backup directory, verifies archive listing plus SHA-256, records version/digest metadata, and restarts the prior healthy service when archiving fails.

- [x] 3.2 Implement `update` with exact-version resolution and automatic failed-health rollback
      Requirements: R2.AC3, R3.AC1, R3.AC2, R3.AC3, R3.AC6
      Done when: update rejects tags/ranges, creates a rollback point, pulls the target image, updates state only after deep health, and restores both prior image and data when replacement startup fails.

- [x] 3.3 Implement confirmed `restore` and immediate-point `rollback`
      Requirements: R3.AC4, R3.AC5, R3.AC6
      Done when: both commands require `--yes` before replacing `/data`, preserve pending-operation state across interruption, complete only after deep health, and make the data-loss boundary explicit in output.

- [x] 3.4 Implement read-only `doctor`
      Requirements: R4.AC1, R4.AC2, R4.AC3, R4.AC4, R3.AC6
      Done when: doctor checks Docker/Compose, file modes, state/image digest, rendered Compose config, deep health, port-3000 loopback exposure, and public Caddy/domain status; it reports nftables/UFW hints without modifying either.

## 4. Existing deployment transition

- [x] 4.1 Implement V1 inspection and supported-profile detection
      Requirements: R5.AC1, R5.AC2
      Done when: `adopt --from` reads release metadata, provider module list, `.env`, Compose configuration, and resolved volume without mutation; it accepts only the documented Basic Auth/SQLite/filesystem layout and returns explicit refusal reasons for unsupported fixtures.

- [x] 4.2 Implement V1-to-managed adoption transfer and source recovery
      Requirements: R5.AC3, R5.AC4, R3.AC4, R3.AC6
      Done when: a supported fixture is backed up, copied into a distinct managed volume at the matching published image version, deeply verified, and leaves the V1 directory intact; induced copy/start failure restores the source service and reports both backup locations.

- [x] 4.3 Add a guarded post-adoption verification report
      Requirements: R5.AC3, R5.AC4, R4.AC4
      Done when: successful adoption prints a non-secret checklist for sign-in, conversation, upload, and subsequent managed update, while an incomplete adoption points only to deterministic `doctor`/recovery commands.

## 5. Documentation and retirement of the old path

- [x] 5.1 Rewrite normal-user local and VPS installation documentation around `@or3/cloud`
      Requirements: R1.AC1, R1.AC2, R3.AC1, R3.AC5, R4.AC2, R4.AC3, R6.AC1
      Done when: docs give exact local/public initialization, nftables-versus-UFW guidance, Cloudflare Full (strict) guidance, health/log/backup/update/restore commands, the no-`--volumes` warning, and Tailscale-compatible loopback guidance without claiming automatic Tailscale setup.

- [x] 5.2 Write the maintainer release and incident runbook for the image-first pipeline
      Requirements: R2.AC1, R2.AC4, R2.AC5, R6.AC3
      Done when: the runbook describes provider verification, fixed-profile image smoke, public GHCR pull check, package publication, exact npm/npx verification, immutable-version recovery, and how to investigate a failed automatic rollback.

- [ ] 5.3 Deprecate the old creator in documentation and npm after the new path is proven
      Requirements: R5.AC5, R6.AC1, R6.AC4
      Done when: `create-or3-chat` is marked deprecated with the exact replacement command, its docs no longer recommend it for normal installs, and contributor docs explicitly retain the source-local wizard for advanced provider development.

## 6. Verification and release qualification

- [x] 6.1 Add focused Cloud CLI unit tests
      Requirements: R1.AC3, R1.AC4, R2.AC3, R3.AC5, R3.AC6, R4.AC5, R5.AC2
      Done when: Bun/Vitest tests cover flag validation, target safety, asset/env rendering, secrets redaction, state transitions, backup metadata, destructive-confirmation enforcement, and V1 profile refusal.

- [ ] 6.2 Add local-container integration coverage for lifecycle and recovery
      Requirements: R1.AC5, R3.AC1, R3.AC2, R3.AC3, R3.AC4, R3.AC5
      Done when: CI exercises init, authenticated deep health, persistence over restart, archive validation, update, deliberately unhealthy replacement rollback, and restore using a locally built fixed-profile image.

- [ ] 6.3 Add public-Caddy and adoption integration coverage
      Requirements: R1.AC2, R4.AC1, R4.AC2, R5.AC1, R5.AC3, R5.AC4
      Done when: CI verifies HTTPS proxy/deep health with the public overlay, V1 default-profile adoption including retained data, and refusal/recovery behavior for unsupported or failing source fixtures.

- [x] 6.4 Replace creator release qualification with Cloud artifact qualification
      Requirements: R2.AC1, R2.AC2, R2.AC4, R2.AC5, R6.AC2
      Done when: the tag workflow runs default dependency checks, root-context image build, image smoke, packed CLI smoke, trusted npm publish, exact registry/npx verification, and no longer requires a generated source project for operator qualification.

- [ ] 6.5 Perform the first production release and controlled VPS adoption
      Requirements: R1.AC5, R2.AC1, R3.AC1, R3.AC3, R4.AC1, R5.AC3
      Done when: the exact first Cloud version and image digest are published, a clean local install and a non-production VPS test pass, the existing default-profile VPS is adopted from a verified backup, and one managed update/rollback rehearsal is documented before deprecating the old creator.

## Traceability Matrix

| Requirement | Design components | Tasks |
|---|---|---|
| R1 | Cloud CLI; deployment asset renderer; Docker operation runner | 1.2, 2.2–2.5, 5.1, 6.2–6.3 |
| R2 | Release pipeline; Docker operation runner; state and backup manager | 1.1, 1.3–1.5, 2.1, 2.3, 3.2, 5.2, 6.4 |
| R3 | State and backup manager; Docker operation runner; Cloud CLI | 2.1, 3.1–3.4, 4.2–4.3, 5.1, 6.1–6.2, 6.5 |
| R4 | Cloud CLI; deployment asset renderer; Docker operation runner; documentation | 2.1–2.5, 3.4, 4.3, 5.1, 6.1, 6.3, 6.5 |
| R5 | V1 adopter; state and backup manager; documentation and legacy deprecation | 4.1–4.3, 5.3, 6.1, 6.3, 6.5 |
| R6 | Release pipeline; Cloud CLI; documentation and legacy deprecation | 1.1–1.5, 2.2, 5.1–5.3, 6.4 |

## Definition of Done

- Every acceptance criterion in `requirements.md` has a passing automated test or an explicitly documented release checklist entry.
- Package, image, public Caddy, lifecycle, backup/restore, failed-update rollback, and V1 adoption checks are green in CI.
- `npx @or3/cloud init --local`, `npx @or3/cloud init --public --domain <hostname>`, `update`, `backup`, `restore`, `rollback`, `doctor`, and supported `adopt` match the documented behavior without emitting secrets.
- A clean public GHCR pull and exact npm/npx registry verification pass for the release version.
- The traceability matrix has no missing requirement, component, or task mapping, and normal-user documentation no longer directs operators through a generated source-tree upgrade.
