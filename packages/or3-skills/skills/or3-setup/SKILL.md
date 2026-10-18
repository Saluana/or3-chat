---
name: or3-setup
description: Configure, validate, repair, or prepare deployment of an OR3 Chat installation using the supported operator or source wizard.
license: GPL-3.0
compatibility: Requires an OR3 Chat checkout and Bun for supported setup and validation commands.
metadata:
  author: OR3
  version: 0.1.0
  or3-product: or3-chat
---

# OR3 setup

Inspect the target mode, provider configuration, and data paths before making changes.
Use [repository navigation](../../shared/repository-navigation.md) for the current setup and selected-provider docs.
If checkout context is uncertain, this package's `bun run context --cwd <checkout>` identifies it.

## Supported paths

- Normal local/VPS installs use `npx @or3/cloud init --local` or the documented public-domain route.
- Editable source or custom-provider deployments use the checkout's `bun run or3-cloud:init` wizard.
- Source development starts with `bun run dev`; its wrappers select the required runtime.
- Remote Connect availability must be checked against the current deployment docs; do not infer managed support from source code.

## Safety

- Reuse configuration builders and the wizard's nondestructive environment merge, preserving unknown entries and provider aliases.
- Keep credentials server-only where required and out of source, examples, logs, and reports.
- Provider switching is not data migration; back up and obtain explicit approval before replacing databases, storage roots, or live provider configuration.
- Preserve static builds and unrelated changes; do not hand-author a replacement `.env` when the supported merge is sufficient.

Validate with `bun run or3-cloud:validate` and the relevant `bun run doctor` checks.
Run start/build or deep health checks as needed for the changed mode, and stop before deployment/promotion on failed validation.
A dry run is not an installed or running configuration.

Report the effective mode/providers, validation, and any material startup or restoration instructions using [completion guidance](../../shared/completion-contract.md).
See [quality gates](../../shared/quality-gates.md) and [permissions and trust](../../shared/permissions-and-trust.md).
Checkout references: `public/_documentation/cloud/setup.md`, `or3-cloud-wizard.md`, `configure.md`, and selected provider pages in that category.
