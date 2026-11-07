# Implementation baseline (task 1.1)

Recorded 2026-11-06 before any runtime change.

- `or3-chat` HEAD: `827da946` (`[Fix] Harden hosted billing against abuse`). Working tree clean apart from this untracked planning folder.
- `or3-provider-sqlite` HEAD: `9dababf`, clean, package version `0.0.27`.
- `or3-chat/package.json` pins `or3-provider-sqlite@0.0.27`, `or3-provider-fs@0.0.16`, `or3-provider-s3@0.0.15`, `or3-provider-basic-auth@0.0.19`. The installed `node_modules` copies are older (`0.0.26`, `0.0.15`, `0.0.14`, `0.0.17`). Installed-artifact E2E qualification will fail until `bun install` refreshes them. Provider read additions made by this plan are exercised with `--development-providers` until a provider release is published.

## Billing semantics at baseline

- `BillingStore.status()` calls `account()`, which inserts an absent `billing_accounts` row. `exclusive()` also calls `account()`. Neither is safe for admin inspection.
- Trial claims (`claimTrial`) run separately through `ensureTrial()` at the authenticated user boundary (middleware, cloud-access policy, entitlement resolver, billing routes). Decisions are one-time, keyed by HMAC email and network fingerprints. A denial records `granted = 0` with no hashes.
- Review hold is a single `review_required` boolean. It is set by `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created` and by more than one live matching subscription. There is no reason, record, or resolution path other than editing the database.
- Webhook dedup: `billing_events` (30-day retention), written only after successful processing.
- Account quota (`AccountStorageQuota`): `storage_usage` (retained, including deleted workspaces) plus `MAX(0, largest active-or-expired intent − retained)` per workspace/hash, across all workspaces owned by the user. Admission is serialized by the billing account lease. Physical cleanup is disabled.
- Storage limits: one global row (`trial_storage_gb = 1`, `paid_storage_gb = 50`, revisioned). The offer is fixed at USD 40/year and validated by `validatePrice()`.

## Unrelated changes

None. Nothing reverted or stashed.
