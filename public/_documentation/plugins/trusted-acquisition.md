# Trusted Registry Acquisition

Reviewed acquisition installs a package that a configured marketplace registry published and signed. It never accepts a package URL: a request names a plugin (and optionally a version) and the host resolves it from the registry origin it already trusts.

The host speaks the marketplace's real public trust contract: release metadata from `/api/v1/catalog/trust/releases/{pluginId}/{version}/metadata` (the signed document inside the `{ releaseId, document }` wrapper), the signed advisory log from `/api/v1/catalog/trust/advisories` and `/api/v1/catalog/trust/advisories/{sequence}`, and the package bytes from the content-addressed `/api/v1/catalog/trust/artifacts/{archiveSha256}`. The artifact URL is derived from the signed archive digest, never taken from a caller or from the document.

The owner-only raw-ZIP upload path (`/api/admin/extensions/install`) is separate and unchanged. Enabling registry acquisition does not enable arbitrary uploads.

## Configuration

| Variable | Meaning |
| --- | --- |
| `OR3_MARKETPLACE_REGISTRY_ORIGIN` | Registry origin. Must be `https://` with no path; anything else is ignored. |
| `OR3_MARKETPLACE_INSTALL_ENABLED` | Must be exactly `true`. Registry acquisition is off by default. |
| `OR3_MARKETPLACE_RELEASE_KEYS` | JSON array of trusted release keys: `[{ "keyId": "...", "publicJwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." } }]`. Malformed entries are dropped, so a typo cannot widen trust. |
| `OR3_MARKETPLACE_MAX_ARTIFACT_BYTES` | Per-acquisition download ceiling (default 128 MiB). |
| `OR3_MARKETPLACE_RESERVE_BYTES` | Free disk kept for the running instance while staging (default 64 MiB). |
| `OR3_INSTANCE_ID` | Optional stable instance identity recorded on each operation. Derived from hostname plus the extensions root when unset. |

An instance with no origin or no release key refuses every acquisition with `registry-unconfigured`.

## Routes

- `POST /api/admin/plugins/acquisitions` — start (or refuse) an acquisition. Body: `{ pluginId, version?, workspaceId? }`. Bounded per-admin rate limit. Answers `202` with the durable operation as soon as it is recorded, before the long-running work, so the id can be polled and cancelled.
- `GET /api/admin/plugins/acquisitions` — list recorded operations (optionally `?pluginId=`), so an id is recoverable if the start response was lost.
- `GET /api/admin/plugins/acquisitions/{operationId}/status` — the recorded status view.
- `POST /api/admin/plugins/acquisitions/{operationId}/retry` — continue from the recorded stage.
- `POST /api/admin/plugins/acquisitions/{operationId}/cancel` — cancel before activation.

All are owner-only and super-admin-only; the mutations also require the standard admin mutation check.

## Pipeline

`requested → resolved → authorized → reserved → downloaded → verified → candidate-recorded → health-checked → promoted → receipt-recorded`

Resolution happens before the durable record exists, because it is read-only; from `resolved` onward every stage is written to `<extensions>/.operations/` and is resumable under one operation id. A record keeps the exact release and digests, requester, instance, workspace, stage, authority hash, expected pointer revision and terminal result.

- Downloads enforce the byte ceiling while streaming, verify the archive digest against the signed metadata, and keep partial bytes so a retry resumes.
- Verification uses the canonical package archive reader and tree verifier; the tree, manifest and package identity must match the signed release metadata before any pointer is touched.
- The signed profile is validated against the package that was actually staged. A release that claims the portable client profile must be an `isolated-client`, browser-only package: trust mode, client isolation, the absence of server code and the generated policy/setup descriptors are all checked with the same validator the marketplace reviewer uses, and new signed releases bind the complete EffectiveAuthority descriptor, and its canonical digest must match authority derived from the packaged manifest, policy and setup descriptors. Legacy policy-revision envelopes remain readable but do not grant blanket consent for new authority.
- The candidate is recorded through the existing candidate service. Setup readiness is the host's own plan (settings and stored connections), re-evaluated before the canary and again before promotion, so a package that declares setup pauses as `needsSetup` and a retry cannot promote it with nothing saved.
- A profile that requires a client runtime needs a real client canary pass. The host issues a single-use ticket and the admin's browser performs a hidden activation of the exact candidate bytes in the contained sandbox; until that evidence exists the operation stays pending with `client-canary-pending`, and a browser-driven retry completes it. A server-side check alone never substitutes for it.
- The health check is the existing candidate canary: stored package verification, declared server routes, and the recorded grant review.
- Promotion is conditional on the recorded candidate digest and pointer revision, so a racing admin or a stale candidate blocks instead of overwriting the winner. The instance-wide preflight is re-run at that boundary, and if the workspace set changed the operation restages so the canary is re-run rather than reused.
- A crash between the pointer write and the recorded `promoted` stage is reconciled from the committed pointer, so a live installation is never reported as `pointer-conflict`.

