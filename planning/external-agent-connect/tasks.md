# Tasks

## 1. Prepare the Connect CLI source

- [ ] 1.1 Confirm the `@or3/connect` release workflow in the `or3-intern` checkout (`packages/or3` wrapper, `internal/connect`, `cmd/or3-intern connect`); document how the Intern bootstrap, device flow, service manager, cloudflared token file, and the hardcoded `http://127.0.0.1:9100` ingress target work today.
      Requirements: R1.AC1, R1.AC2, R3.AC1
      Done when: the package entry point, release command, ingress parameterization point, and compatibility constraints are documented in the PR/implementation notes.

- [ ] 1.2 Route `openclaw` and `hermes` from the npm wrapper to `or3-intern connect <runtime>`, parse the runtime argument in the Go command, preserve the no-argument Intern workflow, and reject unknown runtime names before side effects.
      Requirements: R1.AC1, R1.AC2, R1.AC3
      Done when: wrapper and CLI tests cover both new commands, default behavior, help text, and unsupported input with no filesystem, tunnel, or network mutation.

- [ ] 1.3 Publish `@or3/openclaw` from the or3-chat repository following `docs/releasing.md`, then pin the verified version in the CLI's OpenClaw adapter.
      Requirements: R2.AC2
      Done when: the registry serves the exact pinned version, `openclaw plugins install npm:@or3/openclaw@<pin> --pin` succeeds on a clean machine, and the pin is recorded in the implementation notes.

## 2. Implement narrow runtime adapters

- [ ] 2.1 Add the Go `RuntimeAdapter` contract and shared consent/result helpers in the connect command package, including resumable preparation state.
      Requirements: R1.AC1, R2.AC1, R2.AC4, R2.AC6, R4.AC1, R6.AC1, R6.AC4
      Done when: mocked adapter tests prove every mutation has a displayed, approved action, failures prevent enrollment, and an interrupted preparation resumes from its recorded step.

- [ ] 2.2 Implement the OpenClaw adapter: detect/install, verify Gateway/provider readiness and version compatibility, install/enable/inspect the pinned OR3 plugin, merge the exact CORS origin, prepare a safe bearer token, and restart the Gateway.
      Requirements: R2.AC1, R2.AC2, R2.AC4, R4.AC1, R4.AC2, R4.AC3
      Done when: tests cover installed/not-installed, configured `plugins.allow`, string Gateway token, dedicated plugin token, pinned npm install, incompatible-version warning, restart failure, and redacted output.

- [ ] 2.3 Implement the Hermes adapter: detect/install, wait through provider setup, merge loopback API settings and exact CORS origin, start/restart the gateway, and verify authenticated capabilities.
      Requirements: R2.AC1, R2.AC3, R2.AC4, R2.AC6, R4.AC1, R4.AC2
      Done when: tests prove unrelated `.env`/config entries are preserved, unrecognized config writes are avoided, missing provider/API readiness blocks enrollment, and a fixture matching Hermes's real `/v1/capabilities` document (including the exact session/endpoints keys OR3's detector requires) is detected as `runs`.

- [ ] 2.4 Add the Hermes live-SSE CORS diagnostic, documented update check, and separately confirmed compatibility-patch path.
      Requirements: R2.AC5, R6.AC1
      Done when: fixture responses distinguish passing preflight from a failing live SSE 200 response, a fixture matching current fixed Hermes behavior passes without offering the patch, and the patch path cannot run without explicit approval.

## 3. Generalize the OR3 Connect cloud contract

- [ ] 3.1 Add additive `driver`, `runtime`, and validated `base_path` fields to Connect environment records, authorization records, store providers, serialization, and test fixtures; generalize host metadata so `internVersion` is required only for Intern while `runtimeVersion` and `basePath` are required for external runtimes; default missing values to Intern.
      Requirements: R3.AC2, R3.AC3, R5.AC1, R5.AC3
      Done when: existing Intern environment tests pass unchanged and new tests reject invalid driver/runtime/path combinations and incomplete host metadata with a 400 before any record is created.

- [ ] 3.2 Generalize encrypted access-credential parsing/delivery so an external Runs token can be bound to the existing account/workspace/environment context without changing existing Intern credentials.
      Requirements: R4.AC1, R4.AC4, R5.AC4
      Done when: encryption/binding, legacy-envelope compatibility, redelivery, and revocation tests pass for Intern and Runs credentials.

