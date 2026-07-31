---
artifact_id: 0f2e2b5d-7f1b-4b0a-8b8a-9c2d5b0e7d9a
title: Tasks - Admin auth hardening
status: draft
owner: security
date: 2026-02-01
---

# 1. Login timing hardening (`/api/admin/auth/login`)

- [ ] Refactor login handler to always run bcrypt verification before returning 401. Requirements: 1.1
- [ ] Ensure the 401 response (status + message) is identical for wrong username vs wrong password. Requirements: 1.1
- [ ] (Optional) Replace username comparison with constant-time compare (defense in depth). Requirements: 1.1

## Tests
- [ ] Add unit test that verifies `verifyPassword()` is called even when username mismatches. Requirements: 6.1
- [ ] Add unit test verifying both failure modes return same status/message. Requirements: 6.1

# 2. Tighten admin grant/revoke authorization

- [ ] Update `server/api/admin/admin-users/grant.post.ts` to call `requireAdminApiContext(event, { superAdminOnly: true, mutation: true })`. Requirements: 2.1
- [ ] Update `server/api/admin/admin-users/revoke.post.ts` similarly. Requirements: 2.1

## Tests
- [ ] Add unit tests that a `workspace_admin` principal receives 403 for grant/revoke routes. Requirements: 6.1
- [ ] Add unit tests that a `super_admin` principal is allowed (store method is called). Requirements: 6.1

# 3. Proxy-safe IP identity for rate limiting

- [ ] Replace `server/admin/auth/rate-limit.ts:getClientIp()` with a proxy-safe implementation that uses `server/utils/net/request-identity.ts`. Requirements: 3.1
- [ ] Decide where `trustProxy` configuration lives for admin (prefer runtime config); wire it into rate limit IP extraction. Requirements: 3.1
- [ ] Ensure safe fallback when IP cannot be determined (avoid spoof acceptance). Requirements: 3.1

## Tests
- [ ] Add tests verifying forwarded header is ignored when `trustProxy` is false. Requirements: 6.1
- [ ] Add tests verifying forwarded header is parsed and validated when `trustProxy` is true. Requirements: 6.1
- [ ] Add tests verifying invalid forwarded header fails closed (no spoofed identity). Requirements: 6.1

# 4. Admin JWT secret hardening

- [ ] Implement secret validation (minimum strength, helpful error messages). Requirements: 4.1
- [ ] Remove default behavior of writing secrets to disk; keep read-only legacy support in development with deprecation warning. Requirements: 4.2
- [ ] Add explicit strict mode flag to require `OR3_ADMIN_JWT_SECRET` even in development. Requirements: 4.2
- [ ] Add a Bun script to generate a recommended secret and print instructions. Requirements: 4.1

## Tests
- [ ] Add tests for production missing secret throwing with actionable error. Requirements: 6.1
- [ ] Add tests for dev legacy file read path (no writes). Requirements: 6.1
- [ ] Add tests for ephemeral dev secret path. Requirements: 6.1

# 5. Endpoint sensitivity audit for workspace-admin escalation

- [ ] Inventory all `server/api/admin/**` endpoints and classify as read-only vs sensitive mutation. Requirements: 5.1
- [ ] Apply `superAdminOnly: true` to sensitive endpoints (at minimum grant/revoke; extend to restore/soft-delete/create/config writes depending on intended policy). Requirements: 5.1
- [ ] Update docs (if any) describing admin roles and capabilities. Requirements: 5.1

## Tests
- [ ] Add a policy test that enumerates endpoints and asserts sensitive ones require super admin. Requirements: 6.1

# 6. Validation

- [ ] Run `bun run test`. Requirements: 6.1
- [ ] Run `bun run lint` (fix only issues introduced by these changes). Requirements: 6.1