## Instance-wide preflight

One selected code version is shared by every workspace. Before promotion, every enabled workspace must pass grant review and state compatibility. A blocking workspace keeps the operation `blocked` with `workspace-preflight-blocked` until an owner explicitly disables it for that workspace; grants are never widened on a workspace's behalf.

## Recovery

`retry` resumes from the recorded stage, so an expired download link, a partial download, a temporary registry outage, a since-disabled blocking workspace or newly saved setup all continue the same operation. Only one runner advances a plugin at a time (an exclusive runner lock), and a retry refuses while another operation for the same plugin is active or a runner is live, so two runs cannot share one staging directory. Host policy is re-read on every resumed stage: disabling installation or removing a trust key stops a downloaded candidate before activation. `cancel` stops the pipeline before the next side effect; once the pointer has been committed the operation finishes as completed rather than reporting "canceled before activation", because the installation is live. Both are reported through the status view (`percentComplete`, `needsSetup`, `retryable`, `canceled`, `failure`).

Every operation is reported with the workspace it installs into, and a paused operation is reported as `resumable` in addition to `needsSetup`, so a caller can tell "waiting on you" from "waiting on the registry" and offer to continue it.

A promotion that fills an empty selection (a first install) also enables the plugin for the workspace the operation installs into; the runtime gate refuses a disabled package, so a completed install would otherwise be a version nothing runs. An update replaces the selection without touching enablement, so a workspace that disabled a plugin keeps it disabled after the update.

## Permission consent

A candidate whose release asks for authority is refused until the workspace has a *current* reviewed-grant record: `prepare` reports `grant-review-unreviewed` (no record, or a record this release did not write) or `grant-review-stale` (the release now asks for a different set). Consent is recorded per workspace with `POST /api/admin/plugins/packages/{pluginId}/grants`, which derives the requested set from the staged candidate's manifest or the signed release metadata and stores only an approved subset of it. The promotion boundary re-checks the same record, and the instance-wide preflight refuses a promotion while any enabled workspace lacks a current one.

## Freshness, advisories and revocation

Quarantine decisions come from the signed advisory log, which is fetched and verified on every resolve: a quarantined release is refused with `release-quarantined`, an advisory that cannot be verified refuses with `advisory-unverified`, and the newest seen sequence is recorded monotonically. A release's publication date is not freshness: an old but intact, non-quarantined release is still acquirable.

The registry checkpoint is `schemaVersion 2` and authenticates a monotonic **security revision** in addition to the advisory sequence. The snapshot it covers includes every active advisory *and* every release-key status, so key pretrust/retirement/compromise changes the signed bytes and begins a new revision. The host enforces all of the following, in order:

- a checkpoint for another origin, an expired window, a future issue time or a checkpoint older than the host's configured maximum age is refused (`advisory-stale`);
- a checkpoint whose revision is lower than the host's accepted revision is refused (`advisory-stale`), and the advisory sequence remains a second, independent floor;
- the same revision with a different snapshot digest is refused as equivocation, and the same revision with an older issue time is refused as a replay (`advisory-unverified`/`advisory-stale`);
- a checkpoint not signed by a key in the host's static trust root, signed by a non-active key, or with a digest that does not match the snapshot is refused (`advisory-unverified`);
- duplicate keys, duplicate or future advisory sequences, untrusted advisory signatures and a snapshotted key that is missing or compromised are refused.

