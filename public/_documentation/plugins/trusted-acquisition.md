# Trusted Registry Acquisition

Reviewed acquisition installs a package that a configured marketplace registry published and signed. It never accepts a package URL: a request names a plugin (and optionally a version) and the host resolves it from the registry origin it already trusts.

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

- `POST /api/admin/plugins/acquisitions` — start (or refuse) an acquisition. Body: `{ pluginId, version?, workspaceId? }`. Bounded per-admin rate limit.
- `GET /api/admin/plugins/acquisitions/{operationId}/status` — the recorded status view.
- `POST /api/admin/plugins/acquisitions/{operationId}/retry` — continue from the recorded stage.
- `POST /api/admin/plugins/acquisitions/{operationId}/cancel` — cancel before activation.

All are owner-only and super-admin-only; the mutations also require the standard admin mutation check.

## Pipeline

`requested → resolved → authorized → reserved → downloaded → verified → candidate-recorded → health-checked → promoted → receipt-recorded`

Resolution happens before the durable record exists, because it is read-only; from `resolved` onward every stage is written to `<extensions>/.operations/` and is resumable under one operation id. A record keeps the exact release and digests, requester, instance, workspace, stage, authority hash, expected pointer revision and terminal result.

- Downloads enforce the byte ceiling while streaming, verify the archive digest against the signed metadata, and keep partial bytes so a retry resumes.
- Verification uses the canonical package archive reader and tree verifier; the tree, manifest and package identity must match the signed release metadata before any pointer is touched.
- The candidate is recorded through the existing candidate service. A first install whose package declares setup pauses as `needsSetup` instead of claiming an activation.
- The health check is the existing candidate canary: stored package verification, declared server routes, and the recorded grant review.
- Promotion is conditional on the recorded candidate digest and pointer revision, so a racing admin or a stale candidate blocks instead of overwriting the winner.

## Instance-wide preflight

One selected code version is shared by every workspace. Before promotion, every enabled workspace must pass grant review and state compatibility. A blocking workspace keeps the operation `blocked` with `workspace-preflight-blocked` until an owner explicitly disables it for that workspace; grants are never widened on a workspace's behalf.

## Recovery

`retry` resumes from the recorded stage, so an expired download link, a partial download, a temporary registry outage, a since-disabled blocking workspace or newly saved setup all continue the same operation. `cancel` stops the pipeline before the next side effect and never promotes, so the previous selected version keeps running. Both are reported through the status view (`percentComplete`, `needsSetup`, `retryable`, `canceled`, `failure`).
