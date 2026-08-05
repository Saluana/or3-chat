# Tasks

## 1. Prepare the Connect CLI source

- [x] 1.1 Confirm the `@or3/connect` release workflow in the `or3-intern` checkout (`packages/or3` wrapper, `internal/connect`, `cmd/or3-intern connect`); document how the Intern bootstrap, device flow, service manager, cloudflared token file, and the hardcoded `http://127.0.0.1:9100` ingress target work today.
      Requirements: R1.AC1, R1.AC2, R3.AC1
      Done when: the package entry point, release command, ingress parameterization point, and compatibility constraints are documented in the PR/implementation notes.

- [x] 1.2 Route `openclaw` and `hermes` from the npm wrapper to `or3-intern connect <runtime>`, parse the runtime argument in the Go command, preserve the no-argument Intern workflow, and reject unknown runtime names before side effects.
      Requirements: R1.AC1, R1.AC2, R1.AC3
      Done when: wrapper and CLI tests cover both new commands, default behavior, help text, and unsupported input with no filesystem, tunnel, or network mutation.

- [x] 1.3 Publish `@or3/openclaw` from the or3-chat repository following `docs/releasing.md`, then pin the verified version in the CLI's OpenClaw adapter.
      Requirements: R2.AC2
      Done when: the registry serves the exact pinned version, `openclaw plugins install npm:@or3/openclaw@<pin> --pin` succeeds on a clean machine, and the pin is recorded in the implementation notes.

- [ ] 1.4 Publish the updated `@or3/connect` wrapper from the `or3-intern`
      checkout and verify that the public `npx` package contains the external
      runtime router.
      Requirements: R1.AC1, R1.AC2, R1.AC3, R6.AC1
      Done when: the next coordinated Connect release is served by npm and
      `npx @or3/connect@<version> openclaw --help` and
      `npx @or3/connect@<version> hermes --help` exercise the updated wrapper.

## 2. Implement narrow runtime adapters

- [x] 2.1 Add the Go `RuntimeAdapter` contract and shared consent/result helpers in the connect command package, including resumable preparation state.
      Requirements: R1.AC1, R2.AC1, R2.AC4, R2.AC6, R4.AC1, R6.AC1, R6.AC4
      Done when: mocked adapter tests prove every mutation has a displayed, approved action, failures prevent enrollment, and an interrupted preparation resumes from its recorded step.

- [x] 2.2 Implement the OpenClaw adapter: detect/install, verify Gateway/provider readiness and version compatibility, install/enable/inspect the pinned OR3 plugin, merge the exact CORS origin, prepare a safe bearer token, and restart the Gateway.
      Requirements: R2.AC1, R2.AC2, R2.AC4, R4.AC1, R4.AC2, R4.AC3
      Done when: tests cover installed/not-installed, configured `plugins.allow`, string Gateway token, dedicated plugin token, pinned npm install, incompatible-version warning, restart failure, and redacted output.

- [x] 2.3 Implement the Hermes adapter: detect/install, validate provider/model readiness, merge loopback API settings and exact CORS origin, start/restart the gateway, and verify authenticated capabilities.
      Requirements: R2.AC1, R2.AC3, R2.AC4, R2.AC6, R4.AC1, R4.AC2
      Done when: tests prove unrelated `.env`/config entries are preserved, unrecognized config writes are avoided, missing provider/API readiness blocks enrollment, and a fixture matching Hermes's real `/v1/capabilities` document (including the exact session/endpoints keys OR3's detector requires) is detected as `runs`.

- [x] 2.4 Add the Hermes live-SSE CORS diagnostic, documented update check, and separately confirmed compatibility-patch path.
      Requirements: R2.AC5, R6.AC1
      Done when: fixture responses distinguish passing preflight from a failing live SSE 200 response, a fixture matching current fixed Hermes behavior passes without offering the patch, and the patch path cannot run without explicit approval.

## 3. Generalize the OR3 Connect cloud contract

- [x] 3.1 Add additive `driver`, `runtime`, and validated `base_path` fields to Connect environment records, authorization records, store providers, serialization, and test fixtures; generalize host metadata so `internVersion` is required only for Intern while `runtimeVersion` and `basePath` are required for external runtimes; default missing values to Intern.
      Requirements: R3.AC2, R3.AC3, R5.AC1, R5.AC3
      Done when: existing Intern environment tests pass unchanged and new tests reject invalid driver/runtime/path combinations and incomplete host metadata with a 400 before any record is created.

