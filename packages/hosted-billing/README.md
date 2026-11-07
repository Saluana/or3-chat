# Optional hosted billing

Operator-installed Nuxt module for a Basic Auth / local SQLite host. It is not a
workspace marketplace plugin: workspace owners must not be able to disable a
host's payment policy. It is off by default, absent from static builds, and has
its own Stripe dependency and lockfile. Ordinary OR3 installations do not need
to install that dependency.

See [Hosted billing setup](../../public/_documentation/cloud/hosted-billing.md)
for activation, Stripe configuration, storage accounting and operational limits.

```sh
bun install --cwd packages/hosted-billing --frozen-lockfile
bun run test:hosted-billing
bun run type-check:hosted-billing
bun run test:e2e:hosted-billing
```

The browser harness uses disposable Basic Auth/SQLite/filesystem providers and
synthetic Stripe credentials; it never charges a card or calls Hippius. Its
screenshots and trace are saved under `output/hosted-billing/`. Payment lifecycle
tests use the real Stripe SDK for signature verification, with mocked remote
API responses. A real Stripe sandbox Checkout/webhook test is required before
activating live payments.

To verify the opt-in production bundle in a disposable checkout, use:

```sh
bun scripts/test/run-workspace-cloud-e2e.ts --billing --build
```

This module is source-host integration code, not a published SDK package or a
managed-release activation mechanism. Follow the repository's canonical update
guide when deploying changes.

## Offer versioning

Billing schema v4 seeds the existing annual USD $40 offer and preserves existing
trial/subscriber cohorts. Accepted historical and retired prices remain valid for
reconciliation; unknown or ambiguous matches hold for review without clearing
confirmed payment facts. New Checkout attempts use the current offer, and an
ambiguous retry keeps its original price. Current-cohort allowance changes do not
rewrite historical cohorts. Support trial extensions retain their promised
allowance as well as their deadline.

Checkout retries check the session's current Stripe state. A session that completes
during a retry cannot start a second subscription, and a recovered expired session
is replaced in the same request. Billing health records the latest reconciliation
outcome from webhooks, Checkout, customer refreshes and support; an account without
a Stripe customer does not count as reconciled.

`OR3_BILLING_STRIPE_PRICE_ID` seeds the first offer only. If it differs from the
saved current offer on startup, a warning directs the operator to manage offers
in the admin panel; changing the environment value does not change accepted terms.

The Accepted offers workflow validates an existing active annual USD price without
quantity transformations (`transform_quantity` must be unset),
previews the future-only effect, and commits a revisioned change with a reason and
atomic audit record. It does not create prices, migrate subscribers, configure tax,
or upgrade the Stripe API. The real test-mode gate is
`bun run test:e2e:hosted-billing:stripe --env <private-test-env>`; its receipt covers
old/new Checkout prices, historical invoices and unchanged trial deadlines. Live
activation still requires that gate; mocked/browser tests alone do not qualify it.

The offer editor is available after disposable Stripe API and browser
qualification. It requires explicit price validation and impact preview, a reason,
and the current offer revision. Confirmation validates the price again; retiring
an offer preserves its recognition for existing subscribers. Opening the page
remains local and never contacts Stripe. This development qualification does not
change a live price or replace release/deployment verification.

Current-cohort allowance saves require an impact preview in the form, a reason,
operation ID and settings revision. The server commits allowance/offer revisions
and the audit record atomically; an audit write failure rolls back the change.
