# requirements.md

## Introduction
OR3 Cloud is supposed to be provider-swappable for **auth**, **sync DB**, and **blob storage** without turning the app into a pile of conditionals and broken builds.

Right now the codebase still has multiple places where **Clerk** and **Convex** are not just “default providers”, but *compile-time dependencies* and *hard assumptions*. That means you can’t remove them from dependencies without the build exploding, and you can’t swap providers without touching core code.

This document defines the requirements to (1) make the current repo less hard-coded immediately, and (2) fully extract Convex/Clerk into installable provider packages.

## Requirements

### 1. Provider Swappability (Developer Experience)

**1.1 Auth provider can be swapped without core edits**
- As a developer, I want to swap the auth provider (Clerk → custom) by changing config + dependencies, so that OR3 Cloud is not married to a single vendor.
- Acceptance Criteria:
  - WHEN `auth.enabled=true` and `auth.provider=<id>` THEN the server SHALL only load middleware/provider code for `<id>`.
  - IF `<id>` is not installed/registered THEN the app SHALL fail fast with a clear error (strict mode) or disable auth with a clear warning (non-strict).
  - WHEN `auth.provider != clerk` THEN the runtime SHALL NOT import `@clerk/nuxt` (or any Clerk server SDK) in any executed path.

**1.2 Sync provider can be swapped without core edits**
- As a developer, I want to swap the sync backend (Convex → custom/gateway) via config + dependencies, so that the sync layer remains provider-agnostic.
- Acceptance Criteria:
  - WHEN `sync.enabled=true` and `sync.provider=<id>` THEN the client SHALL only load direct-provider code if the provider’s package is installed.
  - IF a direct provider is not installed THEN the app SHALL fall back to gateway mode (when available) or disable sync with a clear error.

**1.3 Storage provider can be swapped without core edits**
- As a developer, I want to swap the storage provider (Convex storage → S3/custom) via config + dependencies, so that storage does not force Convex to exist.
- Acceptance Criteria:
  - WHEN `storage.provider != convex` THEN the build SHALL NOT require Convex-generated files or Convex client packages.

### 2. No Compile-Time Coupling in Core App

**2.1 Core app builds without Clerk installed**
- As a developer, I want the OR3 app to typecheck/build when Clerk is not installed, so that auth can be swapped cleanly.
- Acceptance Criteria:
  - WHEN `@clerk/nuxt` is removed from dependencies THEN the repo SHALL still typecheck/build as long as `auth.provider != clerk`.

**2.2 Core app builds without Convex installed**
- As a developer, I want the OR3 app to typecheck/build when Convex is not installed, so that sync/storage can be swapped cleanly.
- Acceptance Criteria:
  - WHEN `convex`, `convex-nuxt`, `convex-vue`, and generated Convex API types are removed THEN the repo SHALL still typecheck/build as long as `sync.provider != convex` and `storage.provider != convex`.

**2.3 Provider-specific code must not be imported by default plugins**
- As a developer, I want Nuxt auto-loaded plugins/middleware to avoid top-level provider imports, so that “not configured” also means “not required at build time”.
- Acceptance Criteria:
  - WHEN a provider is disabled or not selected THEN provider packages SHALL NOT be imported at module top-level in `app/plugins/**` or `server/middleware/**`.

### 3. Provider-Agnostic Workspace Lifecycle

**3.1 Workspace UI does not hardcode Convex client**
- As a developer, I want the workspace management UI to talk to a provider-agnostic workspace API, so that swapping the backend does not rewrite the UI.
- Acceptance Criteria:
  - WHEN `sync.provider != convex` THEN workspace listing/creation/updates SHALL still work through a provider-agnostic interface.
  - The workspace UI SHALL NOT import `convex-vue` or `~~/convex/_generated/api`.

**3.2 Session provisioning uses AuthWorkspaceStore**
- As a developer, I want server session provisioning to use `AuthWorkspaceStore` instead of directly importing Convex, so that canonical user/workspace storage is swappable.
- Acceptance Criteria:
  - WHEN session is resolved THEN it SHALL call an injected `AuthWorkspaceStore` adapter matching the configured canonical store.
  - IF the adapter is missing THEN the server SHALL handle per configured failure policy (`throw`/`unauthenticated`/`service-unavailable`).

### 4. Packaging / Extraction

**4.1 Provider packages are installable and self-contained**
- As a developer, I want Clerk and Convex providers to live in installable packages (e.g. `or3-clerk`, `or3-convex`) so that core OR3 Chat stays clean.
- Acceptance Criteria:
  - The core app SHALL not depend on provider SDKs directly.
  - Provider packages SHALL register themselves through a stable registry interface.

**4.2 Convex backend extraction is supported (realistically)**
- As a developer, I want to install the Convex backend as an add-on, so that a non-Convex app does not contain a Convex project.
- Acceptance Criteria:
  - IF Convex provider is installed THEN it SHALL provide the Convex schema/functions either via a generator/init step or a repo-local package mechanism.
  - IF Convex provider is not installed THEN the app SHALL not contain required imports of `convex/_generated/**`.

### 5. Non-Functional

**5.1 Simplicity**
- As a developer, I want a minimal, boring provider boundary, so that future maintenance doesn’t become a framework project.
- Acceptance Criteria:
  - Provider selection SHALL be driven by config and a registry.
  - Core code SHALL not grow provider-specific branches outside of the registry boundaries.

**5.2 Performance**
- As a user, I want no extra provider overhead on hot paths, so that normal app usage stays fast.
- Acceptance Criteria:
  - Provider packages SHALL be loaded only when needed (dynamic import where applicable).
  - The default path SHALL not add extra network round trips compared to current behavior.