- [x] 3.2 Generalize encrypted access-credential parsing/delivery so an external Runs token can be bound to the existing account/workspace/environment context without changing existing Intern credentials.
      Requirements: R4.AC1, R4.AC4, R5.AC4
      Done when: encryption/binding, legacy-envelope compatibility, redelivery, and revocation tests pass for Intern and Runs credentials.

- [x] 3.3 Update the device start/approval, environment list, status verification, and lifecycle reconciliation paths to use the declared driver and runtime rather than constructing an Intern client unconditionally; add the server-local Runs capability probe and restrict the hydration API to active environments.
      Requirements: R3.AC1, R3.AC5, R5.AC1, R5.AC2, R5.AC5, R6.AC2, R6.AC3
      Done when: server tests verify a real Runs capability check is selected for OpenClaw/Hermes records, only active environments hydrate, rollback leaves no active untracked record, and revoke uses the existing lifecycle.

## 4. Reuse the tunnel and hydrate the browser

- [x] 4.1 Replace the hardcoded `http://127.0.0.1:9100` ingress target with the adapter's validated loopback target and pass the base path into the existing named-tunnel provisioning/service flow; add ingress assertions for OpenClaw and Hermes.
      Requirements: R3.AC1, R3.AC2, R3.AC3, R3.AC4, R3.AC5
      Done when: Cloudflare provisioner tests prove no direct public runtime port is opened and failed provisioning is reconciled/cleaned up.

- [x] 4.2 Extend cloud-host API output and the external-agent client reconciler to retain cloud driver/runtime metadata, skip malformed records individually with a safe diagnostic, and instantiate the existing Runs client for those hosts.
      Requirements: R5.AC1, R5.AC2, R5.AC3, R5.AC4, R5.AC5
      Done when: a browser test hydrates Intern, OpenClaw, and Hermes at once without relabeling sessions or credentials, and one malformed record never fails the list.

- [x] 4.3 Update the Agents connection UI and user-facing documentation to show the two guided commands, the two-approval flow, the remote security boundary, required consent, and manual recovery links.
      Requirements: R1.AC1, R4.AC2, R6.AC1, R6.AC3, R6.AC4
      Done when: component tests and setup skills show correct commands, the completion copy names the exact Agents destination, and no token is displayed in UI copy or docs.

## 5. Verify complete user journeys

- [ ] 5.1 Run the OpenClaw end-to-end enrollment against a real OR3 Cloud environment and named tunnel.
      Requirements: R2.AC2, R3.AC1-R3.AC5, R4.AC1-R4.AC4, R5.AC1-R5.AC5, R6.AC1-R6.AC4
      Done when: an enrolled host streams text/tool activity, exposes commands/models as advertised, survives restart, an interrupted onboarding resumes without re-running the command, and the host is fully removed by disconnect.

- [ ] 5.2 Run the Hermes end-to-end enrollment against a real OR3 Cloud environment and named tunnel, including the live SSE diagnostic.
      Requirements: R2.AC3-R2.AC6, R3.AC1-R3.AC5, R4.AC1-R4.AC4, R5.AC1-R5.AC5, R6.AC1-R6.AC4
      Done when: a healthy build streams and cancels through the tunnel and passes the live SSE check without a patch offer, while an affected build stops at the documented SSE diagnosis without silently degrading to final-only output.

- [x] 5.3 Run targeted Connect server, cloud-host reconciliation, CLI adapter, and full type checks; inspect the final diff and update the published setup skills only after verified behavior matches them.
      Requirements: R1-R6
      Done when: all targeted checks are green, no regression is accepted without an explicit pre-existing classification, and the traceability matrix is complete.

## Traceability Matrix

Implementation note: the runtime adapters intentionally use a small concrete
plan rather than a public adapter framework. Runtime-owned onboarding remains
runtime-owned, while Connect persists the declared binding in its encrypted
access envelope. This avoids a provider migration for the existing SQLite
deployment while keeping Convex's validators/schema additive.

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | npm wrapper + Go command router | 1.1, 1.2, 1.4, 2.1, 4.3 |
| R2 | Go runtime adapters | 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2 |
| R3 | Existing Connect lifecycle and tunnel boundary | 1.1, 3.3, 4.1, 5.1, 5.2 |
| R4 | Runtime adapter and encrypted credential envelope | 2.1, 2.2, 2.3, 3.2, 4.3 |
| R5 | Driver-aware cloud environment and Runs client | 3.1, 3.3, 4.2, 5.1, 5.2 |
| R6 | CLI reporting, lifecycle, and verification | 1.4, 2.1, 2.4, 3.3, 4.3, 5.1, 5.2, 5.3 |