`schemaVersion 1` checkpoints have no revision and are rejected outright. The accepted revision, sequence, digest and issue time are persisted under `<extensions>/.registry/state.json` (state `schemaVersion 2`); v1 state is migrated by carrying over the sequence floor and starting the accepted revision at 0. Resume of an in-flight acquisition compares the recorded revision **and** digest, not the sequence alone, so a key-status change cannot be disguised as progress. Legacy in-flight operations migrate the same way: their incomparable v1 digest is discarded and the fresh v2 checkpoint is authenticated instead.

An authenticated checkpoint is persisted **before** any release-specific refusal is applied. A resolve that is refused because the snapshot revoked the release's key (or quarantined the release) still records the new revision, so a host that observed a revocation cannot forget it and later accept a replayed earlier checkpoint; the persisted revision then refuses that replay.

## Key rotation and the host trust root

Hosts verify releases, advisories and checkpoints against the static release keys in `OR3_MARKETPLACE_RELEASE_KEYS`; the signed snapshot advertises key status but carries no key material. **Pretrusting a new signing key on the registry therefore does not let an older host verify it.** The supported rotation order is host-update-first:

1. ship the new key id and public JWK to every supported host's trust root (host software/configuration update), keeping the current key;
2. the registry pretrusts the new key (a strictly higher revision) and the host accepts the revisioned checkpoint;
3. the protected signer secret switches to the new key;
4. the old key is retired (another higher revision) and remains published so releases and advisories it signed still verify historically.

A rotation that skips step 1 fails closed: releases signed by the new key are refused with `release-key-untrusted`, and a checkpoint signed by it is refused as untrusted.

## Installed or running releases when a quarantine arrives

A quarantine blocks acquisition and activation, not execution:

- **New acquisition or update** to the quarantined release is refused with `release-quarantined`, and the decision is persisted per release.
- **A downloaded candidate** that has not yet been activated re-resolves at the next resumed stage, sees the quarantine and stops as `blocked`; the current version stays in place.
- **An installed, running release keeps running.** The host does not unload it remotely; an operator can disable or uninstall it in the admin UI. Restarting cannot make it acquirable again because the ledger is durable.
- **A newer version** of the same plugin can still be acquired (the ledger is release-scoped), which is the safe repair path.
- **User data** is untouched by any quarantine path, and clearing a marketplace hold does not clear a quarantine the host already recorded for that exact release.

Quarantine is a security statement only. Deprecation, refunds, membership and market restrictions have separate flows and never substitute for it.

A paid release is the one exception the host does not treat as a hard stop. The public artifact path refuses it with `coverage-required`; the pipeline tells that refusal apart from an expired signed URL, records the acquisition through the acting local user's encrypted Library link, and retries the download once against the token-authenticated artifact route with the credential kept server-side. The same signature, advisory, archive, tree, consent, setup and promotion checks then run as for any free release; without a usable link the operation stops with a retryable `coverage-required` failure rather than looping on a URL that will never serve it.

The advisory sequence is a *freshness* cursor, not a filter for which scoped decisions still apply. Quarantines are recorded per release in the registry state (`<extensions>/.registry/state.json`) independently of that cursor, evaluated over every verified advisory including ones at or below it, and consulted before the registry log is read at all. Resolving any other release therefore cannot clear a quarantine this host has already accepted, and a recorded decision survives a registry log that no longer lists it. The ledger is monotonic per release, bounded, and written under the same exclusive lock as the cursor.

## Host capability requirement

The pipeline presents the host's declared package capabilities (`supportedTrustModes`, `supportedFeatures`, `supportedGrants`) and never widens them for a release. Acquiring a profile therefore requires the host to declare everything that profile needs. The current host declares `trusted-host` and `isolated-client` (with the hidden browser canary runner), the `or3-portable-client-v1` feature, and only the grants it actually honors: `ui.dashboard.register`, `ui.command-palette.register`, `settings.read`/`settings.write`, `storage.read`/`storage.write` (the plugin-namespaced KV store through the portable runtime), `network.http`, `documents.read` (selection-scoped reads through a host-minted handle; the server refuses to mint one without an approved review) and `documents.write` (host-performed writes behind the grant-checked host action executor). A release requesting anything else is refused with `unsupported-grant`, and the packed official archives are run through this boundary in `tests/unit/official-plugins-conformance.test.ts` so the vocabulary and the products cannot drift apart.
