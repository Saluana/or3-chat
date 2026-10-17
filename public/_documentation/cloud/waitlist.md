# Optional Cloud waitlist

The Cloud waitlist is an optional server extension for Basic Auth deployments.
Self-hosted installations keep their existing behavior unless explicitly opted in.
It reuses the welcome design, retains sign-in and invite registration, and adds
an instance-admin-only email list and live toggle.

## Enable the extension

Build/start the hosted application with:

```dotenv
SSR_AUTH_ENABLED=true
OR3_AUTH_PROVIDER=basic-auth
OR3_AUTH_LOCK_PAGE_ENABLED=true
OR3_AUTH_LOCK_PAGE_ADAPTER=default
OR3_CLOUD_WAITLIST_ENABLED=true
OR3_AUTH_REGISTRATION_MODE=invite_only
OR3_GUEST_ACCESS_ENABLED=false
```

Use a Basic Auth provider version with the `email-form` lock-page slot. Source
checkouts must rebuild the sibling provider; packaged deployments must release
and pin the updated provider before building the host.

The environment flag includes the extension in the build. It does not turn the
waitlist on automatically. After restarting the application, open **Admin →
Waitlist** and enable **Show waitlist on the welcome page**. The saved toggle
changes the email action between **Join the waitlist** and **Continue with email**
without a restart. Existing accounts can still sign in. Invite links still open
the registration dialog, including invites carried inside a `next` URL.

The toggle changes the welcome page only. Registration restrictions still come
from `auth.registration`/`OR3_AUTH_REGISTRATION_MODE`; keep `invite_only` or
`disabled` while restricting access. Joining the waitlist creates no account,
grants no access and sends no email. Use **Signup invites** to invite people later.

## Storage and privacy

The extension stores normalized unique email addresses and first-join timestamps
in `cloud-waitlist.sqlite` under `OR3_ADMIN_DATA_DIR` (default `.data`). Its enabled
setting is persisted there too. A persistent writable filesystem and the existing
`better-sqlite3` runtime are required. The list is paginated, newest first, and
only available to the instance administrator; workspace administrators cannot
read it. Public requests never reveal whether an address was already registered.

Submissions require same-origin JSON requests with a mutation intent header,
are capped at 2 KiB, and allow 10 attempts per IP per hour per server process.
Closing the waitlist also rejects submissions from pages opened before closing.
Keep a consistent SQLite backup of the admin directory, including WAL state.
Switching off or removing the extension retains the database for later use.

When the opt-in flag is absent, the module registers no UI or routes and creates
no database. Static builds never load it. The extension source and API details
are in `packages/cloud-waitlist/README.md`.
