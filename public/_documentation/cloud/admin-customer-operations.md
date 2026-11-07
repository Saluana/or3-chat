# Customer support and operations

The super-admin dashboard includes support pages for explaining an account's
access, diagnosing refused uploads, and making narrow, recorded corrections.
They use the separately authenticated super-admin login (not workspace-admin or
deployment-admin grants). Reading a page never creates a billing account, trial,
user, workspace or membership, and never calls Stripe or scans storage. Pages do
not show conversations, documents, file names, API keys or card details.

## Customers

**Admin → Customers** (`/admin/customers`) searches canonical users by email,
display name or account ID (at most 200 characters, 50 rows per page). On a
hosted-billing deployment the Paid, Trial and Needs attention filters run on the
server over every billing record, not just the visible page. Counts cover
accounts with a Cloud billing record; users who never started Cloud appear only
under All. Last server contact is the latest sync cursor write. It is not proof
of a completed sync and says nothing about offline device contents.

The account page (`/admin/customers/:id`) shows identity, owned workspaces
(including deleted ones, which are retained and still charged), memberships,
and, with hosted billing installed:

- **Cloud access** with every blocking reason: payment review hold, support
  pause, no active plan/trial/grant, or "Cloud not started" when there is no
  billing record.
- **Payment facts** from Stripe reconciliation, separate from access.
- **Trial decision** (granted, denied, none) and the original deadline.
- **Storage accounting** from one database snapshot: retained files, reserved
  uploads (in progress and from expired links), deleted-workspace bytes, the
  allowance and workspace cap. The upload diagnosis names the controlling
  restriction for a hypothetical file using the same arithmetic as admission;
  it never authorizes an upload.
- **Support history**: every refresh, decision and exception with actor and reason.

## Support actions

Decisions and exceptions need a reason (1–500 characters). Refresh records its actor without requiring a reason. Commands carry an operation ID and are
checked against the account revision you were looking at. A conflicting change
returns 409 and keeps your form input. If a request times out, submitting again
reuses the same operation ID, so it cannot apply twice.

| Action | Effect |
|---|---|
| Refresh from Stripe | Targeted reconciliation under the account lease. Failure keeps the last confirmed facts and any hold. Never clears a review. |
| Resolve review | Refreshes first; removes only the reviewed holds. Paid dates are not changed. |
| Grant temporary access | Hosted access with an explicit storage allowance until a required expiry (at most one year). Not a payment; never grants the `paid` capability; never overrides a hold or pause. |
| Extend trial | Trial access until a new time (at most 90 days). The original trial decision and deadline are kept. Refused while a subscription exists. |
| Additional storage | Bytes added to the current plan, trial or grant allowance, with optional expiry. On its own it does not grant access. |
| Pause hosted access | Stops sync, uploads and new background jobs for this account. Sign-in, Free Local, foreground chat with the customer's own key, downloads, export and billing stay available. |
| Pause uploads / background jobs | Refuses only that kind of new work for workspaces this account owns. |

Exceptions are stored in the private billing database (`billing_support`) with
audit records in `billing_admin_actions`. Expiry is evaluated on each request.

## Storage

**Admin → Storage** (`/admin/storage`) shows deployment-wide charged bytes,
reservations and deleted-workspace bytes, the allowances and workspace cap, and
the largest accounts. Physical bytes are never measured on page load; use the
provider usage action under Operations. Deleted files, emptied Trash and expired
upload links do not release charged bytes until safe reclamation is supported.

Changing the current offer cohort’s trial or paid allowance in **Hosted billing** offers an
impact preview: affected paid and trial accounts, newly over-limit counts and
examples, with the measurement time. The form requires a matching preview and reason; the allowance change and its audit record commit in one transaction. Lowering a limit never deletes files or
blocks downloads; over-limit accounts only stop admitting new uploads.

## Service pauses

**Advanced Settings → Service pauses** stops one kind of new work deployment-wide,
with an optional expiry:

- **New uploads**: presign requests return 503 with `Retry-After` and
  `data.code = "service_paused"`. Downloads, already admitted uploads and
  issued upload links (until they expire) continue.
- **New background jobs**: background admissions are refused; running jobs and
  foreground chat continue.
- **New registrations**: new accounts are refused; existing users sign in. The
  registration mode applies again after resuming. The bootstrap owner's first
  sign-in is not affected.
- **New purchases** (hosted billing): Checkout sessions are not created or
  returned. A session already opened can still complete at Stripe; its webhooks
  are processed normally. The billing portal stays available.

The policy is stored as `service-pauses.json` in the private admin data directory
(`OR3_ADMIN_DATA_DIR`). If it cannot be read, those four kinds of new work are
refused (503, `pause_policy_unavailable`) rather than silently resumed.

## Billing health

**Hosted billing** has four tabs. *Overview & allowances* shows the Stripe mode
(test or live), the current offer, the last explicit price check (run with **Check
price in Stripe**; opening the page never contacts Stripe), the latest per-account
reconciliation, paid/trial/hold counts and failed processing, plus the allowance
form. *Review queue* lists open reviews (oldest 50) with links to the account.
*Processing* lists webhook and admin-refresh outcomes for 30 days
(`billing_processing_outcomes`): succeeded, failed (classified code, attempts),
unmatched (unknown customer) or skipped. A failed handler writes no dedup marker,
so Stripe can retry; a correctly processed `invoice.payment_failed` is a customer
payment failure, not a processing failure. No payloads are stored.