- [ ] 3.3 Update the device start/approval, environment list, status verification, and lifecycle reconciliation paths to use the declared driver and runtime rather than constructing an Intern client unconditionally; add the server-local Runs capability probe and restrict the hydration API to active environments.
      Requirements: R3.AC1, R3.AC5, R5.AC1, R5.AC2, R5.AC5, R6.AC2, R6.AC3
      Done when: server tests verify a real Runs capability check is selected for OpenClaw/Hermes records, only active environments hydrate, rollback leaves no active untracked record, and revoke uses the existing lifecycle.

## 4. Reuse the tunnel and hydrate the browser

- [ ] 4.1 Replace the hardcoded `http://127.0.0.1:9100` ingress target with the adapter's validated loopback target and pass the base path into the existing named-tunnel provisioning/service flow; add ingress assertions for OpenClaw and Hermes.
      Requirements: R3.AC1, R3.AC2, R3.AC3, R3.AC4, R3.AC5
      Done when: Cloudflare provisioner tests prove no direct public runtime port is opened and failed provisioning is reconciled/cleaned up.

- [ ] 4.2 Extend cloud-host API output and the external-agent client reconciler to retain cloud driver/runtime metadata, skip malformed records individually with a safe diagnostic, and instantiate the existing Runs client for those hosts.
      Requirements: R5.AC1, R5.AC2, R5.AC3, R5.AC4, R5.AC5
      Done when: a browser test hydrates Intern, OpenClaw, and Hermes at once without relabeling sessions or credentials, and one malformed record never fails the list.

- [ ] 4.3 Update the Agents connection UI and user-facing documentation to show the two guided commands, the two-approval flow, the remote security boundary, required consent, and manual recovery links.
      Requirements: R1.AC1, R4.AC2, R6.AC1, R6.AC3, R6.AC4
      Done when: component tests and setup skills show correct commands, the completion copy names the exact Agents destination, and no token is displayed in UI copy or docs.

## 5. Verify complete user journeys

- [ ] 5.1 Run the OpenClaw end-to-end enrollment against a real OR3 Cloud environment and named tunnel.
      Requirements: R2.AC2, R3.AC1-R3.AC5, R4.AC1-R4.AC4, R5.AC1-R5.AC5, R6.AC1-R6.AC4
      Done when: an enrolled host streams text/tool activity, exposes commands/models as advertised, survives restart, an interrupted onboarding resumes without re-running the command, and the host is fully removed by disconnect.

- [ ] 5.2 Run the Hermes end-to-end enrollment against a real OR3 Cloud environment and named tunnel, including the live SSE diagnostic.
      Requirements: R2.AC3-R2.AC6, R3.AC1-R3.AC5, R4.AC1-R4.AC4, R5.AC1-R5.AC5, R6.AC1-R6.AC4
      Done when: a healthy build streams and cancels through the tunnel and passes the live SSE check without a patch offer, while an affected build stops at the documented SSE diagnosis without silently degrading to final-only output.

- [ ] 5.3 Run targeted Connect server, cloud-host reconciliation, CLI adapter, and full type checks; inspect the final diff and update the published setup skills only after verified behavior matches them.
      Requirements: R1-R6
      Done when: all targeted checks are green, no regression is accepted without an explicit pre-existing classification, and the traceability matrix is complete.

## Traceability Matrix

| Requirement | Design component | Tasks |
| --- | --- | --- |
| R1 | npm wrapper + Go command router | 1.1, 1.2, 2.1, 4.3 |
| R2 | Go runtime adapters | 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2 |
| R3 | Existing Connect lifecycle and tunnel boundary | 1.1, 3.3, 4.1, 5.1, 5.2 |
| R4 | Runtime adapter and encrypted credential envelope | 2.1, 2.2, 2.3, 3.2, 4.3 |
| R5 | Driver-aware cloud environment and Runs client | 3.1, 3.3, 4.2, 5.1, 5.2 |
| R6 | CLI reporting, lifecycle, and verification | 2.1, 2.4, 3.3, 4.3, 5.1, 5.2, 5.3 |

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
