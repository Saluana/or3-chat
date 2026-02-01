# tasks.md

artifact_id: e59d642b-dc70-438b-bad1-f7d632170f1b
date: 2026-01-25

## Purpose

Implementation checklist for the SSR-only Admin Dashboard control plane (OR3 Cloud). Tasks are grouped by phase and mapped to requirements in `planning/or3-cloud/admin-dashboard/requirements.md`.

---

## Phase 1: Route Boundary + SSR-Only Gating

Requirements: 1.1, 1.2, 1.3

- [x] 1.1 Create admin route group under `app/pages/admin/**`
- [x] 1.2 Add `app/layouts/admin.vue` with dedicated navigation (no main sidebar/panes)
- [x] 1.3 Add admin UI route middleware to:
    - deny when `runtimeConfig.public.ssrAuthEnabled === false` (404/redirect)
    - enforce session presence via `/api/auth/session`
- [x] 1.4 Gate admin code from static builds in `nuxt.config.ts` by ignoring admin pages/components when SSR auth is disabled
- [x] 1.5 Implement host allowlist + base path config:
    - parse `OR3_ADMIN_ALLOWED_HOSTS`
    - parse `OR3_ADMIN_BASE_PATH` (default `/admin`)

---

## Phase 2: Authorization Updates (can())

Requirements: 2.1, 2.2, 2.3

- [x] 2.1 Update `server/auth/can.ts` role mapping so `editor` includes `admin.access`
- [x] 2.2 Update `server/auth/__tests__/can.test.ts` expectations for `admin.access` on editor
- [x] 2.3 Define action-level permission policy for admin APIs:
    - viewer: no access
    - editor: read-only admin pages
    - owner: full admin mutations

---

## Phase 3: Server Hook Engine (Nitro-Safe)

Requirements: 9.1

- [x] 3.1 Implement a server-only hook engine in `server/hooks/**` (no Nuxt composables)
- [x] 3.2 Attach the server hook engine to `event.context` via a Nitro plugin
- [x] 3.3 Add admin hook key typings:
    - `admin.plugin:action:installed`
    - `admin.plugin:action:enabled`
    - `admin.plugin:action:disabled`
    - `admin.user:action:role_changed`

---

## Phase 4: Backend (Canonical Workspace Store) Workspace & Access Operations

Requirements: 3.1, 3.2, 3.3

- [x] 4.1 Define provider-agnostic workspace admin interfaces:
    - `WorkspaceAccessStore` (list/upsert/setRole/remove)
    - `WorkspaceSettingsStore` (get/set for admin keys)
- [x] 4.2 Implement default adapters for the reference backend (Convex) using server-side credentials/gateway
- [x] 4.3 Add backend functions/queries/mutations required for member management:
    - list members
    - upsert member
    - change role
    - remove member
- [x] 4.4 Add workspace-scoped guest access setting using `kv` (key: `admin.guest_access.enabled`) via `WorkspaceSettingsStore`
- [x] 4.5 Ensure backend enforces membership + owner-only writes (provider-agnostic; Convex is default)

---

## Phase 5: Deployment Extensions (Filesystem) + Zip Installation

Requirements: 4.1, 4.2, 5.1

- [x] 5.1 Create `extensions/` directory structure and add it to `.gitignore` if needed for deployments
- [x] 5.2 Define `Or3ExtensionManifest` schema (Zod) and `InstalledExtensionRecord`
- [x] 5.3 Implement `ExtensionManager` (server-only):
    - list installed extensions (scan + cached)
    - validate manifest
    - uninstall extension (idempotent)
- [x] 5.4 Implement zip installer:
    - multipart upload handling
    - max size enforcement
    - safe extraction (zip slip prevention)
    - temp dir + atomic rename
    - update/replace handling with explicit confirmation

---

## Phase 6: Workspace Plugin Enablement + Settings Storage

Requirements: 4.3, 4.4, 5.2

- [x] 6.1 Implement workspace enablement storage using `kv`:
    - key `plugins.enabled` (JSON array)
    - key `plugins.settings.<plugin_id>` (JSON object)
- [x] 6.2 Add validation helpers for parsing/stringifying these kv values (Zod + safe defaults)
- [x] 6.3 Add a minimal plugin settings editor strategy:
    - generic JSON editor (v1)
    - optional plugin-provided schema later
- [x] 6.4 Add deployment default theme setting integration (write config + apply workflow)

---

## Phase 7: Admin API Endpoints

Requirements: 2.2, 3.2, 4.1–4.4, 5.1–5.2, 6.1–6.3, 7.1–7.2

- [x] 7.1 Implement `/api/admin/**` route group with shared helpers:
    - SSR auth enabled check (404 otherwise)
    - session resolution
    - `requireCan` enforcement
    - CSRF protection for mutations
    - host allowlist checks
- [x] 7.2 Workspace endpoints:
    - [x] get workspace + members
    - [x] upsert member
    - [x] set role
    - [x] remove member
    - [x] set guest access
- [x] 7.3 Extensions endpoints:
    - [x] list installed extensions
    - [x] install from zip
    - [x] uninstall
    - [x] enable/disable plugin for workspace
    - [x] update plugin settings for workspace
