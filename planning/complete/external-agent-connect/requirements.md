# Requirements

## Introduction

Extend the existing `npx @or3/connect` experience so a user can enroll a
local OpenClaw or Hermes runtime as a remote OR3 Cloud external-agent host with
one guided command: `npx @or3/connect openclaw` or `npx @or3/connect hermes`.
The command should reuse OR3 Connect's device authorization, named Cloudflare
Tunnel, encrypted credential delivery, revocation, and background-service
machinery rather than introducing a new relay or hosted agent service.

## Context

OR3 Connect already provisions a Cloudflare named tunnel to an `or3-intern`
loopback service, encrypts its access credential, and hydrates cloud hosts into
Agents. Its server types, API health probe, and client reconciliation currently
assume an Intern protocol (`internVersion`, `createInternClient`, and port
9100). The OpenClaw and Hermes integrations instead use the generic Runs client
and direct browser CORS. The source for the published `@or3/connect` CLI is the
`or3-intern` repository: the `packages/or3` npm wrapper plus the Go
`internal/connect` package and `cmd/or3-intern connect` command, whose
cloudflared ingress is currently hardcoded to the Intern loopback port 9100.

## Assumptions

- The initial scope is OR3 Cloud with the existing Cloudflare named-tunnel
  relay; local/manual URL-and-token connections remain unchanged.
- A user authorizes installation, runtime configuration changes, API-token
  generation, tunnel provisioning, and background-service installation when
  each is requested.
- Once its plan is approved, the command waits through runtime-owned
  onboarding and resumes by itself; re-running the command is a status/repair
  path, not a setup step.
- Model-provider sign-in, API keys, and any interactive OpenClaw/Hermes
  onboarding remain runtime-owned. The command can guide and validate them, but
  must not guess providers or collect their secrets.
- The user can select or confirm an OR3 Cloud browser origin. The resulting
  runtime CORS list contains that exact origin only.
- The existing OR3 Connect host limit and account/workspace authorization apply
  to external-agent hosts unchanged.

## Out of Scope

- Supporting arbitrary third-party agent runtimes in this command.
- Replacing the Advanced URL-and-token connection form.
- Public unauthenticated tunnels, wildcard CORS, or exposing a runtime's raw
  port beyond its loopback interface.
- Automating model-provider purchase, OAuth, or API-key acquisition.
- A connect-only binary that excludes the Intern runtime; the existing
  bootstrap download is reused.
- Adding Cloudflare Access as a mandatory dependency; its cross-origin browser
  session behavior needs a separately designed UX.
- Hiding Hermes's upstream Runs SSE CORS defect. The command detects it and
  reports the upgrade/approved-patch path.

## Requirements

### R1: Explicit runtime commands

**User Story:** As a user, I want a clear command for each supported runtime,
so that I do not have to understand tunnels or agent protocol details.

**Acceptance Criteria:**
- R1.AC1: WHEN a user runs `npx @or3/connect openclaw` or `npx @or3/connect hermes` THEN the CLI SHALL select only that runtime adapter and display the planned actions before making changes.
- R1.AC2: IF a user runs `npx @or3/connect` without a runtime argument THEN existing Intern behavior SHALL remain unchanged.
- R1.AC3: IF an unsupported runtime argument is supplied THEN the CLI SHALL exit without creating a tunnel or changing runtime configuration and SHALL list the supported arguments.

### R2: Guided runtime readiness

**User Story:** As a user, I want the command to detect and guide missing setup,
so that I can reach a working external agent with minimal manual steps.

**Acceptance Criteria:**
- R2.AC1: WHEN the selected runtime binary is absent THEN the CLI SHALL explain the official installer it intends to run and SHALL require confirmation before executing it.
- R2.AC2: WHEN OpenClaw is selected THEN the adapter SHALL verify the Gateway, install/enable the OR3 Runs plugin at its published, compatibility-pinned version, configure the `/or3/` endpoint, and restart/verify the live plugin runtime.
- R2.AC3: WHEN Hermes is selected THEN the adapter SHALL configure its API server only after confirmation, preserve unrelated configuration, use a loopback bind, and verify authenticated Runs capabilities.
- R2.AC4: IF a runtime lacks a usable model/provider configuration THEN the CLI SHALL stop before tunnel enrollment and provide the runtime's next setup command or UI path.
- R2.AC5: IF Hermes advertises Runs but its live SSE response lacks the configured CORS header THEN the CLI SHALL report the detected upstream defect and offer an upgrade check; it SHALL require separate confirmation before any local source patch.
- R2.AC6: WHEN runtime-owned onboarding is incomplete THEN the CLI SHALL print the exact runtime-owned next step and offer to wait, polling for readiness and resuming without requiring the user to re-run the command.