## Definition of Done

- Every R1–R6 acceptance criterion has a passing targeted automated test or
  documented real-runtime smoke test.
- Default `npx @or3/connect` Intern behavior remains compatible.
- OpenClaw and Hermes can be enrolled through their explicit commands without
  opening inbound ports, pasting tokens into OR3, or creating duplicate tunnels
  on rerun.
- Either flow completes without the user copying any URL, token, or command
  output, and the enrolled host appears in Agents without a connection form.
- An interrupted setup resumes from its failed step on re-run for both
  runtimes.
- Cloud-hydrated Intern and Runs hosts retain correct driver/session ownership,
  and only active environments hydrate.
- Tunnel revocation and local credential/session cleanup are verified for both
  new runtime adapters.
- `@or3/openclaw` is published and the CLI's pinned version installs from the
  registry.
- The relevant `@or3/connect` release is published and its version is reflected
  in user-facing guidance only after registry availability is verified.

## Verification notes

- 1.3 is complete. npm serves `@or3/openclaw@0.1.0` with the expected
  repository metadata and integrity, and a clean temporary OpenClaw state
  successfully installed it with `openclaw plugins install
  npm:@or3/openclaw@0.1.0 --pin`; the resulting `or3-runs` plugin reports
  version `0.1.0`. The CLI pin remains `0.1.0`, the exact six-file tarball
  includes the license, bridge tests pass, and the publish workflow validates
  the package contents. npm trusted publishing is configured for
  `Saluana/or3-chat` and `publish-openclaw.yml` with `npm publish` permission.
- 1.4 is still open. The published `@or3/connect@0.1.0` tarball was inspected
  directly and does not contain the new `openclaw`/`hermes` runtime router;
  only the current `or3-intern` source checkout does. The Connect package must
  be released and verified before the one-command external-agent journey can
  be claimed from a fresh `npx` invocation. The `or3-intern` release workflow
  also ships the Go binary and `@or3/intern-client` on the same tag; because
  `@or3/intern-client@0.1.1` already exists while `@or3/connect@0.1.1` does
  not, the next coordinated tag must use the next unused version or the
  workflow must be split before publishing.
- 5.1 and 5.2 require a signed-in OR3 Cloud deployment, named tunnel, and real
  OpenClaw/Hermes processes. They cannot be truthfully marked complete from
  local fixtures; the targeted adapter, bridge, Runs-client, and live-SSE
  diagnostic checks are covered locally. The final review also added focused
  coverage for Gateway reconnect-cycle state, concurrent discovery, provider-
  qualified duplicate models, partial attachment cleanup, slash-command model
  isolation, pointer-safe command selection, resumable non-terminal SSE
  streams, terminal-evidence history hydration, malformed cloud-host
  retention, advertised interactive model/thinking forwarding, wildcard CORS
  rejection, and runtime-specific cloud URL path validation. The Brave smoke
  pass reached the Agents workspace and confirmed
  both saved host entries and the guided `npx @or3/connect openclaw` /
  `npx @or3/connect hermes` commands; the local browser credential vault was
  locked, so opening a real transcript still requires the user's PIN and was
  not claimed as a live runtime test.
- 5.3 is complete for reproducible local validation only. As of 2026-08-03,
  the review worktree is intentionally uncommitted; the exact commands and
  latest successful results are: `npm exec vitest run
  server/api/connect/__tests__/environment-scope.test.ts
  server/api/connect/__tests__/device-status.test.ts` (2 files, 18 tests),
  `go test ./cmd/or3-intern ./internal/connect`, `go vet ./cmd/or3-intern
  ./internal/connect`, `(cd packages/openclaw-or3 && npm test)` (14 tests),
  `npm exec vue-tsc -- --noEmit`, and `git diff --check` in both affected
  repositories. These checks do not replace the signed-in OR3 Cloud,
  named-tunnel, and real OpenClaw/Hermes end-to-end work left open in 5.1 and
  5.2. The repository-wide Vitest command still reports unrelated pre-existing
  dashboard assertions; the `bun run type-check` wrapper cannot open its
  temporary tsx IPC socket in this sandbox, while direct `vue-tsc --noEmit`
  passes. The SQLite provider's standalone typecheck still reports the
  pre-existing host-app `ssrAuthEnabled` mismatch; its Connect-specific errors
  are resolved.
