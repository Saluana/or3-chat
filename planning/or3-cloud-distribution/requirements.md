# Requirements

## Introduction

OR3 Cloud needs one supported self-hosted distribution instead of a source-project generator followed by manual dependency, image-build, and upgrade work. The distribution will be published as `@or3/cloud`, run through `npx @or3/cloud`, and deploy a versioned OR3 container locally or on one public VPS. It is intentionally limited to the recommended production profile: Basic Auth, SQLite sync, filesystem storage, and Caddy for public HTTPS.

## Context

The repository currently publishes `create-or3-chat@0.1.11`, which copies a full editable application template, then runs `npm` or Bun installation and a source-local `or3-cloud` wizard. The generated Compose stack builds that source locally, stores all durable state in a `/data` volume, keeps port 3000 loopback-only, and adds a Caddy sidecar for public deployments. The existing container workflow already publishes `ghcr.io/saluana/or3-chat`, but it builds from the generated template and does not yet provide an operator-facing image installation or update workflow. The existing default provider files are Basic Auth, SQLite, and filesystem storage.

## Assumptions

- The npm organization can publish the public package `@or3/cloud`; the executable name will be `or3`, used through `npx @or3/cloud`.
- Docker Engine with Docker Compose v2 is the supported runtime for both local and VPS deployments. Node is required only to invoke `npx`, not to build or run OR3 on the host.
- Each OR3 Cloud release has one shared semantic version for the `@or3/cloud` package and `ghcr.io/saluana/or3-chat:<version>` image. The installation records the pulled immutable image digest as well as that version tag.
- The first release supports only the `basic-auth + sqlite + fs` profile. Advanced provider combinations remain source-developer functionality and are not silently approximated by the new installer.
- Existing generated projects are supported through a deliberate `adopt` operation only when they use that same default profile and a matching published application image exists.

## Out of Scope

- Native host-process/systemd installs, npm/Bun application installs on VPS hosts, Kubernetes, multi-server clustering, and automatic host firewall edits.
- Automated Tailscale Serve/Funnel setup, Cloudflare account changes, or other global host/network changes. Documentation may explain how they work with the loopback deployment.
- Moving or redesigning the generic provider SDK and non-default provider packages; they remain build-time dependencies of the OR3 image.
- Automatic conversion of custom, Clerk/Convex, S3, or otherwise unsupported V1 projects.

## Requirements

### R1: Single cloud installation command

**User Story:** As an operator, I want to initialize OR3 with one documented command, so that I do not need a generated application source tree or a separate setup command.

**Acceptance Criteria:**

- R1.AC1: WHEN `npx @or3/cloud init --local` completes THEN the system SHALL create a managed deployment directory containing only deployment configuration, state, backups, and no OR3 application source or `node_modules`.
- R1.AC2: WHEN `npx @or3/cloud init --public --domain <hostname>` completes successfully THEN the system SHALL run OR3 behind Caddy with port 3000 bound only to loopback and Caddy owning public ports 80 and 443.
- R1.AC3: WHEN initialization selects the supported profile THEN the system SHALL configure Basic Auth, SQLite, filesystem storage, persistent `/data`, a real administrator email, and generated secrets without printing secret values.
- R1.AC4: IF the target directory is non-empty or its Compose project is already active THEN initialization SHALL stop before modifying files or containers and explain the safe next command.
- R1.AC5: WHEN initialization starts the deployment THEN it SHALL pull the exact release image, wait for Compose health, and require `/api/health?deep=true` to report success before reporting completion.

### R2: Reproducible release artifact

**User Story:** As a maintainer, I want an OR3 Cloud release to name one tested image and one CLI version, so that operators can reproduce and support a deployment precisely.

**Acceptance Criteria:**

- R2.AC1: WHEN a release tag for version `X.Y.Z` is published THEN the release workflow SHALL publish `ghcr.io/saluana/or3-chat:X.Y.Z` before publishing `@or3/cloud@X.Y.Z`.
- R2.AC2: WHEN the production image is built THEN it SHALL be built with the Basic Auth, SQLite, and filesystem build configuration required by the supported cloud profile.
- R2.AC3: WHEN `init` or `update` pulls an image THEN it SHALL record the requested version, image reference, resolved image digest, and timestamp in managed state.
- R2.AC4: IF the expected image tag cannot be pulled or does not start with a passing deep-health endpoint THEN the release workflow SHALL fail before npm publication.
- R2.AC5: WHEN a CLI package is published THEN its release workflow SHALL verify the exact registry version and execute the documented `npx @or3/cloud@X.Y.Z --help` command with registry-cache revalidation.

