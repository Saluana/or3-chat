# Hosted billing (optional source module)

The operator can enable `packages/hosted-billing/module.ts` for a paid hosted
service. This is a build-time Nuxt module, not a workspace-installable plugin.
It is disabled unless `OR3_HOSTED_BILLING_ENABLED=true`, and static generation
excludes it. Other builds have no billing routes, banner, admin controls, Stripe
SDK requirement or payment checks.

## Offer and account access

- Customers open **Dashboard → Billing** to see their plan, storage allowance,
  and trial/paid deadline, subscribe, or open Stripe's customer portal to manage
  payment details and cancellation. The same page remains available at `/billing`
  for direct links and Stripe return URLs. No administrator access is needed.
- Eligible accounts receive one trial (**7 days for the initial offer**), starting on their first
  authenticated session/billing check or hosted request. Trial eligibility is
  limited to one per normalized email and network. Existing billing accounts
  retain their original trial or paid access; their historical trials do not
  create email or network fingerprints retroactively. Free Local and paid
  subscriptions remain available to accounts that are not eligible for a trial.
- The plan notice can be dismissed in this browser. Dismissal is scoped to the
  account, plan state and deadline; it reappears when the trial or paid period
  expires, even in an open tab without waiting for the next status poll.
- No payment information is collected for the trial, and it never automatically
  charges a card. Its original deadline survives restarts and workspace changes.
- **Subscribe** opens Stripe Checkout for the current offer (**USD $40/year initially**). Choosing to subscribe
  charges immediately and starts a paid year; it does not create a second Stripe
  trial. AI usage is separate, using the customer's own OpenRouter or OpenAI key.
- The initial storage allowances are **1 GB during trial** and **50 GB when paid**.
  GB means 1,000,000,000 bytes.
- **Admin → Hosted billing** (`/admin/extensions/hosted-billing`) lets a global
  administrator change both storage allowances for the current offer cohort. Historical cohorts retain their accepted allowances. Changes persist in the billing
  database and apply to subsequent upload requests without rebuilding/restarting.
  Concurrent edits use a revision check. Lowering a limit never deletes files.
