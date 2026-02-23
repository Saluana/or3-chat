---
artifact_id: b7c4f95e-8ff2-4fcb-a7ab-bdd91b4bbf54
title: Requirements - OR3 Cloud plugin access gating
status: draft
owner: platform
date: 2026-02-19
---

# Overview

OR3 currently supports plugin installation, workspace enable/disable, and arbitrary plugin settings, but does not provide a built-in, declarative policy model for feature gating based on authentication and entitlements (for example, "auth required" or "paid tier required").

This plan defines requirements for a provider-agnostic plugin access-gating system that:
- allows plugin authors to declare gate intent in code,
- allows admins to configure gate policies from the admin dashboard,
- evaluates gates consistently in client and server paths,
- preserves local-first behavior while enforcing authoritative SSR checks for protected operations.

# Requirements

## 1. Add declarative gate policies for plugins

**User Story 1.1**
As a plugin author, I want to declare access requirements for plugin features, so that visibility and execution rules are defined in one predictable policy surface.

**Acceptance Criteria**
- WHEN a plugin is registered THEN it SHALL be able to declare gate metadata (e.g., `authRequired`, `requiredEntitlements`, `requiredRoles`) using a typed contract.
- IF a plugin provides no gate metadata THEN the system SHALL default to current behavior (no additional gating beyond existing enable/disable).
- The gate contract SHALL be provider-agnostic and SHALL not embed Clerk/Convex-specific assumptions.

## 2. Support admin-managed gate configuration per workspace

**User Story 2.1**
As a workspace owner/admin, I want to configure plugin gate rules from the admin dashboard, so that access can be adjusted without redeploying plugin code.

**Acceptance Criteria**
- WHEN an admin updates gate settings for a plugin THEN settings SHALL be persisted in the existing workspace plugin settings store.
- Gate config SHALL support at minimum:
  - authenticated-only access,
  - entitlement/tier requirements (e.g., `paid`),
  - optional role constraints (e.g., `owner`, `editor`).
- IF invalid gate config is submitted THEN the API SHALL return 400 and SHALL NOT persist partial updates.

## 3. Enforce gate decisions consistently across UI and protected actions

**User Story 3.1**
As an end user, I want gated features to be hidden/disabled consistently and denied server-side when required, so behavior is predictable and secure.

**Acceptance Criteria**
- WHEN a feature is gated off THEN plugin entry points (dashboard tiles/pages, sidebar actions/pages, message actions) SHALL not be presented as active affordances.
- WHEN a gated action is attempted via SSR endpoint THEN authorization SHALL be enforced server-side using `can()` as the final decision gate.
- IF client and server disagree due to stale cache/session THEN server denial SHALL be authoritative and a clear UX message SHALL be shown.

## 4. Preserve extension model and static-build guarantees

**User Story 4.1**
As a platform maintainer, I want gating to integrate with existing hooks/registries/composables, so the architecture stays extensible and static builds remain safe.

**Acceptance Criteria**
- Gate evaluation SHALL be exposed through extension points (hook/composable), not hard-coded singleton checks.
- SSR-only auth/entitlement resolvers SHALL remain in server code paths and SHALL not be imported into static-only bundles.
- IF SSR auth is disabled THEN entitlement-dependent gates SHALL degrade to a deterministic local-safe mode (e.g., deny protected features or treat as unauthenticated per policy).

## 5. Provide observability and operability

**User Story 5.1**
As an operator, I want visibility into why a plugin gate denied access, so I can debug policy issues quickly.

**Acceptance Criteria**
- Gate decisions SHALL include structured denial reasons (`unauthenticated`, `missing-entitlement`, `insufficient-role`, `plugin-disabled`, etc.).
- Admin/API responses for policy testing endpoints SHALL include machine-readable reason codes.
- Security-sensitive details SHALL not leak to unauthorized users.

## 6. Backward compatibility and migration

**User Story 6.1**
As an existing OR3 deployment owner, I want plugin behavior to continue working until policies are explicitly configured, so upgrades are non-breaking.

**Acceptance Criteria**
- Existing plugins without gate metadata SHALL remain functional under current enable/disable semantics.
- Existing `plugins.settings.*` data SHALL remain valid and readable.
- Migration SHALL be additive and SHALL NOT require reinstalling plugins.

## 7. Testing coverage

**User Story 7.1**
As a maintainer, I want strong automated coverage for gate logic and policy enforcement, so regressions are caught early.

**Acceptance Criteria**
- Unit tests SHALL cover gate policy normalization, merge precedence (code defaults + admin overrides), and denial reasons.
- Integration tests SHALL cover admin gate config save/load and UI-consumable policy responses.
- SSR integration tests SHALL verify protected routes deny unauthorized/under-entitled users using `can()`.