- [x] 7.4 System endpoints:
    - [x] provider status + warnings
        - drive status via provider adapters/registry (no hard-coded Convex/Clerk)
        - expose provider maintenance actions (sync GC, storage GC, health checks) via adapter surface
        - implement `ProviderAdminAdapter` + `ProviderAdminRegistry` and select adapters by `or3CloudConfig.*.provider`
        - provide default adapters for the built-in/reference providers (Convex/Clerk) and stubs for non-default providers (config validation only)
    - [x] config read (safe summary)
    - [x] config write (whitelisted `.env` keys)
    - [x] restart
    - [x] rebuild + restart (optional)
- [x] 7.5 Emit admin hooks from endpoints on success

---

## Phase 8: Admin UI Pages + Admin Plugin Registry

Requirements: 1.1, 6.1–6.3, 8.1

- [x] 8.1 Build Admin layout + navigation
- [x] 8.2 Implement pages:
    - [x] `/admin` overview
    - [x] `/admin/workspace` workspace & access
    - [x] `/admin/plugins` plugins (installed + enablement + settings)
    - [x] `/admin/themes` themes (installed + default selection)
    - [x] `/admin/system` status + config + restart (+ provider actions)
- [x] 8.3 Add role-aware UI:
    - editors see read-only views
    - owners see mutation controls
- [x] 8.4 Implement parallel admin plugin registry + loader (separate from dashboard plugins)

---

## Phase 9: Security Hardening

Requirements: 10.1–10.4

- [x] 9.1 Implement CSRF checks for admin mutations (Origin/same-site + explicit intent header)
- [x] 9.2 Ensure secrets are masked in UI and never logged
- [x] 9.3 Add explicit confirmation UX for dangerous ops (uninstall/update, restart, rebuild)
- [x] 9.4 Add extension install limits (size, file count, allowed types)

---

## Phase 10: Tests

Requirements: all (coverage focus on auth + safety)

- [x] 10.1 Unit tests:
    - `can()` admin access for editor
    - manifest validation
    - zip slip prevention
    - kv parsing helpers
- [x] 10.2 Integration tests for `/api/admin/**`:
    - SSR disabled → 404
    - unauth → 401
    - viewer → 403
    - editor → 200 read-only / 403 writes
    - owner → 200 writes
- [x] 10.3 Manual verification checklist (dev):
    - install plugin zip → list installed
    - enable plugin for workspace → plugin loads
    - config edit → validate → apply → restart

---

## Phase 11: Docs & Plan Maintenance

Requirements: documentation expectations

- [x] 11.1 Update `planning/or3-cloud/implementation-plan.md` to include Admin Dashboard phase (remove “deferred”)
- [x] 11.2 Update `planning/or3-cloud/tasks.md` top-level checklist to include Admin Dashboard
- [x] 11.3 Add notes to `planning/or3-cloud/findings.md` for any discovered gaps during implementation

---

## Recommended Implementation Order (Best Path to “Working Admin”)

Use this sequence to minimize risk and keep progress verifiable via end-to-end slices.

1. **Hard gates first**: complete Phase 1 (SSR-only + host allowlist + static build exclusion).
2. **Permissions correctness**: complete Phase 2 (update `can()` + tests; define owner-only deployment mutation policy).
3. **Server plumbing**: complete Phase 3 (Nitro-safe server hook engine) so every later step can emit hooks.
4. **Provider adapters (foundation)**: do Phase 4.1–4.5 (define `WorkspaceAccessStore`/`WorkspaceSettingsStore`, implement default Convex adapters, keep stubs for non-default providers).
5. **Minimal system read-only**: implement `GET /api/admin/system/status` (Phase 7.4 status only) + `/admin` overview page (Phase 8.2 overview) to confirm routing + auth.
6. **Workspace read-only**: implement `GET /api/admin/workspace` (Phase 7.2 read) + `/admin/workspace` UI (Phase 8.2 workspace) to confirm store adapters.
7. **Workspace writes**: implement member + guest access mutations (Phase 7.2 writes) + emit hooks (Phase 7.5).
8. **Extensions read-only**: implement extension listing (Phase 5.3 + Phase 7.3 list) + `/admin/plugins` and `/admin/themes` list views.
---
9. **Workspace plugin enablement**: implement kv-backed enablement + settings (Phase 6.1–6.2 + Phase 7.3 enable/settings) and wire the UI controls.
10. **Zip install/uninstall**: implement safe install + uninstall endpoints (Phase 5.4 + Phase 7.3 install/uninstall) and add confirmation UX (Phase 9.3).
11. **Config editing**: implement config read/write + validation (Phase 7.4 config read/write) and UI masking/whitelisting (Req 7.1).
12. **Restart/rebuild**: implement `ServerControlProvider` and restart endpoints (Phase 7.4 restart/rebuild) with explicit intent + safe defaults.
13. **Provider status + actions**: finish Phase 7.4 provider adapters/registry so System can manage sync/storage maintenance actions across providers.
14. **Admin plugin system**: implement Phase 8.4 (parallel admin plugin registry + loader) once core pages are stable.
15. **Security hardening pass**: complete Phase 9 (CSRF, extension limits, secrets handling) before shipping.
16. **Tests throughout (don’t batch)**: start Phase 10 early and add coverage as each slice lands; finish with the integration matrix in 10.2.
17. **Docs hygiene**: keep 11.3 updated as gaps are discovered during implementation.
