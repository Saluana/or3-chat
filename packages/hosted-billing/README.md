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