- **Accepted offers** retains historical and retired Stripe prices. New offers
  validate an existing active, fixed, licensed annual USD price with quantity
  one, explicit cents/storage/trial terms, an impact preview, reason and revision.
  Existing subscriber terms and trial deadlines remain recognized; unknown or
  ambiguous price matches create review holds without erasing paid dates.
  See [Customer support and operations](./admin-customer-operations.md#accepted-historical-offers).


The paid storage allowance is account-wide across workspaces whose canonical
`owner_user_id` is that account. Shared uploads use the workspace owner's budget;
the uploading member also needs their own hosted access. Retained bytes, including
Trash and soft-deleted workspaces, and active or expired upload reservations count.
An upload can have reached object storage even when it was never committed, so
expired reservations remain charged; retrying the same file does not charge it
again. Failed uploads may therefore use allowance until an operator reviews them.
There is no automatic reservation-release or object-deletion process. Creating
additional workspaces does not multiply the allowance. Physical bucket use can
still exceed logical accounting, for example with object versioning; this is not
a physical bucket billing cap. Monitor bucket use separately.
Synced chat and document data stored in SQLite is not included in this file
allowance. Per-request sync limits do not provide a per-account database quota;
monitor available disk space and investigate sustained growth before it affects
the host.

Trial eligibility stores keyed hashes of normalized email and network, not raw
values. IPv4 addresses and IPv6 /64 networks each receive one trial; a denial
is retained for that account. The hashing key and decisions live in the billing
database and must be included in its backups. Configure proxy trust only behind
a proxy that replaces forwarded client-IP headers, and prevent direct access
around that proxy. A missing or invalid client IP does not grant a trial.
Shared networks can cause legitimate denials; support can review them. Basic
auth does not verify email ownership, and alternate emails or networks can still
be used to obtain additional trials. Monitor signups and use invite-only
registration if stronger controls are needed.

To resolve a legitimate trial denial, first verify the canonical user ID and
make a consistent backup of the billing database. With billing writes stopped,
an operator may give that account a one-time trial by setting `trial_ends_at`
on its existing `billing_accounts` row to the current Unix time in milliseconds
plus 604800000, provided its current value is 0 and it has no paid subscription.
Keep its `billing_trial_decisions` row so an expired override cannot restart
automatically. Restart the service and check the account's billing status. Do
not clear upload reservations based solely on their expiry: a signed upload may
still have produced an object, and safe cleanup is not enabled.

After the Cloud trial or subscription ends, accounts return to **Free Local**.
Chats, documents and original files can still be created and edited in this
browser. Local storage follows the browser's available quota; the advertised
1 GB trial and 50 GB paid allowances apply to Cloud, not a Dexie database cap.
Clearing browser data can remove unsynced work: export local originals first.

Free Local stops automatic sync (push, pull, snapshots and event subscriptions),
background generations, and Cloud uploads. Foreground AI remains available with
the user's own key and the existing server rate limits. Its SSR proxy still uses
server connections and bandwidth; free accounts are low-cost, not cost-free.
Local edits remain atomically captured for a later upgrade; never-attempted
revisions coalesce per entity while transport is paused. Attempted operations
retain their idempotency IDs. Uploads resume from retained local originals when
Cloud access returns. Quota and billing admission failures remain queued without
consuming retry attempts. Downloads remain available for previously synced files.
Free Local exports a streaming backup of the current browser database, including
local edits and local originals, without waiting for sync. Cloud-only files must
be downloaded separately; the export page states this. Cloud restore still uses
the authorized canonical restore path; expiry does not enable local replacement.

Expired accounts cannot start new hosted mutations, uploads or background generations.
Billing, sign-in/password recovery, workspace switching, downloads, exports and
local plugin activation, and stopping an existing generation remain available. Already-admitted generations
may finish, and previously issued short-lived upload URLs remain valid until
their original expiry, including the matching reservation-backed commit. Local browser data remains accessible. This module does
not delete expired-account data or implement a retention purge; publish the
host's actual retention policy before launch.

Cancellation in the Stripe customer portal should be configured for the end of
the paid period. Renewals require confirmed paid invoices with a non-prorated line for the configured Price, customer, subscription item and exact current service period. An older paid invoice does not grant a later period. A previously paid,
automatically renewing subscription gets at most 24 hours of access while its
renewal invoice is draft/open and has no collection attempts. This grace is
anchored to the last paid period, never extended by polling, and removed on a
failed collection, cancellation, or review hold. Initial unpaid subscriptions
receive no grace. Immediate cancellation revokes hosted access. Refund, dispute
and early-fraud-warning events place the account on a conservative manual-review
hold. Partial refunds also require review. Each hold is a recorded review with
its source (refund total, dispute, fraud warning or conflicting subscriptions),
so a redelivered identical event never reopens a resolved review while a new
refund amount does. A later paid event does not clear a hold automatically.
Resolve it from **Admin → Customers → account → Resolve review**: OR3 refreshes
the account from Stripe, refuses the decision if the facts or open reviews
changed or more than one live subscription exists, and then removes only those
holds with your reason in the same database transaction. Holds that predate
review records appear as "Legacy review — reason unavailable". Do not edit
`billing_accounts.review_required` by hand; see
[Customer support and operations](./admin-customer-operations.md).

## Cloud access extension

The trusted host registers `registerCloudAccessPolicy()` from
`server/cloud/access.ts`, including a requirement for personal AI credentials.
The hosted module does not use instance OpenRouter or OpenAI keys for customers,
including on Free Local. It returns an owner-scoped cleanup handle. The session
response carries `cloudAccess: { enabled, expiresAt }` (milliseconds since epoch).
Client scheduling fails closed when `public.cloudAccessPolicyEnabled` is true
and access is missing, and pauses transport at the deadline even offline.
Server middleware independently checks current billing state; existing sync
event streams recheck access and close at the earlier auth/Cloud deadline.
Ordinary builds without this policy retain their existing behavior. This is a
source integration contract, not an installable plugin SDK API.

## Install and enable

Install the module's optional dependency from the repository root:

```sh
bun install --cwd packages/hosted-billing --frozen-lockfile
```

Merge the values in `packages/hosted-billing/env.example` into your private
deployment environment without replacing existing auth/storage credentials.
Use `OR3_HOSTED_BILLING_ENABLED=true` for both development and the production
**build**. A running ordinary image cannot gain billing just by adding an env
variable. Changing/removing the module requires rebuilding; clearing its flag at
runtime does not silently remove an already-built paywall.

Requirements:

- SSR auth and the `sqlite` sync provider; guest access off.
- A local persistent `OR3_SQLITE_DB_PATH` with the `better-sqlite3` driver. Remote
  libSQL, D1 and in-memory SQLite are not supported by this module.
- A separate persistent `OR3_BILLING_SQLITE_PATH`. Back it up with the canonical
  account/sync data using SQLite-consistent snapshots, including WAL state. Losing
  billing data loses trial deadlines, customer mappings and payment access.
- A storage provider advertising `atomicUploadQuota: 'retained-v1'`. Unsupported
  providers fail closed on uploads. The module preserves provider reservation and
  commit contracts and applies any smaller existing workspace quota as well.
- `OR3_BILLING_BASE_URL`: the exact HTTPS public origin (HTTP localhost is allowed
  for development). Redirects are derived from this server setting, not browser
  input or forwarded Host headers.

The quota adapter reads the installed SQLite provider's canonical `workspaces`,
`storage_usage`, `retained_storage` and `upload_intents` tables through a read-only
connection. It does not create a second user/workspace authority or write those
tables. Account-scoped billing leases serialize upload admissions across owned
workspaces; provider transactions still reserve and commit the actual bytes.
The integration is qualified against SQLite provider 0.0.27. Re-run the real
provider quota suite before changing its schema/version. All processes must
share the same billing and sync database files; unrelated per-replica SQLite
copies cannot enforce one account budget.

Use [the update guide](https://github.com/Saluana/or3-chat/blob/or3-cloud/docs/cloud-updates.md) for deployment/release
procedures. This source module is not installed into an existing official
managed image, and no image/package publication is performed by enabling it.

## Stripe sandbox setup

Use a separate Stripe sandbox to qualify the payment flow before live mode.

1. Create one OR3 hosted Product and an active recurring USD $40 yearly Price.
   Set its ID as `OR3_BILLING_STRIPE_PRICE_ID`.
2. Supply a server-only restricted key as `OR3_BILLING_STRIPE_SECRET_KEY` with
   access to Prices (read), Customers (create/read), Checkout Sessions
   (create/read), Subscriptions (read), Invoices (read), Charges (read), and
   customer portal sessions (create). Do not paste real keys into source or chat.
3. Enable the customer portal, including payment-method updates and cancellation
   at period end. Keep plan switching disabled for this single-plan integration.
4. Add a signed webhook destination at `/api/billing/webhook`; set its signing
   secret as `OR3_BILLING_STRIPE_WEBHOOK_SECRET`. Match the SDK's pinned API
   version when configuring the destination. Subscribe to:
   `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`,
   `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.refunded`,
   `charge.dispute.created`, and `radar.early_fraud_warning.created`.
5. Test Checkout, webhook delivery, renewal, failed payment, cancellation and
   refund/review behavior using sandbox data. No live charge is necessary.

Stripe Checkout owns the payment form; OR3 never receives card details.
Customers are mapped through server-owned Stripe IDs to canonical OR3 user IDs,
never matched by email or trusted from client parameters. Repeated Checkout
clicks reuse an open session. Current subscription state is fetched when handling
events so delayed events cannot overwrite newer Stripe state. Event IDs are
deduplicated for 30 days; older replays still reconcile current state. The billing
page can explicitly refresh confirmed state after a missed webhook. Successful
redirects alone never grant access. Configure Stripe delivery monitoring/retries;
there is no background reconciliation scheduler in this first version.

Configure applicable sales-tax handling before live payments. This module does
not turn on Stripe Tax automatically. Enabling automatic tax requires confirmed
active registrations and appropriate product tax settings; a flag alone does not
establish registration. See [Stripe's recurring-tax guide](https://docs.stripe.com/billing/taxes/collect-taxes).

## Source extension contracts

`registerEntitlementResolver()` now returns an owner-scoped cleanup function.
Disposing a replaced registration cannot remove the newer one or revive a
previously disposed resolver. The module preserves the previous resolver's flags
and adds `hosted-access` during trial/paid access, and `paid` for paid access.

`registerStorageGatewayDecorator()` in `server/storage/gateway/registry.ts` adds
a trusted server wrapper to both explicit and active adapter lookup. It returns
an owner-scoped cleanup function. Providers still register their own adapter;
the module does not replace them. With no decorators, lookup behavior is unchanged.

`registerOwnedAdminPage()` is a source-only counterpart to `registerAdminPage()`
that returns a cleanup function. The existing admin-plugin API retains its void
return contract. Billing registers after hydration and releases its owned page
on teardown/HMR.

### Retained storage limitation

The installed providers retain deleted originals and do not yet implement a safe
physical purge and quota-release operation. Deleted files (including emptied
Trash and deleted workspaces) therefore continue to count. The billing page and
admin controls disclose this; raising the allowance is the supported interim
remedy, together with a per-account storage bonus or temporary access from the
account page. Do not reset usage counters independently of provider-owned retained
objects and active reservations. A reclaim operation must preserve those
contracts and needs separate provider work before advertising reusable storage.

## Repeatable billing qualification

Run the optional unit/integration suite with `bun run test:hosted-billing`.
Its webhook boundary test uses a temporary loopback HTTP listener to verify
raw signed bytes, invalid/expired signatures, malformed bodies, declared/streamed
size limits, retry after provider failure and duplicate delivery. The ordinary Cloud UI journey remains
`bun run test:e2e:hosted-billing` and uses disposable local data only.

For actual Stripe test-mode API qualification, run:

```sh
bun run test:e2e:hosted-billing:stripe --env .env.billing-local
```

This explicit network harness refuses live keys and validates the configured
Price before creating a disposable test clock/customer. It checks Checkout and
portal session creation, concurrent/reused/expired Checkout sessions, a paid
initial invoice, draft renewal grace, paid renewal, failed renewal, recovery,
cancellation, partial-refund review and unpaid initial subscriptions. The test clock and its
customers/subscriptions are removed afterward. Failures and cleanup status are
recorded without credentials in `output/hosted-billing/stripe-sandbox.json`.
The local billing database is temporary; the host's account databases are not
used. This does not submit the hosted Checkout form or prove that a deployed
Stripe webhook destination is reachable. Qualify those two deployment steps
separately before switching to live mode.

For the automated admin offer editor flow, use the same private test configuration:

```sh
bun scripts/test/run-workspace-cloud-e2e.ts --billing --stripe-env /path/to/private-test.env --grep 'accepted offers'
```

It verifies rejected price mismatches, preview/confirmation, stale revisions,
historical retirement, unchanged account facts and atomic audit through the real
HTTP/UI path. It uses temporary application databases, creates a test-only price,
and archives that price afterward. It never modifies the configured Stripe price.

For manual Chrome qualification with disposable local databases and real test-mode
Stripe Checkout, start the watch profile with a private environment file containing
the test key, Price ID and Stripe CLI listener signing secret:

```sh
bun scripts/test/run-workspace-cloud-e2e.ts --billing --watch --stripe-env /path/to/private-test.env
```

The profile prints its loopback origin. Forward the documented Stripe events to
that origin's `/api/billing/webhook` using Stripe CLI. The harness overrides all
database paths and billing return URLs; it imports only those three Stripe values
from the private file and refuses live keys. This watch mode can create real
**test-mode** customers/subscriptions through the UI; remove those fixtures from
Stripe after testing. Unlike the automated test-clock harness, watch mode does not
delete Stripe customers automatically. Verify successful payment, decline,
authentication, portal cancellation and signed event delivery. This still does not
qualify the production HTTPS webhook destination.

`bun run test:e2e:hosted-billing:sqlite-stress` is a bounded native WAL diagnostic
using one disposable database, concurrent readers/writers and worker teardown.
It records runtime versions, integrity checks and completion in
`output/hosted-billing/sqlite-native-stress.json`. A successful run does not
rule out all native crashes or qualify power-loss durability.