### R3: Safe routine operations

**User Story:** As an operator, I want updates, backups, and recovery to be commands rather than a source-code migration, so that maintaining a VPS is predictable.

**Acceptance Criteria:**

- R3.AC1: WHEN `npx @or3/cloud update` runs on a healthy managed deployment THEN it SHALL create and verify a timestamped backup of `/data` and deployment configuration before changing the image version.
- R3.AC2: WHEN an update starts the replacement container THEN it SHALL wait for Compose health and deep health before marking the new version successful.
- R3.AC3: IF a replacement container fails to become deeply healthy THEN the system SHALL restore the immediately preceding image version and data backup, report the rollback result, and retain diagnostic logs.
- R3.AC4: WHEN `npx @or3/cloud backup` succeeds THEN it SHALL create a mode-restricted archive and metadata containing the archive checksum, source version, image digest, and successful archive-list verification.
- R3.AC5: WHEN `npx @or3/cloud restore <backup>` or `rollback` would overwrite the live data volume THEN the command SHALL require an explicit `--yes` confirmation and stop the application before writing data.
- R3.AC6: IF an operation is interrupted before state is committed THEN the next `doctor`, `update`, or `rollback` invocation SHALL identify the incomplete operation and provide a deterministic recovery command rather than guessing.

### R4: Diagnostics and host safety

**User Story:** As an operator, I want actionable validation and troubleshooting without an installer changing unrelated VPS settings, so that deployment failures are safe to diagnose.

**Acceptance Criteria:**

- R4.AC1: WHEN `npx @or3/cloud doctor` runs THEN it SHALL check Docker/Compose availability, managed file permissions, image/state consistency, Compose configuration, deep health, and the loopback-only OR3 port binding.
- R4.AC2: WHEN public mode is configured THEN `doctor` SHALL validate that the domain is a hostname, show its DNS result, check Caddy service status, and report whether ports 80 and 443 are available or in use.
- R4.AC3: WHEN a host uses nftables, UFW, or another firewall THEN the installer and doctor SHALL only report the required HTTP/HTTPS rules and SHALL NOT modify firewall configuration.
- R4.AC4: IF an operation fails THEN the error SHALL name the failed command, preserve existing data/configuration, and print one redacted, copyable diagnostics command.
- R4.AC5: WHILE writing `.env`, generated credentials, state, and backups THEN the system SHALL use restrictive owner-only permissions and SHALL redact secret values from normal output and logs.

### R5: Deliberate V1 transition

**User Story:** As an existing `create-or3-chat` operator, I want a safe path into the managed deployment model, so that I can use simple updates without losing my current OR3 data.

**Acceptance Criteria:**

- R5.AC1: WHEN `npx @or3/cloud adopt --from <v1-directory>` is invoked THEN it SHALL inspect the source project, generated release metadata, Compose configuration, and default-provider configuration without changing them initially.
- R5.AC2: IF the V1 project is not the supported Basic Auth, SQLite, and filesystem profile, or a matching application image is unavailable, THEN adoption SHALL refuse with an explanation and leave the project untouched.
- R5.AC3: WHEN a supported V1 project is adopted THEN the system SHALL back up its data and `.env`, create a separate managed deployment pinned to the same OR3 version, transfer only the supported configuration and data, and verify deep health before reporting success.
- R5.AC4: IF adoption fails after the source deployment has been stopped THEN the system SHALL restore the source deployment and report the preserved backup location.
- R5.AC5: WHEN the managed installer is released THEN the old `create-or3-chat` package and installation docs SHALL be deprecated with a direct `npx @or3/cloud init` replacement and SHALL NOT falsely claim that an in-place V1 upgrade occurred.

### R6: One user-facing distribution surface

**User Story:** As an OR3 user, I want one clear supported package and release path, so that I do not need to understand internal generator and provider publication details.

**Acceptance Criteria:**

- R6.AC1: WHEN following the supported local or VPS documentation THEN users SHALL need only `@or3/cloud`, Docker/Compose, and their domain/network prerequisites; they SHALL NOT install `create-or3-chat` or provider packages.
- R6.AC2: WHEN the default cloud image is released THEN its build SHALL include the default provider modules and pin their exact build-time versions; VPS operators SHALL not download those modules from npm.
- R6.AC3: WHEN maintainers change the default application or a default provider THEN the release runbook SHALL publish or verify required internal dependencies before building the image, but the operator update command SHALL remain unchanged.
- R6.AC4: WHEN custom providers or editable source development is needed THEN the developer documentation SHALL direct users to clone the application repository and use the existing source-local wizard, clearly separated from the supported Cloud distribution.
