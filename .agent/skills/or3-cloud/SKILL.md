---
name: or3-cloud
description: Implement or debug OR3 Cloud authentication, synchronization, storage, and background execution in a source checkout.
---

# OR3 Cloud development

Use the checkout's `AGENTS.md` and `public/_documentation/docmap.json` to find the relevant current contract.
Cloud core is provider-agnostic; managed defaults and source fallback defaults are different.

## Contracts that matter

- Canonical workspace authority belongs to the selected sync backend; direct providers use the token broker and gateways enforce `can()`.
- Preserve static builds and server/client SDK boundaries.
- Keep local writes/outbox capture atomic, pushes idempotent, versions contiguous, and remote apply suppressed.
- Preserve tombstones, device-cursor retention, queued blob transfers, and authorized reservation/commit behavior.
- Background tools, durable admission, cancellation, and recovery are capability-gated; do not infer eligibility from an old tool-count rule.
- Reuse config builders, the env editor, provider registries, and the existing wizard instead of creating parallel paths.

## Find the owner

| Work | Maintained documentation | Source entry points |
| --- | --- | --- |
| Provider wiring | [Providers](../../../public/_documentation/cloud/providers.md) | `shared/cloud/`, `nuxt.config.ts`, selected provider package |
| Auth and workspace identity | [Auth](../../../public/_documentation/cloud/auth-system.md), [capabilities](../../../public/_documentation/cloud/capability-matrix.md) | `server/auth/`, `app/core/auth-ui/`, session composables |
| Synchronization | [Sync](../../../public/_documentation/cloud/sync-layer.md) | `app/core/sync/`, `server/api/sync/`, selected provider |
| Storage | [Storage](../../../public/_documentation/cloud/storage-layer.md) | `app/core/storage/`, `server/api/storage/`, selected provider |
| Background jobs | [Background execution](../../../public/_documentation/cloud/background-execution.md) | `app/utils/chat/useAi-internal/`, `server/utils/background-jobs/` |
| Setup/config | [Source wizard](../../../public/_documentation/cloud/or3-cloud-wizard.md), [config](../../../public/_documentation/cloud/config-reference.md) | `shared/cloud/wizard/`, `server/admin/config/` |

Use targeted repository checks from `AGENTS.md`; provider development and deployment follow the provider guide and [update guide](../../../docs/cloud-updates.md).
