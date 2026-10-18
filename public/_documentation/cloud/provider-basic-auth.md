# Basic Auth Provider (`or3-provider-basic-auth`)

Setup and operating guide for the default-stack auth provider.

Managed installations use the fixed profile in [Set up Cloud](/documentation/cloud/setup). The install commands and manual settings below are for editable source deployments; install only the providers your source configuration selects.

## What It Provides

- SSR auth endpoints for sign-in/sign-out/session/refresh.
- Self-service registration endpoint (`POST /api/basic-auth/register`) when registration mode allows it.
- Local account storage (provider-managed DB).
- Session tokens for server-gated routes (`can()` enforcement remains in core routes).
- Provider auth UI adapter registration (when the provider package is installed).

The auth UI adapter supports both sidebar surfaces. Desktop/rail usage keeps
the compact Account/Login tile; the mobile More sheet requests
`layout="more-sheet"` and receives a full-width row matching Connect and the
System actions. The signed-in Account row still opens the provider menu.

## Lock page

With `OR3_AUTH_LOCK_PAGE_ENABLED=true`, `/welcome` shows the branded lock page.
The updated Basic Auth component accepts an email address and opens the existing
Create Account dialog with that address filled in. **Existing account? Sign in**
opens the password sign-in dialog with the same address. When registration is
disabled, **Continue with email** opens sign-in instead. Invite-only registration
still requires a valid invite; invite links continue to open registration with
their token filled in. Safe `next` redirects preserve the destination's query and
fragment. Accounts that authenticate but lack workspace access see the host's
access explanation and account controls; session failures offer a retry.

On mobile, the email field keeps its accessible label while showing an envelope
icon and placeholder, followed by the primary button and an OR divider. The host
provides the responsive cloud artwork, curved card, and handwritten captions.
Its footer includes handwritten **Learn more** and **GitHub** links to
`https://or3.net` and `https://github.com/Saluana/or3-chat`, opening in new tabs.

The Create Account dialog carries the same cloud-and-bird artwork, with the
configured site logo, theme-aware colors, labeled fields with icons, and an
inline **Already registered? Sign in** link. It scrolls on short screens and
stacks its actions on mobile. Decorative artwork is bundled with the provider;
registration, password validation, and invite-code handling are unchanged.
Source development needs a rebuilt provider, and published installations need
an updated provider release to receive the redesigned dialog.

The **Welcome back** sign-in dialog uses the same branding, with a blue bird
seated in clouds, a matching light/dark illustration, larger labeled email and
password fields, and an inline **Don’t have an account? Create account** action.
Its desktop layout follows the welcome artwork; phones and short screens keep
the controls reachable by scrolling when needed. Keyboard focus, dismissal,
email prefilling, invite handoff and credential submission retain their existing
behavior, and sign-in errors are announced to assistive technology. The images
are bundled with the provider, and only the active theme's artwork loads.

The email entry requires the updated Basic Auth provider build. Source development
rebuilds the sibling provider through `bun run dev`; deployments using the currently
pinned provider retain its Sign in button inside the new layout until the provider
update is published and pinned. See [Configuration reference](/documentation/cloud/config-reference)
for lock-page enablement and custom adapters.

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
OR3_BASIC_AUTH_REFRESH_SECRET=replace-with-a-different-random-secret
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
- The provider validates both secrets in strict mode. The wizard copies the JWT secret into the refresh-secret setting when a separate value is not entered.
- Keep bootstrap credentials only for initial provisioning. Rotate/remove afterward.
- `OR3_BASIC_AUTH_ROTATION_GRACE_MS` defaults to `30000` and controls the short refresh-token rotation grace period.
- `OR3_BASIC_AUTH_RATE_LIMIT_BACKEND=memory` is intended only for single-process development; keep the default SQLite backend for clustered deployments.
- Set `OR3_AUTH_AUTO_PROVISION=false` for closed deployments.
- Whenever a token is present, registration verifies its signature, expiry, persisted status/token hash, and normalized email before creating the Basic Auth account or session, including in open mode.
- The selected sync provider must implement atomic invite provisioning so internal user creation, auth mapping, workspace membership, and invite consumption either all commit or all roll back.
- Keep `Cache-Control: no-store` on auth/sync/storage routes (core handlers already enforce this pattern).

## Signup invite retries

The updated provider passes both signup and team tokens through registration. A signup invite gives the recipient a private owner workspace; a team invite retains its target and role. The explicit request-body token takes priority, followed by the host's header, HttpOnly cookie, query, and Referer precedence. This applies in both open and invite-only registration. Valid tokens are retained in the invite cookie for session resolution. Open registration without a token remains available; disabled registration still refuses new users.

If credential creation succeeded before canonical acceptance, use **Already registered? Sign in**. The existing account ID is retained. A manually pasted replacement code or signed link token is verified against the signed-in email and handed to the canonical store through the existing HttpOnly cookie; a stale cookie cannot override it. Credentials without accepted canonical provisioning cannot access protected sync/storage resources. There is no credential repair worker or account deletion step.

These changes are included in `or3-provider-basic-auth@0.0.13`, the version pinned by this release. The 0.0.11 release’s link handoff alone does not provide signup-invite retries.

## Verification Checklist

- `GET /api/auth/session` returns an authenticated user after login.
- `POST /api/basic-auth/register` creates an account when registration mode allows it.
- Garbage, expired, consumed, revoked, and wrong-email invites are rejected without leaving an account or session behind.
- An invite link must lead to completed registration on desktop and mobile, with the private owner workspace (signup) or invited workspace and role (team) still present after reload. Test the complete journey, including links carried by the host's invite cookie and manually entered replacement tokens.
- Access token expiry triggers refresh and does not silently break background/sync routes.
- Logout invalidates local session state.
- Workspace-scoped routes still require `can()` authorization.

Source contributors can exercise that complete journey with
`bun run test:e2e:sign-in-gate -- --grep 'completes invite-only sign-up'`.
The harness uses disposable accounts, databases and storage and saves browser
traces, screenshots and a signup receipt. Release evidence must use the exact
published provider version; rebuilt local provider output is pre-release proof.
Invite-link handoff requires `or3-provider-basic-auth@0.0.11` or later.

The client status and silent-refresh recovery adapters activate only when SSR
auth selects Basic Auth, so installing multiple auth packages does not replace
another provider's session behavior.

## Related

- [Choose and wire providers](/documentation/cloud/providers)
- [SQLite](/documentation/cloud/provider-sqlite)
- [Filesystem](/documentation/cloud/provider-fs)
- [Accounts and access](/documentation/cloud/auth-system)

New signup invitations use eight-character codes, displayed as `K7MP-4X9Q`, with clickable links still available. Lowercase, spaces, and the dash are accepted. The host checks the keyed code hash, intended email, expiry, and pending status before credentials are created, and repeats validation during atomic acceptance. Older signed links still work. A replacement code passed through **Already registered? Sign in** uses the same checks before handing off to the canonical session.
