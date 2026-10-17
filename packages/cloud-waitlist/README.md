# Optional Cloud waitlist

A trusted Nuxt extension for hosted OR3 deployments using Basic Auth. It reuses
the existing welcome design and admin extension registry. It is not loaded by
default and is not a workspace/marketplace plugin.

To include it in a server build:

```dotenv
SSR_AUTH_ENABLED=true
OR3_AUTH_PROVIDER=basic-auth
OR3_AUTH_LOCK_PAGE_ENABLED=true
OR3_AUTH_LOCK_PAGE_ADAPTER=default
OR3_AUTH_REGISTRATION_MODE=invite_only
OR3_GUEST_ACCESS_ENABLED=false
OR3_CLOUD_WAITLIST_ENABLED=true
```

The last variable **installs the extension at build/startup time**. After building
and restarting, open **Admin → Waitlist** (`/admin/extensions/cloud-waitlist`) as
the instance administrator and turn on **Show waitlist on the welcome page**.
Installation defaults to off. This database-backed toggle needs no restart:
new welcome visits show **Join the waitlist** when on, and **Continue with email**
when off. Stale waitlist submissions are rejected after it is turned off.

Sign-in always uses the original provider dialogs. Direct invite links, including
invites inside the welcome page's `next` query, retain automatic registration.
The extension needs the Basic Auth `email-form` slot from this change; rebuild
the sibling provider locally, or publish and pin that provider before deployment.
Static builds and ordinary installs without the opt-in load no routes, UI or DB.
The module can also be installed explicitly via `extensions.plugins.modules` as
`./packages/cloud-waitlist/module.ts`; the environment variable is a convenience
for this source distribution.

## Data and API

The extension owns `cloud-waitlist.sqlite` under `OR3_ADMIN_DATA_DIR` (default
`.data`). It stores its enabled setting and normalized unique email addresses
with first-join timestamps. It uses the existing `better-sqlite3` dependency,
requires a persistent writable filesystem, and does not modify auth/workspace
tables. Back up this database along with the admin directory using a consistent
SQLite backup/snapshot (including WAL state). Removing the module leaves its
data available for a future reinstall; turning the toggle off also retains it.

- `GET /api/cloud/waitlist`: only `{ enabled }`, never addresses.
- `POST /api/cloud/waitlist`: `{ email }`, JSON, exact same-origin browser request
  with `x-or3-waitlist-intent: join`. Maximum 2 KiB; 10 attempts per IP per hour
  per server process. New and duplicate submissions receive `{ ok: true }`.
- `GET /api/admin/cloud-waitlist?page=1`: instance-admin-only list, 50 entries
  per page, newest first, plus total and current setting.
- `PATCH /api/admin/cloud-waitlist`: `{ enabled: boolean }`, instance-admin-only,
  with the normal same-origin `x-or3-admin-intent: admin` mutation guard.

The switch controls presentation, **not registration policy**. Keep registration
`invite_only` (or `disabled`) while limiting signups. Joining does not create an
account, grant access, send mail, or issue an invitation. Administrators can use
the existing Signup invites page to invite selected addresses later.

## Validation

```bash
bun run test:e2e:waitlist
bun run test:e2e:waitlist --without-extension
```

Both use disposable auth, sync, storage and admin databases on separate ports.
The journey produces a rendered mobile screenshot and a JSON waitlist receipt.
