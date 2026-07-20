# Basic Auth Provider (`or3-provider-basic-auth`)

Setup and operating guide for the default-stack auth provider.

## What It Provides

- SSR auth endpoints for sign-in/sign-out/session/refresh.
- Self-service registration endpoint (`POST /api/basic-auth/register`) when registration mode allows it.
- Local account storage (provider-managed DB).
- Session tokens for server-gated routes (`can()` enforcement remains in core routes).
- Provider auth UI adapter registration (when the provider package is installed).

## Install

```bash
bun add or3-provider-basic-auth
```

Local sibling package:

```bash
bun add or3-provider-basic-auth@link:../or3-provider-basic-auth
```

## Required Config

```bash
SSR_AUTH_ENABLED=true
AUTH_PROVIDER=basic-auth
OR3_BASIC_AUTH_JWT_SECRET=replace-with-32+-char-random-secret
```

Recommended first-boot bootstrap credentials:

```bash
OR3_BASIC_AUTH_BOOTSTRAP_EMAIL=admin@example.com
OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD=replace-with-strong-password
```

Optional refresh/session tuning:

```bash
OR3_BASIC_AUTH_REFRESH_SECRET=optional-separate-secret
OR3_BASIC_AUTH_ACCESS_TTL_SECONDS=900
OR3_BASIC_AUTH_REFRESH_TTL_SECONDS=2592000
OR3_BASIC_AUTH_DB_PATH=.data/basic-auth.sqlite
```

Registration controls (core auth policy):

```bash
# open | invite_only | disabled
OR3_AUTH_REGISTRATION_MODE=open

# required for invite_only mode
OR3_AUTH_INVITE_TOKEN_SECRET=replace-with-long-random-secret
OR3_AUTH_INVITE_TOKEN_TTL_SECONDS=604800
```

## Security Notes

- Use long random secrets for `OR3_BASIC_AUTH_JWT_SECRET` and `OR3_BASIC_AUTH_REFRESH_SECRET`.
- Keep bootstrap credentials only for initial provisioning. Rotate/remove afterward.
- Set `OR3_AUTH_AUTO_PROVISION=false` for closed deployments.
- In `invite_only` mode, registration verifies the invite signature, expiry, persisted status/token hash, and normalized email before creating the Basic Auth account or session.
- The selected sync provider must implement atomic invite provisioning so internal user creation, auth mapping, workspace membership, and invite consumption either all commit or all roll back.
- Keep `Cache-Control: no-store` on auth/sync/storage routes (core handlers already enforce this pattern).

## Verification Checklist

- `GET /api/auth/session` returns an authenticated user after login.
- `POST /api/basic-auth/register` creates an account when registration mode allows it.
- Garbage, expired, consumed, revoked, and wrong-email invites are rejected without leaving an account or session behind.
- Access token expiry triggers refresh and does not silently break background/sync routes.
- Logout invalidates local session state.
- Workspace-scoped routes still require `can()` authorization.

## Related

- [providers](./providers)
- [provider-sqlite](./provider-sqlite)
- [provider-fs](./provider-fs)
- [auth-system](./auth-system)