## Configuration sources

In **Advanced Settings** each entry shows how it applies (immediately, restart,
new build, data migration, view only) and where its value comes from: a saved
site setting, the environment, the built-in default (an unset variable is not an
override), or **Enforced by hosted billing** (personal AI keys required and guest
access off; these cannot be edited). Changing the sync, storage or auth provider
is labelled as a data migration, which a restart does not perform.

## Overview

The Overview's **Needs attention** list links to the view that resolves each
item: review holds, failed billing processing, accounts at 85% or more of their
allowance (among the 50 largest), active service pauses, an unreadable pause
policy, and incomplete administrative operations. It reads local records only.
Backup verification is not reported by the application; checks it cannot run
are listed as not checked.

## Activity

**Admin → Activity** (`/admin/activity`) merges the private administration
journal (`activity-journal.jsonl` in the admin data directory) with billing
decisions, filtered by target, actor, action and time. Journal operations record
intent before acting and outcome after; an operation interrupted in between is
shown as **incomplete**. An operation ID can begin only once in the journal; the
server indexes the file once per process and then reads only newly appended
records. Billing decisions are written atomically with their
state change. Each source states when its records begin. Secret-like and
oversized values are never written to either history.

## HTTP endpoints

All require the super-admin cookie, return `Cache-Control: no-store`, and take
explicit target IDs. Commands also require the admin origin and
`x-or3-admin-intent: admin` header, validated bounded JSON, and rate limits.

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/customers`, `GET /api/admin/customers/:id` | Canonical directory and identity/workspace inspection |
| `GET /api/admin/hosted-billing/accounts?ids=…\|filter=…\|counts=1` | Billing summaries, server-side filters, counts |
| `GET /api/admin/hosted-billing/accounts/:id` | Payment, access, review and support projection |
| `GET /api/admin/hosted-billing/accounts/:id/storage` | Storage breakdown and upload explanation |
| `POST /api/admin/hosted-billing/accounts/:id/(refresh\|review\|support)` | Audited commands |
| `GET /api/admin/hosted-billing/storage`, `GET /api/admin/hosted-billing/quota-impact` | Deployment accounting, allowance impact preview |
| `GET/POST /api/admin/system/pauses` | Deployment pauses |
| `GET/POST /api/admin/hosted-billing/offers` | Accepted history, explicit validation/preview and revisioned offer commands |
| `GET /api/admin/storage/candidates?workspaceId=…` | Explicit bounded advisory generation inspection; legacy excluded, no physical scan or claim |
| `POST /api/admin/storage/cleanup` | Super-admin, audited bounded cleanup of previewed generation IDs; available only for a qualified provider pairing |
| `POST /api/admin/system/checks`, `GET /api/admin/system/recovery` | Explicit provider checks and read-only recovery coverage |
| `GET /api/admin/activity`, `GET /api/admin/hosted-billing/activity` | History sources |

## Provider support

Customer inspection uses optional `WorkspaceAccessStore` reads
(`listCustomers`, `getCustomersByIds`, `getCustomerWorkspaces`). The SQLite
provider implements them; other providers show the directory as unavailable and
keep using **Workspaces**. Sync observation reads are optional and remain unavailable
until the selected provider supports them.

## Completed sync observations

The account page separately shows cursor contact, the last completed server
push/pull/snapshot/cursor request (including no-op success), and the latest
classified failure. This is server observation, not device synchronization state.
It cannot inspect offline edits. SQLite migration 032 stores only the latest
success/failure per user/workspace; the projection covers up to 500 workspaces.
A push with rejected items records a classified failure. Diagnostic writes run
off the request path. A changed outcome or failure code is written immediately;
repeats of the same outcome (including a burst of rate-limited requests) are
coalesced to one write per user/workspace per minute, so their timestamps can
lag by up to a minute and the newest repeat can be lost on restart. A diagnostic
write failure never turns a successful sync operation into a failure.

## Capacity and resource controls

**Storage → Upload policy & capacity** selects the existing workspace file policy
form. Maximum upload size is enforced at presign admission; device cache settings
control the client cache, not server storage. Deployment MIME and workspace quota
controls retain their existing supported configuration path.

The site settings `OR3_STORAGE_CAPACITY_WARNING_PERCENT` (85) and
`OR3_STORAGE_CAPACITY_CRITICAL_PERCENT` (95) must be integers from 1–100 with
warning below critical. They warn against an explicitly measured host volume;
they never change upload quotas. Other applications can consume that volume.
Missing capacity, including object-store capacity, is unknown. Usage scans remain
an explicit bounded action in System.

**Advanced Settings → Resource & feature policy** groups resolved background job
concurrency/timeouts, personal-key funding policy, rate-limit groups, models,
features, plugins and registration. It links to existing owning forms. Background
limits apply to new admissions after the supported deployment restart; already
admitted work retains its completion path. Unsupported deployment writers remain
read-only. Requiring personal AI keys differs from merely allowing overrides.

## Provider checks and recovery coverage

System separates enabled configuration from an observed check. **Refresh checks**
runs optional provider probes, each bounded to 1.5 seconds. SQLite probes a
canonical database read. Providers without a probe report unknown. Checks older
than five minutes show stale. This does not test every provider operation.
Background recovery reports observations from this process only and resets at
restart; absence of an observation is unknown.

The recovery panel reads the existing managed operator’s fixed `/v2/recovery`
endpoint. A reported rollback snapshot is not proof of a tested backup. Canonical
data, authentication, files, configuration, billing/trials/support, credential
escrow and an independent copy each remain unknown without a component receipt.
No last recovery-test date is invented. The panel shows a sanitized incomplete
operation and gives manual CLI guidance when the operator is unavailable. It
cannot run backup, restore, shell or Docker commands.

## Accepted historical offers

The billing database seeds v1 from the existing USD $40 annual configuration and
current storage defaults. The environment price ID is a bootstrap value; changing
it later cannot silently replace accepted terms. A startup warning identifies a
mismatch with the saved current offer; manage subsequent changes in **Accepted offers**.
**Accepted offers** lists the
current, grandfathered and retired prices. Retired prices remain recognized for
reconciliation and paid invoice coverage. Unknown or multi-item/multiple live
subscriptions require review and retain confirmed paid dates.

A new offer uses an existing active licensed annual USD Stripe price, exact cents,
paid/trial GB and 1–90 trial days. Validate and preview before confirming with a
reason and current revision. The command validates Stripe again and records the
change atomically with its audit decision. It never changes a Stripe price or
migrates subscriptions. Checkout attempts retain their selected offer through
ambiguous retries. Existing trials keep their deadline and cohort allowance;
new trials use the current offer. The allowance form and impact preview affect
only the current cohort. Live activation requires the disposable Stripe gate.

## Reclamation gate

Mutable legacy files remain excluded from physical reclamation. The explicit workspace dry-run button uses trusted SQLite
generation inspection (25 identities per HTTP page; at most 100 for trusted internal callers) and reports exact
blocked reasons without changing objects, claims or accounting. Its estimate is
logical managed bytes, not freed disk space. Claims repeat the eligibility proof.
The review dialog shows the current page's estimated scope. A cleanup request can
include only generation IDs shown in the preview, and the qualified provider must
recheck eligibility. The dashboard reports each batch's completed, blocked and
pending counts; an interrupted or pending page can be inspected and retried.
Confirmation remains disabled and no cleanup or retention job is started until the
pairing qualifies. No provider advertises cleanup capability until
the exact installed SQLite/filesystem or SQLite/S3 pairing passes
its independent crash, admission, backup/restore and restart gate. Expired-account
purge remains unavailable.

Automatic retained-file cleanup is opt-in through
`OR3_STORAGE_RETENTION_WORKSPACES=workspace_id,another_workspace_id` (at most 100
explicit workspace IDs; empty disables it). Restart after changing the value.
Each hourly tick processes at most 25 managed generations in one selected
workspace, rotating across the list. The retention cutoff is seven days.
Every destructive batch uses the same qualification gate, canonical claim and
audit path as manual cleanup. An unqualified provider refuses the batch.
The scheduler retries pending work without advancing its cursor; after a restart
it scans again from the beginning and resumes persisted claims. Activity records
show each destructive batch's result, and inspecting a workspace shows claims
that still need retry. Shutdown waits for the active batch. This setting never
enables legacy-file cleanup or expired-account purge.

The offer editor is available after disposable Stripe API and browser
qualification. It requires explicit price validation and impact preview, a reason,
and the current offer revision. Confirmation validates the price again; retiring
an offer preserves its recognition for existing subscribers. Opening the page
remains local and never contacts Stripe. This development qualification does not
change a live price or replace release/deployment verification.

### Opt-in enrolled-generation cleanup

On Linux, the SQLite/filesystem pairing exposes managed-generation cleanup only when `OR3_STORAGE_FS_CLEANUP_NAMESPACE_ID` names the existing filesystem namespace UUID and SQLite runs with `OR3_SQLITE_PRAGMA_SYNCHRONOUS=FULL` (or `EXTRA`). The namespace must already have been provisioned by the generation protocol; this setting neither provisions it nor enrolls legacy files. It does not change normal upload/download routing. Leave the namespace setting unset to keep cleanup unavailable. D1 and other unsupported drivers remain unavailable.

Manual admin cleanup rechecks canonical eligibility and uses the installed filesystem remover. Optional `OR3_STORAGE_RETENTION_WORKSPACES` selects explicit workspace IDs for the same audited primitive, with seven-day retention and at most 25 examined generations per hourly turn. Changing these environment settings requires a managed restart. Defaults remain disabled. Both settings are operator-managed and preserved when reapplying the setup wizard; setup does not enable cleanup. Use the repaired managed backup/restore path for enrolled data; raw file copying is not a supported restore.