### R3: Secure Cloudflare Tunnel enrollment

**User Story:** As a signed-in OR3 Cloud user, I want the runtime reachable from
OR3 without opening firewall ports or manually creating a tunnel.

**Acceptance Criteria:**
- R3.AC1: WHEN runtime readiness succeeds and the user approves enrollment THEN the CLI SHALL reuse the existing OR3 Connect device authorization and Cloudflare named-tunnel lifecycle.
- R3.AC2: WHEN provisioning OpenClaw THEN the tunnel ingress SHALL target its loopback Gateway and the cloud base URL SHALL retain the `/or3/` path.
- R3.AC3: WHEN provisioning Hermes THEN the tunnel ingress SHALL target `127.0.0.1:8642` or the adapter's verified local API address.
- R3.AC4: WHILE a tunnel is active THEN the runtime SHALL remain loopback-bound and all browser-facing traffic SHALL use the provisioned HTTPS hostname.
- R3.AC5: IF enrollment, tunnel startup, or capability verification fails THEN the CLI SHALL report the failed stage and offer cleanup; it SHALL NOT leave an untracked active host in OR3 Cloud.

### R4: Runtime-specific credential and CORS handling

**User Story:** As a user, I want OR3 to receive the correct credential and
browser access safely, so that the connected remote agent works without
copying secrets into chat or URLs.

**Acceptance Criteria:**
- R4.AC1: WHEN an adapter needs a bearer credential THEN it SHALL generate or read it only with user approval, avoid command-line/log output, and deliver it through OR3 Connect's existing encrypted credential envelope.
- R4.AC2: WHEN configuring a browser allowlist THEN the adapter SHALL use the exact OR3 Cloud origin and SHALL reject wildcard origins.
- R4.AC3: IF OpenClaw's Gateway token cannot safely be reused THEN the adapter SHALL configure a dedicated OR3 plugin bearer token rather than asking the user to expose an unrelated secret.
- R4.AC4: IF credential delivery to the signed-in workspace fails THEN the CLI SHALL revoke/clean up the new tunnel and SHALL not print the credential.

### R5: Generic cloud-host hydration

**User Story:** As a signed-in user, I want enrolled OpenClaw and Hermes hosts
to appear alongside Intern hosts automatically, so that I can open a new agent
without another connection form.

**Acceptance Criteria:**
- R5.AC1: WHEN OR3 Cloud returns an active enrolled host THEN the browser SHALL retain the declared driver (`intern` or `runs`) and runtime identity while hydrating it.
- R5.AC2: WHEN a cloud Runs host is selected THEN OR3 SHALL use the existing Runs client and capability discovery before showing runtime-dependent controls.
- R5.AC3: IF a stored cloud host has an unknown driver or malformed base URL THEN OR3 SHALL ignore that record safely and SHALL not relabel an Intern or unrelated local host.
- R5.AC4: WHEN a cloud host is revoked or removed THEN OR3 SHALL remove its hydrated record and credentials from the current device session.
- R5.AC5: IF a cloud environment is provisioning, revoking, or in error THEN the environments API SHALL omit it from hydration output so only usable hosts appear in Agents.

### R6: Observable completion and recovery

**User Story:** As a user, I want the command to make success and recovery
clear, so that I can trust the remote connection and fix failures without
dangerous guesswork.

**Acceptance Criteria:**
- R6.AC1: WHEN setup completes THEN the CLI SHALL report the non-secret runtime, HTTPS host URL, service status, and each verification result: capability discovery, streaming, command discovery when advertised, and cancellation. It SHALL name the exact OR3 surface where the host appears, and the user SHALL NOT need to copy any URL, token, or command output into OR3.
- R6.AC2: IF the user reruns the same runtime command THEN the CLI SHALL detect the existing managed environment and offer status, repair, or explicit replacement instead of duplicating tunnels.
- R6.AC3: WHEN the user runs `npx @or3/connect disconnect` for an external-agent environment THEN the CLI SHALL stop its managed service, revoke the tunnel, and remove the cloud host using the existing lifecycle.
- R6.AC4: WHEN any setup step fails THEN the CLI SHALL name the failed stage, print the safe next action, and retain resumable state so a re-run continues from that step.
